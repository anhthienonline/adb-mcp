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

from mcp.server.fastmcp import FastMCP
from core import init, sendCommand, createCommand
import socket_client
import sys

# Create an MCP server
mcp_name = "Adobe After Effects MCP Server"
mcp = FastMCP(mcp_name, log_level="ERROR")
print(f"{mcp_name} running on stdio", file=sys.stderr)

APPLICATION = "aftereffects"
PROXY_URL = 'http://localhost:3001'
PROXY_TIMEOUT = 20

socket_client.configure(
    app=APPLICATION, 
    url=PROXY_URL,
    timeout=PROXY_TIMEOUT
)

init(APPLICATION, socket_client)

@mcp.tool()
def get_project_info():
    """
    Returns information about the currently open After Effects project.

    Call this first when you need your bearings: it is the cheapest way to learn
    whether a project is open at all and whether something is active.

    Returns:
        dict: Project information containing:
            - numItems (int): How many items (comps, footage, folders) the project holds
            - activeItemIndex (int|None): id of the active item, or None if nothing is active
            - projectName (str): Project file name, or "Untitled" if never saved
    """
    command = createCommand("getProjectInfo", {})
    return sendCommand(command)

@mcp.tool()
def get_compositions():
    """
    Returns every composition in the project.

    Use this to find the id and dimensions of a comp before working on it. Note
    that this lists comps in the PROJECT panel — it says nothing about which one
    is currently open in the timeline (see get_project_info for that).

    Returns:
        list: One dict per composition, each containing:
            - id (int): Composition id
            - name (str): Composition name
            - width (int): Width in pixels
            - height (int): Height in pixels
            - duration (float): Duration in seconds
            - frameRate (float): Frames per second
    """
    command = createCommand("getCompositions", {})
    return sendCommand(command)

@mcp.tool()
def get_layers():
    """
    Returns the layers of the ACTIVE composition.

    This is the main way to see what you are working on — After Effects has no
    equivalent of Photoshop's per-response state dump, so call this after any
    change you want to confirm.

    Requires a composition to be active in the timeline. If none is, the call
    returns {"error": "No active composition"} rather than failing — check for
    that key before using the result.

    Returns:
        list: One dict per layer, in timeline order, each containing:
            - index (int): 1-based layer index (1 = topmost); use it to target the layer
            - name (str): Layer name
            - enabled (bool): Whether the layer's eyeball is on
            - selected (bool): Whether the layer is selected
            - startTime (float): Layer start time in seconds
            - inPoint (float): In point in seconds
            - outPoint (float): Out point in seconds
    """
    command = createCommand("getLayers", {})
    return sendCommand(command)

@mcp.tool()
def execute_extend_script(script_string: str):
    """
    Executes arbitrary ExtendScript code in AfterEffects and returns the result.

    The script should use 'return' to send data back. The result will be automatically
    JSON stringified. If the script throws an error, it will be caught and returned
    as an error object.

    Args:
        script_string (str): The ExtendScript code to execute. Must use 'return' to 
                           send results back.

    Returns:
        any: The result returned from the ExtendScript, or an error object containing:
            - error (str): Error message
            - line (str): Line number where error occurred

    Example:
        script = '''
            var doc = app.activeDocument;
            return {
                name: doc.name,
                path: doc.fullName.fsName,
                layers: doc.layers.length
            };
        '''
        result = execute_extend_script(script)
    """
    command = createCommand("executeExtendScript", {
        "scriptString": script_string
    })
    return sendCommand(command)

@mcp.resource("config://get_instructions")
def get_instructions() -> str:
    """Read this first! Returns information and instructions on how to use AfterEffects and this API"""

    return f"""
    You are an Adobe AfterEffects expert who is practical, clear, and great at teaching.

    Rules to follow:

    1. Think deeply about how to solve the task.
    2. Always check your work before responding.
    3. Read the API call info to understand required arguments and return shapes.
    4. Before manipulating anything, ensure a document is open and active.
    """



# AfterEffectsd Blend Modes (for future use)
BLEND_MODES = [
    "ADD",
    "ALPHA_ADD",
    "CLASSIC_COLOR_BURN",
    "CLASSIC_COLOR_DODGE",
    "CLASSIC_DIFFERENCE",
    "COLOR",
    "COLOR_BURN",
    "COLOR_DODGE",
    "DANCING_DISSOLVE",
    "DARKEN",
    "DARKER_COLOR",
    "DIFFERENCE",
    "DISSOLVE",
    "EXCLUSION",
    "HARD_LIGHT",
    "HARD_MIX",
    "HUE",
    "LIGHTEN",
    "LIGHTER_COLOR",
    "LINEAR_BURN",
    "LINEAR_DODGE",
    "LINEAR_LIGHT",
    "LUMINESCENT_PREMUL",
    "LUMINOSITY",
    "MULTIPLY",
    "NORMAL",
    "OVERLAY",
    "PIN_LIGHT",
    "SATURATION",
    "SCREEN",
    "SILHOUETE_ALPHA",
    "SILHOUETTE_LUMA",
    "SOFT_LIGHT",
    "STENCIL_ALPHA",
    "STENCIL_LUMA",
    "SUBTRACT",
    "VIVID_LIGHT"
]