#!/usr/bin/env python3
"""Dong goi quyen Claude Code cua repo nay va bung lai dung path tren may khac.

    ./sync-claude-settings.py export                 # -> ~/Downloads/claude-settings-portable.json
    ./sync-claude-settings.py install <bundle.json>  # tren may moi

Ly do phai co script: rule Bash so khop TEXT LENH NGUYEN VAN, khong giãn `~`.
Nen rule Bash nao chua duong dan home phai duoc ghi lai bang path tuyet doi cua
tung may. Read/Edit/Write/additionalDirectories thi nguoc lai - `~` chay tot,
de nguyen dang `~` cho file sach.

export  : /Users/<ai-do>  -> __HOME__ ; /private/tmp/claude-<uid> -> claude-__UID__
install : __HOME__ -> path tuyet doi (rule Bash) hoac `~` (rule con lai)
          __UID__  -> uid that cua may dich
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime

PERM_LISTS = ("allow", "deny", "ask", "additionalDirectories")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
TMP_RE = re.compile(r"(/private)?/tmp/claude-\d+")
FORMAT = "adb-mcp/claude-settings-portable/1"


# ---------------------------------------------------------------- helpers

def die(msg):
    print(f"LOI: {msg}", file=sys.stderr)
    sys.exit(1)


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except json.JSONDecodeError as exc:
            die(f"{path} khong phai JSON hop le: {exc}")


def dump_json(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def dedupe(items):
    seen, out = set(), []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def perm_lists(settings):
    """Yield (list_name, list_object) cho moi list quyen co trong settings."""
    perms = settings.get("permissions")
    if isinstance(perms, dict):
        for name in PERM_LISTS:
            if isinstance(perms.get(name), list):
                yield name, perms[name]


# ---------------------------------------------------------------- export

def to_placeholder(rule, home):
    rule = TMP_RE.sub("/private/tmp/claude-__UID__", rule)
    return rule.replace(home, "__HOME__")


def export_settings(settings, home, report):
    """Tra ve ban copy da placeholder-hoa, bo cac rule vo dung vinh vien."""
    out = json.loads(json.dumps(settings))
    for name, lst in perm_lists(out):
        kept = []
        for rule in lst:
            if not isinstance(rule, str):
                kept.append(rule)
                continue
            if UUID_RE.search(rule):
                # Path scratchpad cua 1 session cu the -> khong bao gio khop lai,
                # ke ca tren chinh may nay. Bo han.
                report["dropped"].append(rule)
                continue
            new = to_placeholder(rule, home)
            if new != rule:
                report["rewritten"].append((rule, new))
            kept.append(new)
        lst[:] = dedupe(kept)
    return out


def cmd_export(args):
    src = os.path.abspath(args.dir)
    project_path = os.path.join(src, "settings.json")
    local_path = os.path.join(src, "settings.local.json")
    if not os.path.isfile(project_path) and not os.path.isfile(local_path):
        die(f"khong thay settings.json hay settings.local.json trong {src}")

    home = os.path.expanduser("~").rstrip("/")
    report = {"dropped": [], "rewritten": []}
    bundle = {
        "_format": FORMAT,
        "_howto": [
            "Chay tren may dich: ./sync-claude-settings.py install <file nay>",
            "__HOME__ se thanh path tuyet doi trong rule Bash, thanh ~ trong rule con lai.",
            "__UID__ se thanh `id -u` cua may dich.",
        ],
    }
    for key, path in (("project", project_path), ("local", local_path)):
        if os.path.isfile(path):
            bundle[key] = export_settings(load_json(path), home, report)

    # Rule nao project settings.json da co thi local khong can lap lai.
    pruned = 0
    if "project" in bundle and "local" in bundle:
        project_sets = {n: set(l) for n, l in perm_lists(bundle["project"])}
        for name, lst in perm_lists(bundle["local"]):
            before = len(lst)
            lst[:] = [r for r in lst if r not in project_sets.get(name, ())]
            pruned += before - len(lst)

    out = os.path.abspath(args.out)
    guard_output_path(out, args.force)
    dump_json(out, bundle)

    print(f"Da ghi {out}")
    for key in ("project", "local"):
        if key in bundle:
            counts = ", ".join(f"{n}={len(l)}" for n, l in perm_lists(bundle[key]))
            print(f"  {key:<8} {counts}")
    print(f"  bo {len(report['dropped'])} rule dinh session UUID (khong bao gio khop lai)")
    for rule in report["dropped"]:
        print(f"      - {rule[:110]}")
    print(f"  placeholder-hoa {len(report['rewritten'])} rule co path cua may nay")
    for old, new in report["rewritten"]:
        print(f"      ~ {new[:110]}")
    if pruned:
        print(f"  bo {pruned} rule trong local da co san trong settings.json")


def guard_output_path(out, force):
    """Repo nay PUBLIC. Chan ghi bundle vao mot duong dan se bi commit."""
    if force:
        return
    d = os.path.dirname(out) or "."
    # Fail CLOSED. Truoc day exception -> return, tuc guard tu bien mat dung tren
    # loai may ma repo nay quan tam nhat: chua cai Xcode developer tools thi
    # /usr/bin/git khong chay duoc. Guard bao ve repo public thi khong xac dinh
    # duoc phai coi la nguy hiem, khong phai coi la an toan.
    try:
        inside = subprocess.run(
            ["git", "-C", d, "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip() == "true"
        if not inside:
            return
        ignored = subprocess.run(
            ["git", "-C", d, "check-ignore", "-q", out], capture_output=True, timeout=10
        ).returncode == 0
    except (OSError, subprocess.SubprocessError) as exc:
        die(
            f"khong chay duoc `git` de biet {out} co nam trong repo public khong ({exc}).\n"
            "     Chon --out ngoai repo (mac dinh ~/Downloads), hoac --force neu chac chan."
        )
    if ignored:
        return
    die(
        f"{out} nam trong git repo va KHONG bi .gitignore chan.\n"
        "     Bundle chua path job/ten file khach hang - dung de no vao repo public.\n"
        "     Chon --out ngoai repo (mac dinh ~/Downloads), hoac --force neu chac chan."
    )


# ---------------------------------------------------------------- install

def from_placeholder(rule, home, uid):
    rule = rule.replace("__UID__", uid)
    if "__HOME__" not in rule:
        return rule
    # Rule Bash so khop text nguyen van -> phai la path tuyet doi.
    # Read/Edit/Write/additionalDirectories thi giãn `~` -> giu `~` cho gon.
    return rule.replace("__HOME__", home if rule.startswith("Bash(") else "~")


def merge_into(target, incoming, home, uid, log):
    """Merge incoming vao target. Union list quyen, khong dap key co san."""
    for name, lst in perm_lists(incoming):
        resolved = dedupe([from_placeholder(r, home, uid) if isinstance(r, str) else r
                           for r in lst])
        cur = target.setdefault("permissions", {}).setdefault(name, [])
        added = [r for r in resolved if r not in cur]
        cur.extend(added)
        target["permissions"][name] = dedupe(cur)
        log.append(f"{name}: +{len(added)} moi, tong {len(target['permissions'][name])}")
        # In tung rule mot. Bundle di qua Teams/Dropbox, nen "+12 moi" khong cho
        # nguoi nhan biet ho vua cap quyen gi cho Claude tren may minh.
        for rule in added:
            log.append(f"    + {rule}")

    for key, value in incoming.items():
        if key in ("permissions",) or key.startswith("_"):
            continue
        if key in target:
            log.append(f"{key}: giu nguyen ban co san tren may nay")
        else:
            target[key] = value
            log.append(f"{key}: lay tu bundle")


def cmd_install(args):
    bundle = load_json(args.bundle)
    if bundle.get("_format") != FORMAT:
        die(f"{args.bundle} khong phai bundle cua script nay (_format = {bundle.get('_format')!r})")

    home = os.path.expanduser("~").rstrip("/")
    uid = str(os.getuid())
    dest = os.path.abspath(args.dir)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    print(f"May nay: home={home} uid={uid}")
    print(f"Ghi vao: {dest}{'  (DRY RUN)' if args.dry_run else ''}\n")

    for key, filename in (("project", "settings.json"), ("local", "settings.local.json")):
        if key not in bundle:
            continue
        path = os.path.join(dest, filename)
        target = load_json(path) if os.path.isfile(path) else {}
        log = []
        merge_into(target, bundle[key], home, uid, log)
        print(f"{filename}")
        for line in log:
            print(f"  {line}")
        if args.dry_run:
            print("  (dry-run: khong ghi)\n")
            continue
        os.makedirs(dest, exist_ok=True)
        if os.path.isfile(path):
            backup = f"{path}.{stamp}.bak"
            shutil.copy2(path, backup)
            print(f"  backup -> {os.path.basename(backup)}")
        dump_json(path, target)
        print("  da ghi\n")

    if not args.dry_run:
        print("Xong. Mo lai Claude Code trong repo de nap quyen moi.")


# ---------------------------------------------------------------- cli

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("export", help="dong goi quyen cua may nay thanh bundle portable")
    e.add_argument("--dir", default=os.path.join(here, ".claude"),
                   help="thu muc chua settings.json (mac dinh: <repo>/.claude)")
    e.add_argument("--out", default=os.path.expanduser("~/Downloads/claude-settings-portable.json"),
                   help="file bundle ghi ra")
    e.add_argument("--force", action="store_true",
                   help="ghi ke ca khi duong dan se bi commit vao repo public")
    e.set_defaults(func=cmd_export)

    i = sub.add_parser("install", help="bung bundle vao may nay")
    i.add_argument("bundle")
    i.add_argument("--dir", default=os.path.join(here, ".claude"),
                   help="thu muc .claude cua repo dich")
    i.add_argument("--dry-run", action="store_true", help="chi in ra, khong ghi file")
    i.set_defaults(func=cmd_install)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
