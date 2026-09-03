# MIT License
#
# Copyright (c) 2025 Mike Chambers
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import socketio
import time
import threading
import json
from queue import Queue
import logger

# Global configuration variables
proxy_url = None
proxy_timeout = None
application = None

def send_message_blocking(command, timeout=None):
    """
    Blocking function that connects to a Socket.IO server, sends a message,
    waits for a response, then disconnects.
    
    Args:
        command: The command to send
        timeout (int): Maximum time to wait for response in seconds
        
    Returns:
        dict: The response received from the server, or None if no response
    """
    # Use global variables
    global application, proxy_url, proxy_timeout
    
    # Check if configuration is set
    if not application or not proxy_url or not proxy_timeout:
        logger.log("Socket client not configured. Call configure() first.")
        return None
    
    # Use provided timeout or default
    wait_timeout = timeout if timeout is not None else proxy_timeout
    
    # Create a standard (non-async) SocketIO client with WebSocket transport only
    sio = socketio.Client(logger=False)
    
    # Use a queue to get the response from the event handler
    response_queue = Queue()
    
    connection_failed = [False]         

    @sio.event
    def connect():
        logger.log(f"Connected to server with session ID: {sio.sid}")
        
        # Send the command
        logger.log(f"Sending message to {application}: {command}")
        sio.emit('command_packet', {
            'type': "command",
            'application': application,
            'command': command
        })
    
    @sio.event
    def packet_response(data):
        logger.log(f"Received response: {data}")
        response_queue.put(data)
        # Disconnect after receiving the response
        sio.disconnect()
    
    @sio.event
    def disconnect():
        logger.log("Disconnected from server")
        # If we disconnect without response, put None in the queue
        if response_queue.empty():
            response_queue.put(None)
    
    @sio.event
    def connect_error(error):
        logger.log(f"Connection error: {error}")
        connection_failed[0] = True
        response_queue.put(None)
    
    # Connect in a separate thread to avoid blocking the main thread during connection
    def connect_and_wait():
        try:
            sio.connect(proxy_url, transports=['websocket'])
            # Keep the client running until disconnect is called
            sio.wait()
        except Exception as e:
            logger.log(f"Error: {e}")
            connection_failed[0] = True
            if response_queue.empty():
                response_queue.put(None)
            if sio.connected:
                sio.disconnect()
    
    # Start the client in a separate thread
    client_thread = threading.Thread(target=connect_and_wait)
    client_thread.daemon = True
    client_thread.start()
    
    try:
        # Wait for a response or timeout
        logger.log("waiting for response...")
        response = response_queue.get(timeout=wait_timeout)

        if connection_failed[0]:
            raise RuntimeError(f"Error: Could not connect to {application} command proxy server. Make sure that the proxy server is running listening on the correct url {proxy_url}.")

        if response:
            logger.log("response received...")
            try:
                logger.log(json.dumps(response))
            except:
                logger.log(f"Response (not JSON-serializable): {response}")

            if response["status"] == "FAILURE":
                err = AppError(f"Error returned from {application}: {response['message']}")
                # The proxy tags the failures it raises itself: NOT_CONNECTED
                # when no plugin is registered, APP_DISCONNECTED when the app
                # went away still holding the command. Carry the tag on the
                # exception so callers can branch on it instead of grepping the
                # prose - matching on the sentence is how doctor.sh quietly
                # started reporting apps that were not even open as connected.
                # None here means the failure came from the app itself, or the
                # proxy predates the field.
                err.code = response.get("code")
                raise err
            
        return response
    except AppError:
        raise
    except Exception as e:
        logger.log(f"Error waiting for response: {e}")
        if sio.connected:
            sio.disconnect()
  
        raise RuntimeError(f"Error: Could not connect to {application}. Connection Timed Out. Make sure that {application} is running and that the MCP Plugin is connected. Original error: {e}")
    finally:
        # Make sure client is disconnected
        if sio.connected:
            sio.disconnect()
        # Wait for the thread to finish (should be quick after disconnect).
        # The response is already in hand by the time we get here and the worker
        # is a daemon, so this join only ever waits out its own timeout: measured
        # 1002ms of a 1080ms call, 92.8% of the whole thing, for nothing. Thread
        # count does not accumulate across calls, so a short timeout is enough to
        # keep the tidy-up behaviour without paying a second per command.
        # A/B do ngay tren job Cat Bond: dung 1 lenh build 300x600 (~164 lenh MCP),
        # timeout=1 mat 408s, timeout=0.05 mat 61s — nhanh 6.7x, va anh export ra
        # LECH 0 PIXEL. Hai lan chay lien tiep voi 0.05 cung lech 0 pixel, nen
        # khong he sinh ra bat dinh. Thread khong tich luy: sau 80 lenh dung o
        # 4-5 thread, nghi 1 giay la ve dung 1 (MainThread).
        client_thread.join(timeout=0.05)

class AppError(Exception):
    """A FAILURE came back over the socket.

    `code` distinguishes who failed. The proxy sets NOT_CONNECTED (no plugin
    registered) or APP_DISCONNECTED (the app vanished mid-command, so the work
    may already be done - never retry blindly on that one). It stays None when
    the app itself reported the error, and also when talking to a proxy old
    enough not to send the field, so treat None as "the app failed" and keep any
    legacy check on the message text as a fallback rather than replacing it.
    """

    code = None

# Codes the PROXY puts on failures it raises itself, as opposed to a failure the
# app reported. They live here, with the two helpers below, because the
# alternative - every caller comparing strings for itself - is exactly what let
# doctor.sh report apps that were not even open as connected. That happened
# twice: once for NOT_CONNECTED, and again for APP_DISCONNECTED in the very
# review that was meant to catch it. Nine call sites, one meaning; keep the
# meaning in one place.
PROXY_CODES = ("NOT_CONNECTED", "APP_DISCONNECTED")


def error_code(e):
    """The proxy's code for this AppError, or None if the app itself failed.

    Falls back to scanning the message so a proxy old enough not to send `code`
    is still classified correctly.
    """
    code = getattr(e, "code", None)
    if code:
        return code
    text = str(e)
    for c in PROXY_CODES:
        if c in text:
            return c
    return None


def app_is_alive(e):
    """Did this AppError come back from a plugin that is actually running?

    True only when the app itself produced the error - an unknown command, a
    document that is not open. Those prove a plugin answered. NOT_CONNECTED
    means nothing was reached; APP_DISCONNECTED means the app vanished while
    holding the command. A health check must count both as dead.
    """
    return error_code(e) is None


def configure(app=None, url=None, timeout=None):
    
    global application, proxy_url, proxy_timeout
    
    if app:
        application = app
    if url:
        proxy_url = url
    if timeout:
        proxy_timeout = timeout
    
    logger.log(f"Socket client configured: app={application}, url={proxy_url}, timeout={proxy_timeout}")