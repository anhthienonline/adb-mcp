#!/usr/bin/env node

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

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 50 * 1024 * 1024,

    // A UXP plugin runs on the host app's JS thread, so a long batchPlay -
    // opening a big psd, an export, a saveAs - blocks its event loop and it
    // cannot answer a ping. With socket.io's defaults (25 s / 20 s) anything
    // that blocks for ~45 s is declared dead mid-command. Measured here: a
    // client blocked 30 s survives, one blocked 60 s is dropped with
    // "transport close".
    //
    // 120 s is NOT chosen as "longer than anything Adobe can do" - that would
    // be a guess, and a 2 GB psb would make it a wrong one. It is roughly 15x
    // the heaviest single operation actually measured on this machine
    // (duplicating a 15231x1924 document, 2.7-8.1 s). Everything past it is
    // covered by the plugin holding its response and flushing it on reconnect,
    // which is what makes a drop survivable rather than fatal.
    //
    // Do not raise this to hide a missing buffer on the plugin side. The cost
    // of every extra second is a longer window in which a client that died
    // WITHOUT closing its socket (laptop asleep, network gone) still counts as
    // registered - during which packets are delivered into nothing and the
    // caller waits out its own timeout, which is the exact failure this whole
    // patch exists to remove.
    pingInterval: 25000,
    pingTimeout: 120000,
});

const PORT = 3001;
// Track clients by application
const applicationClients = {};

// Packets handed to a plugin that have not been answered yet, keyed by the
// PLUGIN's socket id -> Map(senderId -> action). Without this the proxy has no
// idea anyone is waiting: when an app quits or crashes mid-command its socket
// just closes, and the caller sits there until its own timeout expires - 45 s
// normally, 900 s on a long command - then blames the connection. Reproduced
// with a client that took a packet and disconnected without replying: the
// sender heard nothing at all.
const inFlight = new Map();

// Telling a caller "the app disconnected" the instant the socket drops fights
// the plugin's own recovery: a plugin that was merely blocked reconnects about
// a second later and flushes the response it held. Announce the failure too
// early and the caller has already given up on a command that was about to
// answer correctly. So the notice waits out a grace period, and any response
// that arrives for that caller - from the reconnected socket or any other -
// cancels it.
const GRACE_MS = 5000;
const choBao = new Map(); // senderId -> timer

const ghiNhoDangBay = (targetId, senderId, action) => {
    if (!inFlight.has(targetId)) inFlight.set(targetId, new Map());
    inFlight.get(targetId).set(senderId, action);
};

const xoaDangBay = (targetId, senderId) => {
    const m = inFlight.get(targetId);
    if (m) {
        m.delete(senderId);
        if (m.size === 0) inFlight.delete(targetId);
    }
    huyBao(senderId);
};

