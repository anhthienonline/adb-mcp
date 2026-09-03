#!/usr/bin/env node
/*
 * Socket-level tests for the proxy. Driven by selftest.py, which reads the JSON
 * array printed on the last line.
 *
 * These live in node rather than python for one reason: socket.io's python
 * client runs its own background thread, so blocking the main thread does not
 * block the client, and the ping-timeout case cannot be reproduced. Node's
 * single event loop blocks the way a UXP plugin blocks on a long batchPlay,
 * which is exactly the failure being tested.
 *
 *   node selftest_socket.js [--quick]      --quick skips the 60 s block test
 */
const path = require("path");
const CLIENT = path.join(__dirname, "..", "adb-proxy-socket", "node_modules", "socket.io-client");
const { io } = require(CLIENT);

const URL = process.env.ADB_PROXY_URL || "http://127.0.0.1:3001";
const QUICK = process.argv.includes("--quick");
const GRACE_MS = 5000; // must match proxy.js; a mismatch shows up as T6 timing out

const out = [];
const add = (name, ok, detail, skipped) =>
    out.push({ name, ok: !!ok, detail: String(detail), skipped: !!skipped });

const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const onceConnected = (s) => new Promise((r) => s.on("connect", r));

// A caller that records WHEN each packet arrived. Measuring at report time
// instead of arrival time made an instant reply look like a 15 s one during
// development - the number was the length of the wait window, not the latency.
function recorder(s) {
    const got = [];
    const t0 = Date.now();
    s.on("packet_response", (p) => got.push({ p, at: Date.now() - t0 }));
    return got;
}

// ---------------------------------------------------------------- the tests

// The plugin's event loop is blocked for 60 s. It must survive: anything that
// drops here is dropped mid-command, and the response is then lost.
async function blockedClientSurvives() {
    if (QUICK) return add("khoa event loop 60s", true, "bo qua (--quick)", true);
    const s = conn();
    let reason = null;
    await onceConnected(s);
    s.emit("register", { application: "selftest-block" });
    s.on("disconnect", (r) => (reason = r));
    await wait(500);
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {} // a real block, not a sleep
    await wait(3000);
    const alive = s.connected && !reason;
    s.close();
    add("khoa event loop 60s", alive, alive ? "SONG" : `NGAT (${reason})`);
}

// No plugin registered. The packet used to be dropped in silence and the caller
// waited out its whole timeout, then blamed the connection.
async function undeliverableIsReported() {
    const s = conn();
    await onceConnected(s);
    const got = recorder(s);
    s.emit("command_packet", {
        application: "selftest-nobody",
        command: { application: "selftest-nobody", action: "getDocumentInfo", options: {} },
    });
    await wait(5000);
    s.close();
    const r = got[0];
    add(
        "khong co client -> NOT_CONNECTED",
        r && r.p.code === "NOT_CONNECTED",
        r ? `${r.at} ms, code=${r.p.code}` : "im lang, khong hoi am"
    );
}

// Two panels registered as one application used to BOTH receive the command,
// so a scaleLayer ran twice.
async function registerReplaces() {
    const a = conn(), b = conn();
    await Promise.all([onceConnected(a), onceConnected(b)]);
    let n = 0;
    a.on("command_packet", () => n++);
    b.on("command_packet", () => n++);
    a.emit("register", { application: "selftest-dup" });
    await wait(300);
    b.emit("register", { application: "selftest-dup" });
    await wait(300);
    const s = conn();
    await onceConnected(s);
    s.emit("command_packet", {
        application: "selftest-dup",
        command: { application: "selftest-dup", action: "noop", options: {} },
    });
    await wait(2000);
    a.close(); b.close(); s.close();
    add("dang ky trung -> 1 client", n === 1, `lenh den ${n} client`);
}

// The app quits holding the command. The caller must be told, and told that the
// work may already be done - a blind retry there applies it twice.
async function deadPluginIsReported() {
    const pl = conn();
    await onceConnected(pl);
    pl.emit("register", { application: "selftest-dead" });
    await wait(300);
    const s = conn();
    await onceConnected(s);
    const got = recorder(s);
    pl.on("command_packet", () => pl.close());
    s.emit("command_packet", {
        application: "selftest-dead",
        command: { application: "selftest-dead", action: "viecDai", options: {} },
    });
    await wait(GRACE_MS + 4000);
    s.close();
    const r = got[0];
    add(
        "plugin chet han -> APP_DISCONNECTED",
        r && r.p.code === "APP_DISCONNECTED",
        r ? `${r.at} ms, code=${r.p.code}` : "khong duoc bao"
    );
}

// The one the grace period exists for: a plugin that merely blipped comes back
// and delivers the real answer. Reporting the disconnect immediately would have
// made the caller give up on a command that was about to succeed.
async function reconnectBeatsTheNotice() {
    let pl = conn();
    await onceConnected(pl);
    pl.emit("register", { application: "selftest-blip" });
    await wait(300);
    const s = conn();
    await onceConnected(s);
    const got = recorder(s);

    pl.on("command_packet", async (pkt) => {
        pl.close();
        await wait(2000); // back well inside the grace period
        pl = conn();
        await onceConnected(pl);
        pl.emit("register", { application: "selftest-blip" });
        pl.emit("command_packet_response", {
            packet: { senderId: pkt.senderId, status: "SUCCESS", response: "ket qua that" },
        });
    });
    s.emit("command_packet", {
        application: "selftest-blip",
        command: { application: "selftest-blip", action: "viecDai", options: {} },
    });

    await wait(GRACE_MS + 5000);
    s.close();
    pl.close();
    const ok = got.length === 1 && got[0].p.status === "SUCCESS";
    add(
        "rot roi quay lai -> ket qua that",
        ok,
        `nhan ${got.length} goi [${got.map((x) => x.p.code || x.p.status).join(", ")}]` +
            (got.length ? ` sau ${got[0].at} ms` : "")
    );
}

(async () => {
    await undeliverableIsReported();
    await registerReplaces();
    await deadPluginIsReported();
    await reconnectBeatsTheNotice();
    await blockedClientSurvives(); // last: it is the slow one
    console.log(JSON.stringify(out));
    process.exit(0);
})().catch((e) => {
    add("bo test socket", false, `crash: ${e && e.message}`);
    console.log(JSON.stringify(out));
    process.exit(1);
});
