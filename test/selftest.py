#!/usr/bin/env python3
"""End-to-end self test for adb-mcp.

    mcp/.venv/bin/python3 test/selftest.py            everything
    mcp/.venv/bin/python3 test/selftest.py --quick    skip the 60 s and perf parts
    mcp/.venv/bin/python3 test/selftest.py --no-mutate    read-only, touches nothing

Six layers, cheapest first, so a failure early tells you not to trust what
follows:

    0  error classification      pure logic, no proxy needed
    1  proxy behaviour           fake clients, via node (see selftest_socket.js)
    2  python client contract    code -> exception -> bridge -> probe
    3  the five Adobe apps       read-only
    4  Photoshop functional      every command group, on a DUPLICATE document
    5  performance               old vs new client, layer tree on vs off

Layer 4 duplicates whatever document is active, works on the copy, and closes it
without saving. It never writes to the original. If the active document changes
under it the run aborts rather than editing the wrong file - that nearly
happened once, and only a missing artboard name stopped it.

Everything here exists because it broke at least once. The classification table
in layer 0 is the clearest example: reading every AppError as "the app is alive"
shipped twice, and both times the symptom was a health check cheerfully
reporting apps that were not even open.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MCP = ROOT / "mcp"
sys.path.insert(0, str(MCP))
os.environ.setdefault("ADB_QUIET", "1")

import socket_client  # noqa: E402
from socket_client import AppError, app_is_alive, error_code  # noqa: E402

URL = os.environ.get("ADB_PROXY_URL", "http://localhost:3001")
APPS = ("photoshop", "illustrator", "aftereffects", "indesign", "premiere")

# ------------------------------------------------------------------ reporting

KQ = []          # (layer, name, ok, detail, skipped)
_layer = "?"


def layer(name):
    global _layer
    _layer = name
    print(f"\n\033[1m{name}\033[0m")


def ghi(name, ok, detail="", skipped=False):
    KQ.append((_layer, name, ok, detail, skipped))
    tag = "\033[33mBOQUA\033[0m" if skipped else (
        "\033[32mDAT  \033[0m" if ok else "\033[31mHONG \033[0m")
    print(f"  {tag} {name:<40} {detail}")


def thu(name, fn, kiem=None):
    """Run fn, judge with kiem, never let an exception kill the run."""
    try:
        r = fn()
        ok = kiem(r) if kiem else True
        ghi(name, ok, "" if ok else f"gia tri: {str(r)[:60]}")
        return r
    except Exception as e:                                   # noqa: BLE001
        ghi(name, False, f"{type(e).__name__}: {str(e)[:60]}")
        return None


# ------------------------------------------------------------------ transport

def send(app, action, opts=None, timeout=120, include_layers=False):
    socket_client.configure(app=app, url=URL, timeout=timeout)
    o = dict(opts or {})
    if app == "photoshop" and include_layers is not None:
        o["includeLayers"] = include_layers
    return socket_client.send_message_blocking(
        {"application": app, "action": action, "options": o}, timeout=timeout)


def ps(action, opts=None, timeout=120, include_layers=False):
    return send("photoshop", action, opts, timeout, include_layers).get("response")


def app_state(app):
    """'song' | 'chua noi' | 'khong ro' - the three states a probe must tell apart."""
    try:
        send(app, "__probe__", {}, timeout=8, include_layers=None)
        return "song"
    except AppError as e:
        return "song" if app_is_alive(e) else "chua noi"
    except Exception:                                        # noqa: BLE001
        return "chua noi"


# ------------------------------------------------------- 0. classification

def layer0():
    layer("Lop 0 — phan loai loi (logic thuan, khong can proxy)")

    def mk(msg, code=None):
        e = AppError(msg)
        if code is not None:
            e.code = code
        return e

    cases = [
        ("proxy moi: NOT_CONNECTED",
         mk("Error returned from ps: NOT_CONNECTED: no ps plugin", "NOT_CONNECTED"),
         "NOT_CONNECTED", False),
        ("proxy moi: APP_DISCONNECTED",
         mk("Error returned from ps: APP_DISCONNECTED: ps disconnected", "APP_DISCONNECTED"),
         "APP_DISCONNECTED", False),
        ("proxy moi: loi that cua app",
         mk("Error returned from ps: Error calling x : Unknown Command"), None, True),
        ("proxy CU: NOT_CONNECTED (chi co chuoi)",
         mk("Error returned from ps: NOT_CONNECTED: no ps plugin"), "NOT_CONNECTED", False),
        ("proxy CU: APP_DISCONNECTED (chi co chuoi)",
         mk("Error returned from ps: APP_DISCONNECTED: ps disconnected"),
         "APP_DISCONNECTED", False),
        # The two that make a naive substring check look correct until it isn't.
        ("loi app co chu 'disconnected'",
         mk("Error returned from ps: Error calling openFile : the drive was disconnected"),
         None, True),
        ("loi app co chu 'connection'",
         mk("Error returned from ps: Error calling x : connection refused by service"),
         None, True),
    ]
    for nhan, e, code_mong, song_mong in cases:
        c, s = error_code(e), app_is_alive(e)
        ghi(nhan, c == code_mong and s == song_mong, f"code={c}  con_song={s}")


# ------------------------------------------------------------- 1. the proxy

def layer1(quick):
    layer("Lop 1 — proxy (client gia)")

    # Bind: the proxy must not answer on a network interface. Anyone who reaches
    # it can run executeExtendScript, which reads and writes files.
    lan = subprocess.run(["ipconfig", "getifaddr", "en0"],
                         capture_output=True, text=True).stdout.strip()
    if lan:
        r = subprocess.run(
            ["curl", "-s", "-m", "4", "-o", "/dev/null", "-w", "%{http_code}",
             f"http://{lan}:3001/socket.io/?EIO=4&transport=polling"],
            capture_output=True, text=True).stdout.strip()
        ghi("khong nghe tren IP LAN", r in ("", "000"), f"{lan}:3001 -> {r or 'tu choi'}")
    else:
        ghi("khong nghe tren IP LAN", True, "khong co en0", skipped=True)

    r = subprocess.run(
        ["curl", "-s", "-m", "4", "-o", "/dev/null", "-w", "%{http_code}",
         "http://127.0.0.1:3001/socket.io/?EIO=4&transport=polling"],
        capture_output=True, text=True).stdout.strip()
    ghi("van nghe tren localhost", r == "200", f"127.0.0.1:3001 -> {r}")

    js = Path(__file__).parent / "selftest_socket.js"
    cmd = ["node", str(js)] + (["--quick"] if quick else [])
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    try:
        for t in json.loads(p.stdout.strip().splitlines()[-1]):
            ghi(t["name"], t["ok"], t["detail"], t.get("skipped"))
    except Exception as e:                                   # noqa: BLE001
        ghi("bo test socket (node)", False,
            f"{type(e).__name__}: {(p.stdout or p.stderr)[:80]}")


# --------------------------------------------------- 2. python client contract

def layer2():
    layer("Lop 2 — hop dong phia Python")

    def t_code_not_connected():
        try:
            send("selftest-nobody", "x", {}, timeout=20, include_layers=None)
            return "khong raise"
        except AppError as e:
            return e.code
    thu("socket_client: code=NOT_CONNECTED", t_code_not_connected,
        lambda r: r == "NOT_CONNECTED")

    def t_code_none():
        try:
            ps("lenhKhongTonTai", timeout=30)
            return "khong raise"
        except AppError as e:
            return e.code
    thu("socket_client: loi app -> code None", t_code_none, lambda r: r is None)

    sys.path.insert(0, str(Path.home() / ".claude/skills/psd-artboard-clone/scripts"))
    try:
        from bridge import call, probe, NotConnected     # noqa: PLC0415
    except Exception as e:                               # noqa: BLE001
        ghi("bridge: nap duoc", False, f"{type(e).__name__}: {e}")
        return

    def t_bridge_nc():
        try:
            call("selftest-nobody", "x", {}, timeout=20)
            return "khong raise"
        except NotConnected:
            return "NotConnected"
        except AppError:
            return "AppError"
    thu("bridge: NOT_CONNECTED -> NotConnected", t_bridge_nc,
        lambda r: r == "NotConnected")

    def t_bridge_app():
        try:
            call("photoshop", "lenhKhongTonTai", {"includeLayers": False}, timeout=30)
            return "khong raise"
        except NotConnected:
            return "NotConnected"
        except AppError:
            return "AppError"
    thu("bridge: loi app van la AppError", t_bridge_app, lambda r: r == "AppError")

    # probe() against a plugin that takes the command and dies. This is the case
    # that shipped broken: every AppError counted as proof of life, so a probe
    # vouched for an app that had just vanished.
    thu("probe(): plugin chet -> bao chet", lambda: _probe_dying(probe),
        lambda r: r is False)


def _probe_dying(probe):
    """Register a fake plugin that dies on the first command, then probe it."""
    import socketio                                          # noqa: PLC0415
    app = "selftest-dying"
    sio = socketio.Client(logger=False, reconnection=False)

    @sio.event
    def connect():                                           # noqa: ANN202
        sio.emit("register", {"application": app})

    @sio.on("command_packet")
    def _(data):                                             # noqa: ANN202
        sio.disconnect()

    sio.connect(URL, transports=["websocket"])
    time.sleep(0.5)
    try:
        return probe(apps=(app,))[app]
    finally:
        if sio.connected:
            sio.disconnect()


# ------------------------------------------------------------ 3. the five apps

def layer3():
    layer("Lop 3 — nam app Adobe (chi doc)")
    trang_thai = {}
    for a in APPS:
        trang_thai[a] = app_state(a)
        ghi(f"{a}: co noi khong", trang_thai[a] == "song", trang_thai[a])

    reads = {
        "aftereffects": ("getProjectInfo", lambda r: r is not None),
        "illustrator": ("getDocuments", lambda r: r is not None),
        "premiere": ("getProjectInfo", lambda r: r is not None),
    }
    for a, (action, kiem) in reads.items():
        if trang_thai.get(a) != "song":
            ghi(f"{a}: {action}", True, "app chua noi", skipped=True)
            continue

        def f(a=a, action=action):
            r = send(a, action, {}, timeout=45, include_layers=None).get("response")
            return json.loads(r) if isinstance(r, str) else r
        try:
            ghi(f"{a}: {action}", kiem(f()), "")
        except AppError as e:
            # An error the app itself produced still proves the round trip. The
            # obvious one: Premiere refuses getProjectInfo with no project open.
            ok = app_is_alive(e)
            ghi(f"{a}: {action}", ok,
                "loi nghiep vu cua app (van chung minh duong di thong)" if ok
                else str(e)[:60])
        except Exception as e:                               # noqa: BLE001
            ghi(f"{a}: {action}", False, f"{type(e).__name__}: {str(e)[:50]}")
    return trang_thai


# -------------------------------------------------- 4. Photoshop, on a copy

def _tree():
    return ps("getLayers")


def _flat(ls, out=None):
    out = [] if out is None else out
    for l in ls or []:
        out.append(l)
        _flat(l.get("layers"), out)
    return out


def _find(name):
    return next((l for l in _flat(_tree()) if l["name"] == name), None)


def layer4(mutate):
    layer("Lop 4 — Photoshop, moi nhom lenh (tren BAN SAO)")
    if app_state("photoshop") != "song":
        ghi("photoshop", True, "chua noi — bo qua ca lop", skipped=True)
        return
    if not mutate:
        ghi("cac lenh sua", True, "bo qua (--no-mutate)", skipped=True)
        return

    goc = ps("getDocumentInfo")
    if not goc or not goc.get("width"):
        ghi("co tai lieu mo", False, "khong co tai lieu nao")
        return

    truoc = {d["id"] for d in ps("getDocuments")}
    ps("duplicateDocument", {"name": "ZZZ_SELFTEST_XOA_DI"}, timeout=300)
    moi = [d for d in ps("getDocuments") if d["id"] not in truoc]
    if len(moi) != 1:
        ghi("tao ban sao", False, f"mong 1 ban sao, thay {len(moi)}")
        return
    dup = moi[0]["id"]
    ps("setActiveDocument", {"documentId": dup})
    if (send("photoshop", "getDocumentInfo").get("document") or {}).get("id") != dup:
        ghi("chuyen sang ban sao", False, "khong chuyen duoc — khong sua gi")
        return
    ghi("tao + chuyen sang ban sao", True, f"id={dup}")

    try:
        _layer4_body()
    finally:
        # Only ever close the copy. Getting this wrong closes someone's job file.
        now = (send("photoshop", "getDocumentInfo").get("document") or {}).get("id")
        if now == dup:
            ps("executeBatchPlayCommand",
               {"commands": [{"_obj": "close",
                              "saving": {"_enum": "yesNo", "_value": "no"}}]},
               timeout=300)
            con = {d["id"] for d in ps("getDocuments")}
            ghi("dong ban sao, giu nguyen ban goc", dup not in con,
                "da dong" if dup not in con else "KHONG dong duoc")
        else:
            ghi("dong ban sao, giu nguyen ban goc", False,
                f"active la {now}, khong phai ban sao — de nguyen, dong tay")


def _layer4_body():
    t = _tree()
    la = next(l for l in _flat(t)
              if l["type"] in ("PIXEL", "SHAPE", "SOLIDCOLOR", "SMARTOBJECT"))
    tx = next((l for l in _flat(t) if l["type"] == "TEXT"), None)
    lid = la["id"]

    def sel(i):
        return ps("executeBatchPlayCommand", {"commands": [
            {"_obj": "select", "_target": [{"_ref": "layer", "_id": i}],
             "makeVisible": False}]})

    def bnd(i):
        b = ps("getLayerBounds", {"layerId": i})
        return (b["left"], b["top"], b["right"], b["bottom"])

    # reads
    thu("getDocumentInfo", lambda: ps("getDocumentInfo"), lambda r: r["width"] > 0)
    thu("getLayers", lambda: ps("getLayers"), lambda r: isinstance(r, list) and r)
    thu("getArtboards", lambda: ps("getArtboards"), lambda r: r is not None)
    thu("getDocuments", lambda: ps("getDocuments"), lambda r: len(r) >= 2)
    thu("getLayerBounds", lambda: ps("getLayerBounds", {"layerId": lid}),
        lambda r: "left" in r)
    thu("getLayerEffects", lambda: ps("getLayerEffects", {"layerId": lid}),
        lambda r: True)
    if tx:
        thu("getTextStyle", lambda: ps("getTextStyle", {"layerId": tx["id"]}),
            lambda r: r is not None)
    thu("executeBatchPlayCommand", lambda: ps("executeBatchPlayCommand", {"commands": [
        {"_obj": "get", "_target": [
            {"_ref": "property", "_property": "numberOfDocuments"},
            {"_ref": "application", "_enum": "ordinal", "_value": "targetEnum"}]}]}),
        lambda r: r is not None)

    # transforms - every one read back, never trusting the return value
    o = bnd(lid)
    sel(lid); ps("translateLayer", {"layerId": lid, "xOffset": 5, "yOffset": 9})
    ghi("translateLayer", bnd(lid) == (o[0] + 5, o[1] + 9, o[2] + 5, o[3] + 9),
        f"{o} -> {bnd(lid)}")

    w0 = o[2] - o[0]
    sel(lid); ps("scaleLayer", {"layerId": lid, "width": 150, "height": 150,
                                "anchorPosition": "MIDDLECENTER",
                                "interpolationMethod": "BICUBIC"})
    b = bnd(lid)
    ghi("scaleLayer", abs((b[2] - b[0]) - w0 * 1.5) <= 2,
        f"rong {w0} -> {b[2]-b[0]} (mong ~{w0*1.5:.0f})")

    sel(lid); thu("rotateLayer", lambda: ps("rotateLayer", {
        "layerId": lid, "angle": 15, "anchorPosition": "MIDDLECENTER",
        "interpolationMethod": "BICUBIC"}) or True)
    sel(lid); thu("flipLayer", lambda: ps("flipLayer", {
        "layerId": lid, "axis": "horizontal"}) or True)
    sel(lid); thu("moveLayer", lambda: ps("moveLayer", {
        "layerId": lid, "position": "UP"}) or True)

    # properties
    ps("setLayerVisibility", {"layerId": lid, "visible": False})
    ghi("setLayerVisibility", (_find(la["name"]) or {}).get("visible") is False,
        "an roi doc lai")
    ps("setLayerVisibility", {"layerId": lid, "visible": True})

    ps("renameLayer", {"layerId": lid, "newLayerName": "ZZZ_DOI_TEN"})
    ghi("renameLayer", _find("ZZZ_DOI_TEN") is not None, "doi ten roi doc lai")

    ps("setLayerProperties", {"layerId": lid, "layerOpacity": 55})
    ghi("setLayerProperties", (_find("ZZZ_DOI_TEN") or {}).get("opacity") == 55,
        "opacity 55")

    # structure
    ps("duplicateLayer", {"sourceLayerId": lid, "duplicateLayerName": "ZZZ_BAN_SAO"})
    d = _find("ZZZ_BAN_SAO")
    ghi("duplicateLayer", d is not None, "tao ban sao layer")
    if d:
        ps("groupLayers", {"groupName": "ZZZ_NHOM", "layerIds": [d["id"]]})
        ghi("groupLayers", _find("ZZZ_NHOM") is not None, "gom nhom")
        ps("deleteLayer", {"layerId": d["id"]})
        ghi("deleteLayer", _find("ZZZ_BAN_SAO") is None, "xoa roi doc lai")

    # text
    ps("createSingleLineTextLayer", {
        "layerName": "ZZZ_CHU", "contents": "xin chao", "fontSize": 48,
        "opacity": 100, "position": {"x": 200, "y": 200}, "fontName": "ArialMT",
        "textColor": {"red": 255, "green": 0, "blue": 0}, "blendMode": "NORMAL"})
    c = _find("ZZZ_CHU")
    ghi("createSingleLineTextLayer", c is not None, "tao layer chu")
    if c:
        ps("editTextLayer", {"layerId": c["id"], "contents": "da sua"})
        got = (_find("ZZZ_CHU") or {}).get("textInfo", {}).get("text")
        ghi("editTextLayer", got == "da sua", f"noi dung = {got!r}")

    # style + selection
    ps("addDropShadowLayerStyle", {
        "layerId": lid, "blendMode": "MULTIPLY",
        "color": {"red": 0, "green": 0, "blue": 0}, "opacity": 50,
        "angle": 120, "distance": 5, "spread": 0, "size": 5})
    e = ps("getLayerEffects", {"layerId": lid})
    ghi("addDropShadowLayerStyle", bool(e) and "dropShadow" in json.dumps(e),
        "doc lai co dropShadow")

    thu("selectRectangle", lambda: ps("selectRectangle", {
        "layerId": lid, "feather": 0, "antiAlias": True,
        "bounds": {"top": 10, "left": 10, "bottom": 100, "right": 100}}) or True)

    # error path
    try:
        ps("lenhKhongTonTai")
        ghi("loi -> AppError", False, "khong raise")
    except AppError as e:
        ghi("loi -> AppError", app_is_alive(e), "code=None, dung la loi cua app")

    # includeLayers invariant: same command, tree on and off, envelopes must be
    # identical apart from `layers` itself.
    for ten, act, opt in (("doc-info", "getDocumentInfo", {}),
                          ("artboards", "getArtboards", {}),
                          ("documents", "getDocuments", {})):
        pb = send("photoshop", act, opt, include_layers=True)
        pt = send("photoshop", act, opt, include_layers=False)
        strip = lambda p: {k: v for k, v in p.items()          # noqa: E731
                           if k not in ("layers", "senderId")}
        ok = strip(pb) == strip(pt) and "layers" in pb and "layers" not in pt
        ghi(f"includeLayers bat bien: {ten}", ok,
            f"{len(json.dumps(pb))/1024:.1f} KB -> {len(json.dumps(pt))/1024:.1f} KB")


# --------------------------------------------------------------- 5. perf

def layer5(trang_thai):
    layer("Lop 5 — do hieu nang")
    src = (MCP / "socket_client.py").read_text()
    if "client_thread.join(timeout=0.05)" not in src:
        ghi("do A/B", True, "khong tim thay patch join — bo qua", skipped=True)
        return

    tmp = Path(tempfile.mkdtemp(prefix="adb-selftest-"))
    try:
        old_path = tmp / "sc_old.py"
        old_path.write_text(src.replace("client_thread.join(timeout=0.05)",
                                        "client_thread.join(timeout=1)"))
        spec = importlib.util.spec_from_file_location("sc_old", old_path)
        old = importlib.util.module_from_spec(spec)
        sys.modules["sc_old"] = old
        spec.loader.exec_module(old)

        def t(mod, app):
            mod.configure(app=app, url=URL, timeout=30)
            t0 = time.perf_counter()
            try:
                mod.send_message_blocking(
                    {"application": app, "action": "lenhKhongTonTai", "options": {}},
                    timeout=30)
            except (AppError, old.AppError):
                pass
            except Exception:                                # noqa: BLE001
                return None
            return time.perf_counter() - t0

        print(f"    {'app':<14} {'client cu':>11} {'client moi':>11} {'nhanh hon':>10}")
        for a in APPS:
            if trang_thai.get(a) != "song":
                print(f"    {a:<14} {'chua noi':>11}")
                continue
            tn = [t(socket_client, a) for _ in range(5)]
            to = [t(old, a) for _ in range(5)]
            if any(x is None for x in tn + to):
                print(f"    {a:<14} {'do that bai':>11}")
                continue
            o_, n_ = statistics.median(to), statistics.median(tn)
            print(f"    {a:<14} {o_*1000:9.0f} ms {n_*1000:9.0f} ms {o_/n_:9.1f}x")
            ghi(f"{a}: client moi nhanh hon", o_ / n_ > 5, f"{o_/n_:.1f}x")

        if trang_thai.get("photoshop") == "song":
            def one(inc):
                t0 = time.perf_counter()
                send("photoshop", "getDocumentInfo", {}, include_layers=inc)
                return time.perf_counter() - t0
            for _ in range(2):
                one(True)
            a_on = statistics.median([one(True) for _ in range(5)])
            a_off = statistics.median([one(False) for _ in range(5)])
            print(f"\n    Photoshop getDocumentInfo:  co cay {a_on*1000:.0f} ms"
                  f"   ·   tat cay {a_off*1000:.0f} ms   ({a_on/a_off:.1f}x)")
            ghi("tat cay layer nhanh hon", a_on / a_off > 2, f"{a_on/a_off:.1f}x")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true",
                    help="bo qua test khoa 60s va phan do hieu nang")
    ap.add_argument("--no-mutate", action="store_true",
                    help="chi doc, khong tao ban sao va khong sua gi")
    a = ap.parse_args()

    t0 = time.time()
    print(f"\nadb-mcp selftest — proxy {URL}")
    layer0()
    layer1(a.quick)
    layer2()
    trang_thai = layer3()
    layer4(not a.no_mutate)
    if not a.quick:
        layer5(trang_thai)

    dat = sum(1 for *_, ok, _, sk in [(x[0], x[1], x[2], x[3], x[4]) for x in KQ]
              if ok and not sk)
    hong = [x for x in KQ if not x[2] and not x[4]]
    boqua = sum(1 for x in KQ if x[4])

    print(f"\n\033[1m=== {dat} dat · {len(hong)} hong · {boqua} bo qua"
          f"  ({time.time()-t0:.0f}s) ===\033[0m")
    for lop, ten, _, chi_tiet, _ in hong:
        print(f"  \033[31mHONG\033[0m [{lop.split('—')[0].strip()}] {ten}  {chi_tiet}")
    return 1 if hong else 0


if __name__ == "__main__":
    sys.exit(main())