const huyBao = (senderId) => {
    const t = choBao.get(senderId);
    if (t) {
        clearTimeout(t);
        choBao.delete(senderId);
    }
};

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("register", ({ application }) => {
        console.log(
            `Client ${socket.id} registered for application: ${application}`
        );

        // Store the application preference with this socket
        socket.data.application = application;

        // One live panel per application: the newest registration REPLACES any
        // earlier one. Reloading a plugin in UXP Developer Tool, or opening its
        // panel twice, used to leave both sockets in this set - and because
        // sendToApplication() emits to every id in it, the same command then ran
        // twice in the app. Reproduced: two clients registered as one
        // application, one command_packet, delivered to both. For a read that is
        // merely wasteful; for scaleLayer or translateLayer it silently applies
        // the operation twice.
        const truoc = applicationClients[application];
        if (truoc && truoc.size && !truoc.has(socket.id)) {
            console.log(
                `Replacing ${truoc.size} earlier registration(s) for ${application}: ` +
                    `${[...truoc].join(", ")}`
            );
        }
        applicationClients[application] = new Set([socket.id]);

        // Optionally confirm registration
        socket.emit("registration_response", {
            type: "registration",
            status: "success",
            message: `Registered for ${application}`,
        });
    });

    socket.on("command_packet_response", ({ packet }) => {
        const senderId = packet.senderId;

        if (senderId) {
            xoaDangBay(socket.id, senderId);
            io.to(senderId).emit("packet_response", packet);
            console.log(`Sent confirmation to client ${senderId}`);
        } else {
            console.log(`No sender ID provided in packet`);
        }
    });

    socket.on("command_packet", ({ application, command }) => {
        console.log(
            `Command from ${socket.id} for application ${application}:`,
            command
        );

        // Register this client for this application if not already registered
        //if (!applicationClients[application]) {
        //  applicationClients[application] = new Set();
        //}
        //applicationClients[application].add(socket.id);

        // Process the command

        let packet = {
            senderId: socket.id,
            application: application,
            command: command,
        };

        // An undeliverable packet used to be dropped in silence, so the caller
        // sat out its whole timeout - 45 s by default, 900 s on a long command -
        // and then reported a connection error that pointed at the wrong thing.
        // Say so immediately instead. `code` is the contract the Python side
        // reads; the marker is repeated in `message` only so that a caller
        // running an older client, which drops unknown fields, still has
        // something to match on. New code should read `code`, never the prose.
        if (!sendToApplication(packet)) {
            socket.emit("packet_response", {
                senderId: socket.id,
                application: application,
                status: "FAILURE",
                code: "NOT_CONNECTED",
                message:
                    `NOT_CONNECTED: no ${application} plugin is registered with ` +
                    `the proxy. Open ${application}, open its MCP panel and press ` +
                    `Connect.`,
            });
        }
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);

        // If this socket was a plugin holding unanswered packets, everyone
        // waiting on it would otherwise wait out their own timeout. Tell them
        // now, and say plainly that the command MAY already have been applied:
        // the app had it long enough to run it, and a blind retry is how one
        // scale ends up applied twice.
        const dangBay = inFlight.get(socket.id);
        if (dangBay) {
            const app = socket.data.application;
            for (const [senderId, action] of dangBay) {
                console.log(
                    `Client ${socket.id} dropped holding "${action}" for ${senderId}; ` +
                        `waiting ${GRACE_MS} ms for it to come back`
                );
                huyBao(senderId);
                choBao.set(
                    senderId,
                    setTimeout(() => {
                        choBao.delete(senderId);
                        console.log(`No response for ${senderId}, reporting disconnect`);
                        io.to(senderId).emit("packet_response", {
                            senderId,
                            application: app,
                            status: "FAILURE",
                            code: "APP_DISCONNECTED",
                            message:
                                `APP_DISCONNECTED: ${app} disconnected while running ` +
                                `"${action}". The command MAY already have been applied - ` +
                                `check the document before retrying.`,
                        });
                    }, GRACE_MS)
                );
            }
            inFlight.delete(socket.id);
        }

        // If it was a caller instead, drop it from every plugin's wait list so
        // the map does not grow for the life of the proxy, and cancel any
        // notice queued for it - nobody is left to read it.
        for (const m of inFlight.values()) m.delete(socket.id);
        huyBao(socket.id);

        // Remove this client from all application registrations
        for (const app in applicationClients) {
            applicationClients[app].delete(socket.id);
            // Clean up empty sets
            if (applicationClients[app].size === 0) {
                delete applicationClients[app];
            }
        }
    });
});

// Add a function to send messages to clients by application
function sendToApplication(packet) {
    let application = packet.application;
    if (applicationClients[application]) {
        console.log(
            `Sending to ${applicationClients[application].size} clients for ${application}`
        );

        let senderId = packet.senderId;
        const action = (packet.command && packet.command.action) || "?";
        // Loop through all client IDs for this application
        applicationClients[application].forEach((clientId) => {
            ghiNhoDangBay(clientId, senderId, action);
            io.to(clientId).emit("command_packet", packet);
        });
        return true;
    }
    console.log(`No clients registered for application: ${application}`);
    return false;
}

// Example: Use this function elsewhere in your code
// sendToApplication('photoshop', { message: 'Update available' });

// Bind the loopback interface only. Without the host argument this listened on
// 0.0.0.0, so every machine on the same network could send command_packet and
// drive the Adobe apps - and `executeExtendScript` runs arbitrary script, which
// reads and writes files. Nothing legitimate needs the wider bind: every plugin
// and every MCP server connects to http://localhost:3001.
const HOST = "127.0.0.1";

server.listen(PORT, HOST, () => {
    console.log(
        `adb-mcp Command proxy server running on ws://${HOST}:${PORT}`
    );
});
