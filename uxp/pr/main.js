/* MIT License
 *
 * Copyright (c) 2025 Mike Chambers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const { entrypoints } = require("uxp");
const { io } = require("./socket.io.js");
const os = require("os");

const { getSequences } = require("./commands/utils.js");

const {
    getProjectInfo,
    parseAndRouteCommand,
    checkRequiresActiveProject,
} = require("./commands/index.js");

const IS_WINDOWS = os.platform() === "win32"; // "darwin" on Mac

const APPLICATION = "premiere";
const PROXY_URL = "http://localhost:3001";

let socket = null;

const onCommandPacket = async (packet) => {
    let command = packet.command;

    let out = {
        senderId: packet.senderId,
    };

    try {
        //this will throw if an active document is required and not open
        await checkRequiresActiveProject(command);

        let response = await parseAndRouteCommand(command);

        out.response = response;
        out.status = "SUCCESS";
        out.sequences = await getSequences();
        out.project = await getProjectInfo();
    } catch (e) {
        console.log(e);

        out.status = "FAILURE";
        out.message = `Error calling ${command.action} : ${e}`;
    }

    return out;
};

function connectToServer() {
    // Create new Socket.IO connection
    socket = io(PROXY_URL, {
        transports: IS_WINDOWS ? ["polling"] : ["websocket"],
    });

    socket.on("connect", () => {
        updateButton();
        console.log("Connected to server with ID:", socket.id);
        socket.emit("register", { application: APPLICATION });
        // Deliver anything that finished while the socket was down. The proxy
        // routes by the packet's senderId, not by ours, so a new socket id here
        // does not matter.
        flushPendingResponses();
    });

    socket.on("command_packet", async (packet) => {
        console.log("Received command packet:", packet);

        let response = await onCommandPacket(packet);
        sendResponsePacket(response);
    });

    socket.on("registration_response", (data) => {
        console.log("Received response:", data);
        //TODO: connect button here
    });

    socket.on("connect_error", (error) => {
        updateButton();
        console.error("Connection error:", error);
    });

    socket.on("disconnect", (reason) => {
        updateButton();
        console.log("Disconnected from server. Reason:", reason);

        //TODO:connect button here
    });

    return socket;
}

function disconnectFromServer() {
    if (socket && socket.connected) {
        socket.disconnect();
        console.log("Disconnected from server");
    }
}

// A socket that dies while a command is running does not undo the command: the
// app has already applied it. Throwing the response away here is what turned a
// one-second blip into "Connection Timed Out" for work that was in fact done -
// and a blind retry then applies it twice. Hold it and flush on reconnect; the
// caller is normally still waiting, because its own timeout is far longer than
// the second or so socket.io takes to come back.
const PENDING_MAX = 32;
const PENDING_TTL_MS = 10 * 60 * 1000;
let pendingResponses = [];

function flushPendingResponses() {
    if (!pendingResponses.length || !socket || !socket.connected) return;
    const now = Date.now();
    const live = pendingResponses.filter((p) => now - p.at < PENDING_TTL_MS);
    const stale = pendingResponses.length - live.length;
    pendingResponses = [];
    for (const p of live) {
        socket.emit("command_packet_response", { packet: p.packet });
    }
    console.log(
        `Flushed ${live.length} buffered response(s)` +
            (stale ? `, dropped ${stale} past their ${PENDING_TTL_MS / 60000} min TTL` : "")
    );
}

function sendResponsePacket(packet) {
    if (socket && socket.connected) {
        socket.emit("command_packet_response", {
            packet: packet,
        });
        return true;
    }
    // Cap the buffer: nobody is still waiting on an ancient response, and an
    // unbounded list would keep every reply from a long offline stretch.
    pendingResponses.push({ packet: packet, at: Date.now() });
    if (pendingResponses.length > PENDING_MAX) pendingResponses.shift();
    console.log(
        `Socket down; holding response for ${packet.senderId} ` +
            `(${pendingResponses.length} pending)`
    );
    return false;
}

function sendCommand(command) {
    if (socket && socket.connected) {
        socket.emit("app_command", {
            application: APPLICATION,
            command: command,
        });
        return true;
    }
    return false;
}

entrypoints.setup({
    panels: {
        vanilla: {
            show(node) {},
        },
    },
});

let updateButton = () => {
    let b = document.getElementById("btnStart");

    b.textContent = socket && socket.connected ? "Disconnect" : "Connect";
};

//Toggle button to make it start stop
document.getElementById("btnStart").addEventListener("click", () => {
    if (socket && socket.connected) {
        disconnectFromServer();
    } else {
        connectToServer();
    }
});

const CONNECT_ON_LAUNCH = "connectOnLaunch";
// Save checkbox state in localStorage
document
    .getElementById("chkConnectOnLaunch")
    .addEventListener("change", function (event) {
        window.localStorage.setItem(
            CONNECT_ON_LAUNCH,
            JSON.stringify(event.target.checked),
        );
    });

// Retrieve checkbox state
const getConnectOnLaunch = () => {
    return JSON.parse(window.localStorage.getItem(CONNECT_ON_LAUNCH)) || false;
};

// Set checkbox state on page load
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("chkConnectOnLaunch").checked =
        getConnectOnLaunch();
});

window.addEventListener("load", (event) => {
    if (getConnectOnLaunch()) {
        connectToServer();
    }
});
