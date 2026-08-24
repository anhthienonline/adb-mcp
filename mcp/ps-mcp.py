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

from mcp.server.fastmcp import FastMCP, Image
from core import init, sendCommand, createCommand
from fonts import list_all_fonts_postscript
import numpy as np
import base64
import socket_client
import sys
import os

FONT_LIMIT = 1000 #max number of font names to return to AI

#logger.log(f"Python path: {sys.executable}")
#logger.log(f"PYTHONPATH: {os.environ.get('PYTHONPATH')}")
#logger.log(f"Current working directory: {os.getcwd()}")
#logger.log(f"Sys.path: {sys.path}")


mcp_name = "Adobe Photoshop MCP Server"
mcp = FastMCP(mcp_name, log_level="ERROR")
print(f"{mcp_name} running on stdio", file=sys.stderr)

APPLICATION = "photoshop"
PROXY_URL = 'http://localhost:3001'
PROXY_TIMEOUT = 20

socket_client.configure(
    app=APPLICATION, 
    url=PROXY_URL,
    timeout=PROXY_TIMEOUT
)

init(APPLICATION, socket_client)

@mcp.tool()
def set_active_document(document_id:int):
    """
    Sets the document with the specified ID to the active document in Photoshop

    Args:
        document_id (int): ID for the document to set as active.
    """

    command = createCommand("setActiveDocument", {
        "documentId":document_id
    })

    return sendCommand(command)

@mcp.tool()
def get_documents():
    """
    Returns information on the documents currently open in Photoshop
    """

    command = createCommand("getDocuments", {
    })

    return sendCommand(command)


@mcp.tool()
def create_gradient_layer_style(
    layer_id: int,
    angle: int,
    type:str,
    color_stops: list,
    opacity_stops: list):
    """
    Applies gradient to active selection or entire layer if no selection exists.

    Color stops define transition points along the gradient (0-100), with color blending between stops. Opacity stops similarly control transparency transitions.

    Args:
        layer_id (int): ID for layer to apply gradient to.
        angle (int): Gradient angle (-180 to 180).
        type (str): LINEAR or RADIAL gradient.
        color_stops (list): Dictionaries defining color stops:
            - location (int): Position (0-100) along gradient.
            - color (dict): RGB values (0-255 for red/green/blue).
            - midpoint (int): Transition bias (0-100, default 50).
        opacity_stops (list): Dictionaries defining opacity stops:
            - location (int): Position (0-100) along gradient.
            - opacity (int): Level (0=transparent, 100=opaque).
            - midpoint (int): Transition bias (0-100, default 50).
    """

    command = createCommand("createGradientLayerStyle", {
        "layerId":layer_id,
        "angle":angle,
        "colorStops":color_stops,
        "type":type,
        "opacityStops":opacity_stops
    })

    return sendCommand(command)


@mcp.tool()
def duplicate_document(document_name: str):
    """Duplicates the current Photoshop Document into a new file


        Args:
            document_name (str): Name for the new document being created
    """
    
    command = createCommand("duplicateDocument", {
        "name":document_name
    })

    return sendCommand(command)


@mcp.tool()
def create_document(document_name: str, width: int, height:int, resolution:int, fill_color:dict = {"red":0, "green":0, "blue":0}, color_mode:str = "RGB"):
    """Creates a new Photoshop Document

        Layer are created from bottom up based on the order they are created in, so create background elements first and then build on top.

        New document will contain a layer named "Background" that is filled with the specified fill color

        Args:
            document_name (str): Name for the new document being created
            width (int): Width in pixels of the new document
            height (int): Height in pixels of the new document
            resolution (int): Resolution (Pixels per Inch) of the new document
            fill_color (dict): dict defining the background color fill of the new document
            color_mode (str): Color mode for the new document
    """
    
    command = createCommand("createDocument", {
        "name":document_name,
        "width":width,
        "height":height,
        "resolution":resolution,
        "fillColor":fill_color,
        "colorMode":color_mode
    })

    return sendCommand(command)

@mcp.tool()
def export_layers_as_png(layers_info: list[dict[str, str|int]], mode: str = "TRIM"):
    """Exports layers as separate PNG files.

    Args:
        layers_info (list[dict[str, str|int]]): One dict per layer:
                - "layerId" (int): ID of the layer to export.
                - "filePath" (str): Absolute path including filename, e.g.
                   "/path/to/dir/logo.png". The parent directory must already exist.
        mode (str): "TRIM" (default) writes a cutout cropped to the layer's own bounds with
            transparency -- what "export this layer" normally means. "CANVAS" writes a
            full-canvas PNG with only that layer showing, so every file shares one
            coordinate space; that is what a compositing rebuild in After Effects wants,
            but on a multi-artboard document the canvas is the whole contact sheet, so
            expect large mostly-empty files.

    Returns:
        A list, one entry per layer: {layerId, name, savedFilePath, trimmed, success} or
        {layerId, filePath, success: false, message}. Failures are per layer; the rest
        still run.

    ALWAYS check the files. This tool used to report success for every layer and write
    canvas-sized PNGs that were fully transparent: hiding all layers hides the artboard
    GROUPS too, and a leaf inside a hidden group renders nothing no matter how visible the
    leaf is. Both modes now handle that, but a blank PNG is still the failure to look for.
    """

    command = createCommand("exportLayersAsPng", {
        "layersInfo":layers_info,
        "mode":mode
    })

    return sendCommand(command)


@mcp.tool()
def save_document_as(file_path: str, file_type: str = "PSD"):
    """Saves the current Photoshop document to the specified location and format.
    
    Args:
        file_path (str): The absolute path (including filename) where the file will be saved.
            Example: "/Users/username/Documents/my_image.psd"
        file_type (str, optional): The file format to use when saving the document.
            Defaults to "PSD".
            Supported formats:
                - "PSD": Adobe Photoshop Document (preserves layers and editability)
                - "PNG": Portable Network Graphics (lossless compression with transparency)
                - "JPG": Joint Photographic Experts Group (lossy compression)
    
    Returns:
        dict: Response from the Photoshop operation indicating success status, and the path that the file was saved at
    """
    
    command = createCommand("saveDocumentAs", {
        "filePath":file_path,
        "fileType":file_type
    })

    return sendCommand(command)

@mcp.tool()
def save_document():
    """Saves the current Photoshop Document
    """
    
    command = createCommand("saveDocument", {
    })

    return sendCommand(command)

@mcp.tool()
def group_layers(group_name: str, layer_ids: list[int]) -> list:
    """
    Creates a new layer group from the specified layers in Photoshop.

    Note: The layers will be added to the group in the order they are specified in the document, and not the order of their layerIds passed in. The group will be made at the same level as the top most layer in the layer tree.

    Args:
        groupName (str): The name to assign to the newly created layer group.
        layerIds (list[int]): A list of layer ids to include in the new group.

    Raises:
        RuntimeError: If the operation fails or times out.

    """


    command = createCommand("groupLayers", {
        "groupName":group_name,
        "layerIds":layer_ids
    })

    return sendCommand(command)


@mcp.tool()
def get_layer_image(layer_id: int):
    """Returns a jpeg of the specified layer's content as an MCP Image object that can be displayed."""

    command = createCommand("getLayerImage",
        {
            "layerId":layer_id
        }
    )

    response = sendCommand(command)

    if response.get('status') == 'SUCCESS' and 'response' in response:
        image_data = response['response']
        data_url = image_data.get('dataUrl')

        if data_url and data_url.startswith("data:image/jpeg;base64,"):
            # Strip the data URL prefix and decode the base64 JPEG bytes
            base64_data = data_url.split(",", 1)[1]
            jpeg_bytes = base64.b64decode(base64_data)

            return Image(data=jpeg_bytes, format="jpeg")

    return response


@mcp.tool()
def get_document_image():
    """Returns a jpeg of the current visible Photoshop document as an MCP Image object that can be displayed."""
    command = createCommand("getDocumentImage", {})
    response = sendCommand(command)

    if response.get('status') == 'SUCCESS' and 'response' in response:
        image_data = response['response']
        data_url = image_data.get('dataUrl')

        if data_url and data_url.startswith("data:image/jpeg;base64,"):
            # Strip the data URL prefix and decode the base64 JPEG bytes
            base64_data = data_url.split(",", 1)[1]
            jpeg_bytes = base64.b64decode(base64_data)

            return Image(data=jpeg_bytes, format="jpeg")

    return response

@mcp.tool()
def save_document_image_as_png(file_path: str):
    """
    Capture the Photoshop document and save as PNG file
    
    Args:
        file_path: Where to save the PNG file
        
    Returns:
        dict: Status and file info
    """
    command = createCommand("getDocumentImage", {})
    response = sendCommand(command)
    
    if response.get('format') == 'raw' and 'rawDataBase64' in response:
        try:
            # Decode raw data
            raw_bytes = base64.b64decode(response['rawDataBase64'])
            
            # Extract metadata
            width = response['width']
            height = response['height']
            components = response['components']
            
            # Convert to numpy array and reshape
            pixel_array = np.frombuffer(raw_bytes, dtype=np.uint8)
            image_array = pixel_array.reshape((height, width, components))
            
            # Create and save PNG
            mode = 'RGBA' if components == 4 else 'RGB'
            image = Image.fromarray(image_array, mode)
            image.save(file_path, 'PNG')
            
            return {
                'status': 'success',
                'file_path': file_path,
                'width': width,
                'height': height,
                'size_bytes': os.path.getsize(file_path)
            }
            
        except Exception as e:
            return {
                'status': 'error',
                'error': str(e)
            }
    else:
        return {
            'status': 'error',
            'error': 'No raw image data received'
        }

@mcp.tool()
def get_layers() -> list:
    """Returns a nested list of dicts that contain layer info and the order they are arranged in.

    Args:
        None
        
    Returns:
        list: A nested list of dictionaries containing layer information and hierarchy.
            Each dict contains 'name', 'type', 'id', 'visible', 'isClippingMask', 'opacity' and 'blendMode'.
            'visible' is that layer's own show/hide flag, exactly as displayed by the eye icon in
            the Photoshop layers panel. It is NOT inherited: a layer inside a hidden group can
            still report visible=True even though nothing of it is rendered on the canvas. To know
            whether a layer actually shows up, it and every one of its parent groups must be visible.
            Text layers also include a 'textInfo' key.
            If a layer has sublayers, they will be contained in a 'layers' key which contains another list of layer dicts.
            Example: [{'name': 'Group 1', 'visible': False, 'layers': [{'name': 'Layer 1', 'visible': True}]}, {'name': 'Background', 'visible': True}]
    """

    command = createCommand("getLayers", {})

    return sendCommand(command)


@mcp.tool()
def place_image(
    layer_id: int,
    image_path: str
):
    """Places the image at the specified path on the existing pixel layer with the specified id.

    The image will be placed on the center of the layer, and will fill the layer without changing its aspect ration (thus there may be bars at the top or bottom) 

    Args:
        layer_id (int): The id of the layer where the image will be placed.
        image_path (str): The file path to the image that will be placed on the layer.
    """
    
    command = createCommand("placeImage", {
        "layerId":layer_id,
        "imagePath":image_path
    })

    return sendCommand(command)

@mcp.tool()
def harmonize_layer(layer_id:int,  new_layer_name:str, rasterize_layer:bool = True):
    """Harmonizes (matches lighting and other settings) the selected layer with the background layers.

    The layer being harmonized should be rasterized and have some transparency.

    Args:
        layer_id (int): ID of the layer to be harmonizes.
        new_layer_name (str): Name for the new layer that will be created with the harmonized content
        rasterize_layer (bool): Whether the new layer should be rasterized.
            If not rasterized, the layer will remain a generative layer which
            allows the user to interact with it. True by default.
    """

    command = createCommand("harmonizeLayer", {
        "layerId":layer_id,
         "newLayerName":new_layer_name,
        "rasterizeLayer":rasterize_layer
    })

    return sendCommand(command)


@mcp.tool()
def rename_layers(
    layer_data: list[dict]
):
    """Renames one or more layers

    Args:
        layer_data (list[dict]): A list of dictionaries containing layer rename information.
            Each dictionary must have the following keys:
                - "layer_id" (int): ID of the layer to be renamed.
                - "new_layer_name" (str): New name for the layer.
    """
    
    command = createCommand("renameLayers", {
        "layerData":layer_data
    })
    
    return sendCommand(command)


@mcp.tool()
def scale_layer(
    width:int,
    height:int,
    anchor_position:str = "MIDDLECENTER",
    interpolation_method:str = "AUTOMATIC",
    layer_id:int = None,
    layer_ids:list[int] = None,
    layer_name:str = None
):
    """Scales layers by a percentage.

    Args:
        width (int): Percentage to scale horizontally.
        height (int): Percentage to scale vertically.
        anchor_position (str): The anchor to scale around. For a layer INSIDE AN ARTBOARD
            only MIDDLECENTER works -- the batchPlay path those layers need cannot honour
            the other eight, and it raises rather than anchoring to the wrong corner
            silently. Scale about MIDDLECENTER and then translate_layer into place.
        interpolation_method (str): Interpolation to use when resampling.
        layer_id (int, optional): A single layer's ID.
        layer_ids (list[int], optional): Several layer IDs.
        layer_name (str, optional): Every layer with this exact name.

    Targeting: pass layer_id for one layer, layer_ids for an explicit set, or layer_name to
    hit EVERY layer with that exact name anywhere in the document. In a multi-artboard
    banner file the same layer name is repeated once per artboard, so layer_name is how one
    call covers all of them. Exactly one of the three is needed; layer_ids beats layer_id,
    which beats layer_name.

    Returns:
        {applied: [{layerId, name}], count, failed: [{layerId, name, message}]}. A layer that
        fails is reported in `failed` and the rest still run -- so a partial result is
        visible rather than silently half-applied. It raises only if EVERY target failed.

    NOTE: scaling is RELATIVE, so one call applies the same percentage to targets of
    different starting sizes. Sizes that differ per artboard need per-layer percentages
    computed from get_layer_bounds.
    """

    command = createCommand("scaleLayer", {
        "layerId":layer_id,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "width":width,
        "height":height,
        "anchorPosition":anchor_position,
        "interpolationMethod":interpolation_method
    })

    return sendCommand(command)


@mcp.tool()
def rotate_layer(
    layer_id:int,
    angle:int,
    anchor_position:str,
    interpolation_method:str = "AUTOMATIC"
):
    """Rotates the layer with the specified ID.

    Args:
        layer_id (int): ID of layer to be scaled.
        angle (int): Angle (-359 to 359) to rotate the layer by in degrees
        anchor_position (str): The anchor position to rotate around,
        interpolation_method (str): Interpolation method to use when resampling the image
    """
    
    command = createCommand("rotateLayer", {
        "layerId":layer_id,
        "angle":angle,
        "anchorPosition":anchor_position,
        "interpolationMethod":interpolation_method
    })

    return sendCommand(command)


@mcp.tool()
def flip_layer(
    layer_id:int,
    axis:str
):
    """Flips the layer with the specified ID on the specified axis.

    Args:
        layer_id (int): ID of layer to be scaled.
        axis (str): The axis on which to flip the layer. Valid values are "horizontal", "vertical" or "both"
    """
    
    command = createCommand("flipLayer", {
        "layerId":layer_id,
        "axis":axis
    })

    return sendCommand(command)


@mcp.tool()
def delete_layer(
    layer_id:int
):
    """Deletes the layer with the specified ID

    Args:
        layer_id (int): ID of the layer to be deleted
    """
    
    command = createCommand("deleteLayer", {
        "layerId":layer_id
    })

    return sendCommand(command)



@mcp.tool()
def set_layer_visibility(
    visible:bool,
    layer_id:int = None,
    layer_ids:list[int] = None,
    layer_name:str = None
):
    """Shows or hides layers.

    Args:
        visible (bool): Whether the layers are visible.
        layer_id (int, optional): A single layer's ID.
        layer_ids (list[int], optional): Several layer IDs.
        layer_name (str, optional): Every layer with this exact name.

    Targeting: pass layer_id for one layer, layer_ids for an explicit set, or layer_name to
    hit EVERY layer with that exact name anywhere in the document. In a multi-artboard
    banner file the same layer name is repeated once per artboard, so layer_name is how one
    call covers all of them. Exactly one of the three is needed; layer_ids beats layer_id,
    which beats layer_name.

    Returns:
        {applied: [{layerId, name}], count, failed: [{layerId, name, message}]}. A layer that
        fails is reported in `failed` and the rest still run -- so a partial result is
        visible rather than silently half-applied. It raises only if EVERY target failed.

    NOTE: this is the layer's own eye icon and is NOT inherited. Showing a layer whose
    parent group is hidden renders nothing. In a frame-animation PSD visibility is recorded
    PER TIMELINE FRAME, so this only writes the frame that is current.
    """

    command = createCommand("setLayerVisibility", {
        "layerId":layer_id,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "visible":visible
    })

    return sendCommand(command)


@mcp.tool()
def generate_image(
    layer_name:str,
    prompt:str,
    content_type:str = "none"
):
    """Uses Adobe Firefly Generative AI to generate an image on a new layer with the specified layer name.

    If there is an active selection, it will use that region for the generation. Otherwise it will generate
    on the entire layer.

    Args:
        layer_name (str): Name for the layer that will be created and contain the generated image
        prompt (str): Prompt describing the image to be generated
        content_type (str): The type of image to be generated. Options include "photo", "art" or "none" (default)
    """
    
    command = createCommand("generateImage", {
        "layerName":layer_name,
        "prompt":prompt,
        "contentType":content_type
    })

    return sendCommand(command)

@mcp.tool()
def generative_fill(
    layer_name: str,
    prompt: str,
    layer_id: int,
    content_type: str = "none"
):
    """Uses Adobe Firefly Generative AI to perform generative fill within the current selection.

    This function uses generative fill to seamlessly integrate new content into the existing image.
    It requires an active selection, and will fill that region taking into account the surrounding 
    context and layers below. The AI considers the existing content to create a natural, 
    contextually-aware fill.

    Args:
        layer_name (str): Name for the layer that will be created and contain the generated fill
        prompt (str): Prompt describing the content to be generated within the selection
        layer_id (int): ID of the layer to work with (though a new layer is created for the result)
        content_type (str): The type of image to be generated. Options include "photo", "art" or "none" (default)
    
    Returns:
        dict: Response from Photoshop containing the operation status and layer information
    """

    command = createCommand("generativeFill", {
        "layerName":layer_name,
        "prompt":prompt,
        "layerId":layer_id,
        "contentType":content_type,
    })

    return sendCommand(command)


@mcp.tool()
def move_layer(
    layer_id:int,
    position:str
):
    """Moves the layer within the layer stack based on the specified position

    Args:
        layer_id (int): Name for the layer that will be moved
        position (str): How the layer position within the layer stack will be updated. Value values are: TOP (Place above all layers), BOTTOM (Place below all layers), UP (Move up one layer), DOWN (Move down one layer)
    """

    command = createCommand("moveLayer", {
        "layerId":layer_id,
        "position":position
    })

    return sendCommand(command)

@mcp.tool()
def get_document_info():
    """Retrieves information about the currently active document.

    Returns:
        response : An object containing the following document properties:
            - height (int): The height of the document in pixels.
            - width (int): The width of the document in pixels.
            - colorMode (str): The document's color mode as a string.
            - pixelAspectRatio (float): The pixel aspect ratio of the document.
            - resolution (float): The document's resolution (DPI).
            - path (str): The file path of the document, if saved.
            - saved (bool): Whether the document has been saved (True if it has a valid file path).
            - hasUnsavedChanges (bool): Whether the document contains unsaved changes.

    """

    command = createCommand("getDocumentInfo", {})

    return sendCommand(command)

@mcp.tool()
def crop_document():
    """Crops the document to the active selection.

    This function removes all content outside the selection area and resizes the document 
    so that the selection becomes the new canvas size.

    An active selection is required.
    """

    command = createCommand("cropDocument", {})

    return sendCommand(command)

@mcp.tool()
def paste_from_clipboard(layer_id: int, paste_in_place: bool = True):
    """Pastes the current clipboard contents onto the specified layer.

    If `paste_in_place` is True, the content will be positioned exactly where it was cut or copied from.
    If False and an active selection exists, the content will be centered within the selection.
    If no selection is active, the content will be placed at the center of the layer.

    Args:
        layer_id (int): The ID of the layer where the clipboard contents will be pasted.
        paste_in_place (bool): Whether to paste at the original location (True) or adjust based on selection/layer center (False).
    """


    command = createCommand("pasteFromClipboard", {
        "layerId":layer_id,
        "pasteInPlace":paste_in_place
    })

    return sendCommand(command)

@mcp.tool()
def rasterize_layer(layer_id: int):
    """Converts the specified layer into a rasterized (flat) image.

    This process removes any vector, text, or smart object properties, turning the layer 
    into pixel-based content.

    Args:
        layer_id (int): The name of the layer to rasterize.
    """

    command = createCommand("rasterizeLayer", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def open_photoshop_file(file_path: str):
    """Opens the specified Photoshop-compatible file within Photoshop.

    This function attempts to open a file in Adobe Photoshop. The file must be in a 
    format compatible with Photoshop, such as PSD, TIFF, JPEG, PNG, etc.

    Args:
        file_path (str): Complete absolute path to the file to be opened, including filename and extension.

    Returns:
        dict: Response from the Photoshop operation indicating success status.
        
    Raises:
        RuntimeError: If the file doesn't exist, is not accessible, or is in an unsupported format.
    """

    command = createCommand("openFile", {
        "filePath":file_path
    })

    return sendCommand(command)

@mcp.tool()
def cut_selection_to_clipboard(layer_id: int):
    """Copies and removes (cuts) the selected pixels from the specified layer to the system clipboard.

    This function requires an active selection.

    Args:
        layer_id (int): The name of the layer that contains the pixels to copy and remove.
    """

    command = createCommand("cutSelectionToClipboard", {
        "layerId":layer_id
    })

    return sendCommand(command)


@mcp.tool()
def copy_merged_selection_to_clipboard():
    """Copies the selected pixels from all visible layers to the system clipboard.

    This function requires an active selection. If no selection is active, the operation will fail.
    The copied content will include pixel data from all visible layers within the selection area,
    effectively capturing what you see on screen.

    Returns:
        dict: Response from the Photoshop operation indicating success status.
        
    Raises:
        RuntimeError: If no active selection exists.
    """

    command = createCommand("copyMergedSelectionToClipboard", {})

    return sendCommand(command)

@mcp.tool()
def copy_selection_to_clipboard(layer_id: int):
    """Copies the selected pixels from the specified layer to the system clipboard.

    This function requires an active selection. If no selection is active, the operation will fail.

    Args:
        layer_id (int): The name of the layer that contains the pixels to copy.
        
    Returns:
        dict: Response from the Photoshop operation indicating success status.
    """

    command = createCommand("copySelectionToClipboard", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def select_subject(layer_id: int):
    """Automatically selects the subject in the specified layer.

    This function identifies and selects the subject in the given image layer. 
    It returns an object containing a property named `hasActiveSelection`, 
    which indicates whether any pixels were selected (e.g., if no subject was detected).

    Args:
        layer_int (int): The name of that contains the image to select the subject from.
    """

    
    command = createCommand("selectSubject", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def select_sky(layer_id: int):
    """Automatically selects the sky in the specified layer.

    This function identifies and selects the sky in the given image layer. 
    It returns an object containing a property named `hasActiveSelection`, 
    which indicates whether any pixels were selected (e.g., if no sky was detected).

    Args:
        layer_id (int): The name of that contains the image to select the sky from.
    """

    
    command = createCommand("selectSky", {
        "layerId":layer_id
    })

    return sendCommand(command)


@mcp.tool()
def get_layer_bounds(
    layer_id: int
):
    """Returns the pixel bounds for the layer with the specified ID
    
    Args:
        layer_id (int): ID of the layer to get the bounds information from

    Returns:
        dict: A dictionary containing the layer bounds with the following properties:
            - left (int): The x-coordinate of the left edge of the layer
            - top (int): The y-coordinate of the top edge of the layer
            - right (int): The x-coordinate of the right edge of the layer
            - bottom (int): The y-coordinate of the bottom edge of the layer
            
    Raises:
        RuntimeError: If the layer doesn't exist or if the operation fails
    """
    
    command = createCommand("getLayerBounds", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def remove_background(
    layer_id:int
):
    """Automatically removes the background of the image in the layer with the specified ID and keeps the main subject
    
    Args:
        layer_id (int): ID of the layer to remove the background from
    """
    
    command = createCommand("removeBackground", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def create_pixel_layer(
    layer_name:str,
    fill_neutral:bool,
    opacity:int = 100,
    blend_mode:str = "NORMAL",
):
    """Creates a new pixel layer with the specified ID
    
    Args:
        layer_name (str): Name of the new layer being created
        fill_neutral (bool): Whether to fill the layer with a neutral color when applying Blend Mode.
        opacity (int): Opacity of the newly created layer
        blend_mode (str): Blend mode of the newly created layer
    """
    
    command = createCommand("createPixelLayer", {
        "layerName":layer_name,
        "opacity":opacity,
        "fillNeutral":fill_neutral,
        "blendMode":blend_mode
    })

    return sendCommand(command)

@mcp.tool()
def create_multi_line_text_layer(
    layer_name:str, 
    text:str, 
    font_size:int, 
    postscript_font_name:str, 
    opacity:int = 100,
    blend_mode:str = "NORMAL",
    text_color:dict = {"red":255, "green":255, "blue":255}, 
    position:dict = {"x": 100, "y":100},
    bounds:dict = {"top": 0, "left": 0, "bottom": 250, "right": 300},
    justification:str = "LEFT"
    ):

    """
    Creates a new multi-line text layer with the specified ID within the current Photoshop document.
    
    Args:
        layer_name (str): The name of the layer to be created. Can be used to select in other api calls.
        text (str): The text to include on the layer.
        font_size (int): Font size.
        postscript_font_name (string): Postscript Font Name to display the text in. Valid list available via get_option_info.
        opacity (int): Opacity for the layer specified in percent.
        blend_mode (str): Blend Mode for the layer. Valid list available via get_option_info
        text_color (dict): Color of the text expressed in Red, Green, Blue values between 0 and 255
        position (dict): Position (dict with x, y values) where the text will be placed in the layer. Based on bottom left point of the text.
        bounds (dict): text bounding box
        justification (str): text justification. Valid list available via get_option_info.
    """

    command = createCommand("createMultiLineTextLayer", {
        "layerName":layer_name,
        "contents":text,
        "fontSize": font_size,
        "opacity":opacity,
        "position":position,
        "fontName":postscript_font_name,
        "textColor":text_color,
        "blendMode":blend_mode,
        "bounds":bounds,
        "justification":justification
    })

    return sendCommand(command)


@mcp.tool()
def create_single_line_text_layer(
    layer_name:str, 
    text:str, 
    font_size:int, 
    postscript_font_name:str, 
    opacity:int = 100,
    blend_mode:str = "NORMAL",
    text_color:dict = {"red":255, "green":255, "blue":255}, 
    position:dict = {"x": 100, "y":100}
    ):

    """
    Create a new single line text layer with the specified ID within the current Photoshop document.
    
     Args:
        layer_name (str): The name of the layer to be created. Can be used to select in other api calls.
        text (str): The text to include on the layer.
        font_size (int): Font size.
        postscript_font_name (string): Postscript Font Name to display the text in. Valid list available via get_option_info.
        opacity (int): Opacity for the layer specified in percent.
        blend_mode (str): Blend Mode for the layer. Valid list available via get_option_info
        text_color (dict): Color of the text expressed in Red, Green, Blue values between 0 and 255
        position (dict): Position (dict with x, y values) where the text will be placed in the layer. Based on bottom left point of the text.
    """

    command = createCommand("createSingleLineTextLayer", {
        "layerName":layer_name,
        "contents":text,
        "fontSize": font_size,
        "opacity":opacity,
        "position":position,
        "fontName":postscript_font_name,
        "textColor":text_color,
        "blendMode":blend_mode
    })

    return sendCommand(command)

@mcp.tool()
def edit_text_layer(
    layer_id:int,
    text:str = None,
    font_size:int = None,
    postscript_font_name:str = None,
    text_color:dict = None,
    color_ranges:list = None,
    text_case:str = None,
    ):

    """
    Edits the text content of an existing text layer in the current Photoshop document.

    Line breaks: pass "\\n" in text. It is converted to the carriage return Photoshop
    needs, so multi-line headlines keep their line breaks and their block width.

    Args:
        layer_id (int): The ID of the existing text layer to edit.
        text (str): The new text content to replace the current text in the layer. If None, text will not be changed.
        font_size (int): Font size. If None, size will not be changed. Leave as None to preserve the layer's existing size, which is safer on layers that carry a transform.
        postscript_font_name (string): Postscript Font Name to display the text in. Valid list available via get_option_info. If None, font will not will not be changed.
        text_color (dict): Color of the whole layer expressed in Red, Green, Blue values between 0 and 255 in format of {"red":255, "green":255, "blue":255}. If None, color will not be changed
        color_ranges (list): Optional per-range colors, for headlines where one word is a different color. Each entry is either
            {"text": "Delivered.", "color": {"red":26,"green":92,"blue":224}} to color the first occurrence of that substring, or
            {"from": 12, "to": 22, "color": {...}} to color a character range. Ranges must not overlap. Characters outside any
            range keep the layer's base color, and the layer's font and size are preserved.
        text_case (str): Optional "normal", "allCaps" or "smallCaps". All Caps is a character attribute in Photoshop,
            so a layer styled that way keeps rendering upper case no matter what string you send; pass "normal" to clear it.
    """

    command = createCommand("editTextLayer", {
        "layerId":layer_id,
        "contents":text,
        "fontSize": font_size,
        "fontName":postscript_font_name,
        "textColor":text_color,
        "colorRanges":color_ranges,
        "textCase":text_case
    })

    return sendCommand(command)



@mcp.tool()
def translate_layer(
    x_offset:int = 0,
    y_offset:int = 0,
    layer_id: int = None,
    layer_ids:list[int] = None,
    layer_name:str = None
    ):

    """Moves layers on the X and Y axis by a number of pixels.

    Args:
        x_offset (int): Amount to move horizontally. Negative moves left, positive right.
        y_offset (int): Amount to move vertically. Negative moves UP, positive moves DOWN
            -- it follows the canvas y axis, where y grows downward. The old docstring here
            claimed the opposite; measured, -30 moved a layer's top from 104 to 74.
        layer_id (int, optional): A single layer's ID.
        layer_ids (list[int], optional): Several layer IDs.
        layer_name (str, optional): Every layer with this exact name.

    Targeting: pass layer_id for one layer, layer_ids for an explicit set, or layer_name to
    hit EVERY layer with that exact name anywhere in the document. In a multi-artboard
    banner file the same layer name is repeated once per artboard, so layer_name is how one
    call covers all of them. Exactly one of the three is needed; layer_ids beats layer_id,
    which beats layer_name.

    Returns:
        {applied: [{layerId, name}], count, failed: [{layerId, name, message}]}. A layer that
        fails is reported in `failed` and the rest still run -- so a partial result is
        visible rather than silently half-applied. It raises only if EVERY target failed.

    NOTE: the offset is the SAME for every target. Layers in different artboards start at
    different coordinates, so one shared delta moves each by the same amount -- it does not
    put them at the same place. For that, read each layer's bounds and issue per-layer
    offsets.
    """

    command = createCommand("translateLayer", {
        "layerId":layer_id,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "xOffset":x_offset,
        "yOffset":y_offset
    })

    return sendCommand(command)

@mcp.tool()
def remove_layer_mask(
    layer_id: int
    ):

    """Removes the layer mask from the specified layer.

    Args:
        None
    """
    
    command = createCommand("removeLayerMask", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def add_layer_mask_from_selection(
    layer_id: int
    ):

    """Creates a layer mask on the specified layer defined by the active selection.
    
    This function takes the current active selection in the document and converts it into a layer mask
    for the specified layer. Selected areas will be visible, while non-selected areas will be hidden.
    An active selection must exist before calling this function.

    Args:
        layer_name (str): The name of the layer to which the mask will be applied
    """
    
    command = createCommand("addLayerMask", {
        "layerId":layer_id
    })

    return sendCommand(command)

@mcp.tool()
def set_layer_properties(
    blend_mode: str = None,
    layer_opacity: int = None,
    fill_opacity: int = None,
    is_clipping_mask: bool = None,
    layer_id: int = None,
    layer_ids: list[int] = None,
    layer_name: str = None
    ):

    """Sets blend mode, opacity, fill opacity and clipping on layers.

    Only the properties you actually pass are written; anything omitted is left exactly as
    it is. Pass at least one of them, or the call does nothing but resolve its targets.

    Args:
        blend_mode (str, optional): The blend mode for the layers.
        layer_opacity (int, optional): Opacity (0-100).
        fill_opacity (int, optional): Fill opacity (0-100). Ignores any layer effects applied.
        is_clipping_mask (bool, optional): Whether the layer is clipped to the layer below it.
        layer_id (int, optional): A single layer's ID.
        layer_ids (list[int], optional): Several layer IDs.
        layer_name (str, optional): Every layer with this exact name.

    Targeting: pass layer_id for one layer, layer_ids for an explicit set, or layer_name to
    hit EVERY layer with that exact name anywhere in the document. In a multi-artboard
    banner file the same layer name is repeated once per artboard, so layer_name is how one
    call covers all of them. Exactly one of the three is needed; layer_ids beats layer_id,
    which beats layer_name.

    Returns:
        {applied: [{layerId, name}], count, failed: [{layerId, name, message}]}. A layer that
        fails is reported in `failed` and the rest still run -- so a partial result is
        visible rather than silently half-applied. It raises only if EVERY target failed.

    NOTE: this used to write all four properties on every call, so changing only the blend
    mode silently reset opacity and fill to 100 and un-clipped the layer -- across every
    artboard at once when targeting by layer_name. It no longer does; an omitted property is
    not touched.
    """

    command = createCommand("setLayerProperties", {
        "layerId":layer_id,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "blendMode":blend_mode,
        "layerOpacity":layer_opacity,
        "fillOpacity":fill_opacity,
        "isClippingMask":is_clipping_mask
    })

    return sendCommand(command)

@mcp.tool()
def fill_selection(
    layer_id: int,
    color:dict = {"red":255, "green":0, "blue":0},
    blend_mode:str = "NORMAL",
    opacity:int = 100,
    ):

    """Fills the selection on the pixel layer with the specified ID
    
    Args:
        layer_id (int): The ID of existing pixel layer to add the fill
        color (dict): The color of the fill
        blend_mode (dict): The blend mode for the fill
        opacity (int) : The opacity of the color for the fill
    """
    
    command = createCommand("fillSelection", {
        "layerId":layer_id,
        "color":color,
        "blendMode":blend_mode,
        "opacity":opacity
    })

    return sendCommand(command)



@mcp.tool()
def delete_selection(
    layer_id: int
    ):

    """Removes the pixels within the selection on the pixel layer with the specified ID
    
    Args:
        layer_id (int): The ID of the layer from which the content of the selection should be deleted
    """
    
    command = createCommand("deleteSelection", {
        "layerId":layer_id
    })

    return sendCommand(command)


@mcp.tool()
def invert_selection():
    
    """Inverts the current selection in the Photoshop document"""

    command = createCommand("invertSelection", {})
    return sendCommand(command)


@mcp.tool()
def clear_selection():
    
    """Clears / deselects the current selection"""

    command = createCommand("selectRectangle", {
        "feather":0,
        "antiAlias":True,
        "bounds":{"top": 0, "left": 0, "bottom": 0, "right": 0}
    })

    return sendCommand(command)

@mcp.tool()
def select_rectangle(
    layer_id:int,
    feather:int = 0,
    anti_alias:bool = True,
    bounds:dict = {"top": 0, "left": 0, "bottom": 100, "right": 100}
    ):
    
    """Creates a rectangular selection and selects the specified layer
    
    Args:
        layer_id (int): The layer to do the select rectangle action on.
        feather (int): The amount of feathering in pixels to apply to the selection (0 - 1000)
        anti_alias (bool): Whether anti-aliases is applied to the selection
        bounds (dict): The bounds for the rectangle selection
    """

    command = createCommand("selectRectangle", {
        "layerId":layer_id,
        "feather":feather,
        "antiAlias":anti_alias,
        "bounds":bounds
    })

    return sendCommand(command)

@mcp.tool()
def select_polygon(
    layer_id:int,
    feather:int = 0,
    anti_alias:bool = True,
    points:list[dict[str, int]] = [{"x": 50, "y": 10}, {"x": 100, "y": 90}, {"x": 10, "y": 40}]
    ):
    
    """Creates an n-sided polygon selection and selects the specified layer
    
    Args:
        layer_id (int): The layer to do the selection action on.
        feather (int): The amount of feathering in pixels to apply to the selection (0 - 1000)
        anti_alias (bool): Whether anti-aliases is applied to the selection
        points (list): The points that define the sides of the selection, defined via a list of dicts with x, y values.
    """

    command = createCommand("selectPolygon", {
        "layerId":layer_id,
        "feather":feather,
        "antiAlias":anti_alias,
        "points":points
    })

    return sendCommand(command)

@mcp.tool()
def select_ellipse(
    layer_id:int,
    feather:int = 0,
    anti_alias:bool = True,
    bounds:dict = {"top": 0, "left": 0, "bottom": 100, "right": 100}
    ):
    
    """Creates an elliptical selection and selects the specified layer
    
    Args:
        layer_id (int): The layer to do the selection action on.
        feather (int): The amount of feathering in pixels to apply to the selection (0 - 1000)
        anti_alias (bool): Whether anti-aliases is applied to the selection
        bounds (dict): The bounds that will define the elliptical selection.
    """

    command = createCommand("selectEllipse", {
        "layerId":layer_id,
        "feather":feather,
        "antiAlias":anti_alias,
        "bounds":bounds
    })

    return sendCommand(command)

@mcp.tool()
def align_content(
    layer_id: int,
    alignment_mode:str
    ):
    
    """
    Aligns content on layer with the specified ID to the current selection.

    Args:
        layer_id (int): The ID of the layer in which to align the content
        alignment_mode (str): How the content should be aligned. Available options via alignment_modes
    """

    command = createCommand("alignContent", {
        "layerId":layer_id,
        "alignmentMode":alignment_mode
    })

    return sendCommand(command)

@mcp.tool()
def add_drop_shadow_layer_style(
    layer_id: int,
    blend_mode:str = "MULTIPLY",
    color:dict = {"red":0, "green":0, "blue":0},
    opacity:int = 35,
    angle:int = 160,
    distance:int = 3,
    spread:int = 0,
    size:int = 7
    ):
    """Adds a drop shadow layer style to the layer with the specified ID

    Args:
        layer_id (int): The ID for the layer with the content to add the drop shadow to
        blend_mode (str): The blend mode for the drop shadow
        color (dict): The color for the drop shadow
        opacity (int): The opacity of the drop shadow
        angle (int): The angle (-180 to 180) of the drop shadow relative to the content
        distance (int): The distance in pixels of the drop shadow (0 to 30000)
        spread (int): Defines how gradually the shadow fades out at its edges, with higher values creating a harsher, more defined edge, and lower values a softer, more feathered edge (0 to 100)
        size (int): Control the blur and spread of the shadow effect (0 to 250)
    """

    command = createCommand("addDropShadowLayerStyle", {
        "layerId":layer_id,
        "blendMode":blend_mode,
        "color":color,
        "opacity":opacity,
        "angle":angle,
        "distance":distance,
        "spread":spread,
        "size":size
    })

    return sendCommand(command)

@mcp.tool()
def get_layer_effects(layer_id: int = None, layer_name: str = None):
    """Reads the layer style (layer effects) already applied to layers in the open document.

    Photoshop calls these "layer styles" / "fx": Drop Shadow, Inner Shadow, Outer Glow,
    Inner Glow, Bevel & Emboss, Satin, Color Overlay, Gradient Overlay, Pattern Overlay
    and Stroke. Use this to find where a style lives, and to capture a style a human
    configured by hand so it can be replayed onto other layers with copy_layer_style
    or apply_layer_effects.

    Three modes:
        - layer_id given: returns that layer's FULL raw layerEffects descriptor, which is
          exactly what apply_layer_effects expects. This is the only lossless way to
          reproduce a hand-tuned style.
        - layer_name given: scans every layer with that name (all artboards) and reports
          which ones carry a style.
        - neither given: scans the whole document. Use this to locate a style when you do
          not know which layer has it. Only layers that actually have effects are returned.
          The scan narrows the field by the layer's fx eye, so a style that exists but was
          toggled OFF is not listed -- read such a layer by layer_id instead.

    Args:
        layer_id (int, optional): ID of a single layer to read in full.
        layer_name (str, optional): Restrict the scan to layers with this exact name.

    Returns:
        For layer_id: {layerId, name, effects: [human names], layerEffects: {raw descriptor}}.
        For a scan: {scanned, layersWithEffects: [{layerId, name, effects}]}.
        A layer with no style reports effects as an empty list and layerEffects as None.
    """

    command = createCommand("getLayerEffects", {
        "layerId":layer_id,
        "layerName":layer_name
    })

    return sendCommand(command)


@mcp.tool()
def copy_layer_style(
    source_layer_id: int,
    target_layer_name: str = None,
    target_layer_ids: list[int] = None,
    merge: bool = False
    ):
    """Copies the complete layer style from one layer onto other layers, byte for byte.

    This is the tool for "I configured a Gradient Overlay (or any fx) by hand on one
    artboard and want the identical thing on the same layer in every other artboard".
    It reads the source layer's raw descriptor and writes that descriptor to each target,
    so every setting -- gradient stops, angle, scale, blend mode, reverse, dither --
    is preserved exactly. Re-authoring a style from parameters cannot guarantee that.

    By default the targets are every OTHER layer in the document sharing the source
    layer's name, which is the multi-artboard case. The source layer itself is always
    excluded, so this is safe to re-run.

    WARNING for multi-artboard files: a Gradient Overlay whose "Align with layer" box is
    UNCHECKED (`align: false` in the descriptor) is measured against the whole canvas, not
    the layer. Copied to layers sitting at different x/y -- which is exactly what separate
    artboards are -- each one then renders a different slice of one document-wide gradient,
    so the artboards do NOT match. Verified: three identical artboards came out solid blue,
    gradient, and solid orange. If the copies look wrong, check that box on the source and
    copy again. Every other setting is position-independent.

    Args:
        source_layer_id (int): ID of the layer whose style should be copied. It must
            already have a style, otherwise this raises.
        target_layer_name (str, optional): Name to match targets on. Defaults to the
            source layer's own name.
        target_layer_ids (list[int], optional): Explicit target layer IDs. Takes
            precedence over target_layer_name.
        merge (bool): False (default) replaces each target's whole style with the
            source's. True keeps effects the target has that the source does not, and
            overwrites the ones it shares. Note that `set layerEffects` in Photoshop is
            always a whole-stack write, which is why replacing is the default and merging
            has to read each target first.

    Returns:
        {source: {layerId, name}, effects: [human names copied], applied: [{layerId, name}], count}
    """

    command = createCommand("copyLayerStyle", {
        "sourceLayerId":source_layer_id,
        "targetLayerName":target_layer_name,
        "targetLayerIds":target_layer_ids,
        "merge":merge
    })

    return sendCommand(command)


@mcp.tool()
def apply_layer_effects(
    layer_effects: dict,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = False
    ):
    """Writes a raw layerEffects descriptor onto one or more layers.

    Pair this with get_layer_effects(layer_id=...), which returns a descriptor in exactly
    the shape this expects. Use it when the source style lives in another document, or
    when it was captured earlier and needs replaying. To copy inside one document,
    copy_layer_style is simpler.

    Args:
        layer_effects (dict): The raw descriptor, as returned in get_layer_effects'
            `layerEffects` key. Keys are Photoshop effect names: dropShadow, innerShadow,
            outerGlow, innerGlow, bevelEmboss, chromeFX (Satin), solidFill (Color
            Overlay), gradientFill (Gradient Overlay), patternFill, frameFX (Stroke).
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name instead.
            One of layer_ids or layer_name is required.
        merge (bool): False (default) replaces each target's whole style. True merges on
            top of what the target already has.

    Returns:
        {applied: [{layerId, name}], count}
    """

    command = createCommand("applyLayerEffects", {
        "layerEffects":layer_effects,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "merge":merge
    })

    return sendCommand(command)


@mcp.tool()
def add_gradient_overlay_layer_style(
    angle: int,
    color_stops: list,
    opacity_stops: list,
    layer_ids: list[int] = None,
    layer_name: str = None,
    type: str = "LINEAR",
    blend_mode: str = "NORMAL",
    opacity: int = 100,
    scale: int = 100,
    reverse: bool = False,
    dither: bool = False,
    align_with_layer: bool = True,
    merge: bool = True
    ):
    """Adds a Gradient Overlay layer style (fx) to layers, built from parameters.

    This is a real layer EFFECT on the layer, unlike create_gradient_layer_style, which
    despite its name creates a separate Gradient Fill layer above the target and does not
    clip to it.

    To reproduce a gradient a human already tuned in the Photoshop UI, do NOT rebuild it
    here -- use copy_layer_style, which is lossless. Use this tool when the gradient is
    being specified from scratch.

    Args:
        angle (int): Gradient angle (-180 to 180). 90 is bottom-to-top.
        color_stops (list): Dicts defining color stops:
            - location (int): Position (0-100) along the gradient.
            - color (dict): RGB values (0-255 for red/green/blue).
            - midpoint (int, optional): Transition bias (0-100, default 50).
        opacity_stops (list): Dicts defining opacity stops:
            - location (int): Position (0-100) along the gradient.
            - opacity (int): Level (0=transparent, 100=opaque).
            - midpoint (int, optional): Transition bias (0-100, default 50).
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name instead.
            One of layer_ids or layer_name is required.
        type (str): LINEAR, RADIAL, ANGLE, REFLECTED or DIAMOND.
        blend_mode (str): Blend mode for the overlay. Defaults to NORMAL.
        opacity (int): Overlay opacity (0-100).
        scale (int): Gradient scale as a percentage (10-150).
        reverse (bool): Flip the gradient direction.
        dither (bool): Dither to reduce banding.
        align_with_layer (bool): Align the gradient to the layer bounds rather than the
            canvas. Photoshop's "Align with layer" checkbox. Keep the default True in a
            multi-artboard file: with False the gradient spans the whole canvas, so the
            same overlay on layers in different artboards renders differently in each.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this overlay -- `set layerEffects` is always a
            whole-stack write in Photoshop, so without merging an existing stroke or drop
            shadow is destroyed.

    Returns:
        {applied: [{layerId, name}], count}
    """

    command = createCommand("addGradientOverlayLayerStyle", {
        "layerIds":layer_ids,
        "layerName":layer_name,
        "angle":angle,
        "type":type,
        "colorStops":color_stops,
        "opacityStops":opacity_stops,
        "blendMode":blend_mode,
        "opacity":opacity,
        "scale":scale,
        "reverse":reverse,
        "dither":dither,
        "alignWithLayer":align_with_layer,
        "merge":merge
    })

    return sendCommand(command)


@mcp.tool()
def remove_layer_effects(layer_ids: list[int] = None, layer_name: str = None):
    """Removes the entire layer style (all effects) from one or more layers.

    Args:
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name instead.
            One of layer_ids or layer_name is required.

    Returns:
        {cleared: [{layerId, name}], count}
    """

    command = createCommand("removeLayerEffects", {
        "layerIds":layer_ids,
        "layerName":layer_name
    })

    return sendCommand(command)


@mcp.tool()
def get_artboards():
    """Lists every artboard in the open document with its position and size.

    Artboards are reported by the layer tools as plain groups, so this is the only way to
    tell which top-level groups are really artboards and where their frames sit. Read this
    before any resize or re-layout: artboard geometry is what the layout maths needs, and a
    group's cached bounds are NOT the artboard rect.

    Returns:
        {count, artboards: [{layerId, name, left, top, right, bottom, width, height}]}
        sorted left to right.
    """

    command = createCommand("getArtboards", {})

    return sendCommand(command)


@mcp.tool()
def create_artboard(name: str, width: int, height: int, left: int = 0, top: int = 0):
    """Creates a new, empty artboard.

    Args:
        name (str): Name for the artboard. Per-artboard export takes the output FILENAME
            from this name, so put the size in it if the deliverable needs it.
        width (int): Artboard width in pixels.
        height (int): Artboard height in pixels.
        left (int): X of the artboard's left edge in canvas coordinates.
        top (int): Y of the artboard's top edge in canvas coordinates.

    Place it clear of the existing artboards -- overlapping frames are what makes a later
    resize unrecoverable. get_artboards then arrange_artboards is the safe way to find room.

    Returns:
        {layerId, name, left, top, right, bottom, width, height}
    """

    command = createCommand("createArtboard", {
        "name":name,
        "width":width,
        "height":height,
        "left":left,
        "top":top
    })

    return sendCommand(command)


@mcp.tool()
def resize_artboard(
    width: int = None,
    height: int = None,
    left: int = None,
    top: int = None,
    artboard_ids: list[int] = None,
    artboard_name: str = None
    ):
    """Changes an artboard's frame size, holding its left/top corner by default.

    Left and top are held on purpose so the frame only ever grows right and down. Growing
    from the other side pushes layers outside the rect, and Photoshop EJECTS an ejected
    layer to the document root where per-artboard export will never find it again.

    ORDER MATTERS. Widening a frame while its neighbour sits 100px away makes the two
    overlap, and unpicking that means deleting layers, which has its own traps. For a whole
    set: arrange_artboards with a gap wider than any target size FIRST, then resize, lay out
    the contents, and arrange_artboards again to tile them back.

    Args:
        width (int, optional): New width. Unchanged if omitted.
        height (int, optional): New height. Unchanged if omitted.
        left (int, optional): Move the left edge. Held by default.
        top (int, optional): Move the top edge. Held by default.
        artboard_ids (list[int], optional): Which artboards. Omit both filters for ALL.
        artboard_name (str, optional): Artboards with this exact name.

    Returns:
        {applied: [{layerId, name, width, height}], count}. The rect is re-read from
        Photoshop afterwards and this RAISES if it did not actually change -- the underlying
        verb reports success while doing nothing, so a silent no-op is caught here.
    """

    command = createCommand("resizeArtboard", {
        "width":width,
        "height":height,
        "left":left,
        "top":top,
        "artboardIds":artboard_ids,
        "artboardName":artboard_name
    })

    return sendCommand(command)


@mcp.tool()
def move_artboard(
    x_offset: int = 0,
    y_offset: int = 0,
    artboard_ids: list[int] = None,
    artboard_name: str = None
    ):
    """Moves artboards by a pixel offset, carrying their contents with them.

    Args:
        x_offset (int): Pixels to move horizontally. Positive moves right.
        y_offset (int): Pixels to move vertically. Positive moves down.
        artboard_ids (list[int], optional): Which artboards. Omit both filters for ALL.
        artboard_name (str, optional): Artboards with this exact name.

    Returns:
        {applied: [{layerId, name}], count}
    """

    command = createCommand("moveArtboard", {
        "xOffset":x_offset,
        "yOffset":y_offset,
        "artboardIds":artboard_ids,
        "artboardName":artboard_name
    })

    return sendCommand(command)


@mcp.tool()
def arrange_artboards(gap: int = 100, start_left: int = 0, start_top: int = 0):
    """Tiles every artboard in one row, left to right, with a fixed gap.

    This is the step that makes a multi-artboard resize tractable. Call it with a gap wider
    than any target size BEFORE resizing anything, so a widened frame cannot land on its
    neighbour; resize and lay out; then call it again with the final gap to tile them back.

    Artboards keep their current left-to-right order.

    Args:
        gap (int): Pixels between artboards.
        start_left (int): X for the first artboard's left edge.
        start_top (int): Y for every artboard's top edge.

    Returns:
        {arranged: [{layerId, name, left, top, width, height, asRequested}], count,
         drifted: [...], boundingWidth}. Positions are re-read from Photoshop, so
         `asRequested` is measured rather than assumed; anything in `drifted` did not land
         where it was asked to.
    """

    command = createCommand("arrangeArtboards", {
        "gap":gap,
        "startLeft":start_left,
        "startTop":start_top
    })

    return sendCommand(command)


@mcp.tool()
def export_artboards(
    dest_folder: str,
    file_type: str = "png",
    quality: int = 90,
    artboard_ids: list[int] = None,
    artboard_name: str = None
    ):
    """Exports each artboard to its own image file.

    The OUTPUT FILENAME comes from the artboard's own name, not from any argument -- rename
    the artboards first if the deliverable needs particular filenames.

    Args:
        dest_folder (str): Absolute path of the output folder. It must ALREADY exist --
            nothing here creates it, and the call raises up front if it is missing.
        file_type (str): "png", "jpg", "gif", "tiff" or "psd".
        quality (int): Quality 0-100, for lossy types only. IGNORED for PNG: the underlying
            verb reads that field as PNG bit depth, and a 0-100 value there makes the export
            write nothing at all while still reporting success, so PNG is pinned to 32-bit.
        artboard_ids (list[int], optional): Which artboards. Omit both filters for ALL.
        artboard_name (str, optional): Artboards with this exact name.

    Returns:
        {exported: [{layerId, name, file}], count, requested, missing: [{layerId, name,
         expectedFile}], note}

    CHECK `count` AGAINST `requested`. Each file in `exported` was confirmed on disk before
    this returned, but a partial export is NOT an error here: the underlying verb reports
    SUCCESS even when it writes nothing, so an artboard that produced no file is reported in
    `missing` and the rest still run. Only a run where NOTHING was written raises.
    """

    command = createCommand("exportArtboards", {
        "destFolder":dest_folder,
        "fileType":file_type,
        "quality":quality,
        "artboardIds":artboard_ids,
        "artboardName":artboard_name
    })

    return sendCommand(command)


@mcp.tool()
def get_text_style(layer_id: int):
    """Reads the typography of a text layer, run by run.

    Photoshop stores character formatting as a list of styled RUNS over the string, so one
    text layer can hold several fonts, sizes and colours. This reports each run in readable
    form AND returns Photoshop's raw descriptor, which is what copy_text_style and
    apply_text_style replay.

    Use it before touching any text: `edit_text_layer` with text_color silently rewrote
    GTAmerica-CondensedBold to MyriadPro-Regular, because writing one character attribute
    replaces the whole run. Read first, and you can tell afterwards whether the font
    survived.

    Args:
        layer_id (int): ID of the text layer.

    Returns:
        {layerId, name, contents, contentsLength, runCount,
         runs: [{from, to, text, font, fontStyle, size, leading, tracking, color, allCaps,
                 syntheticBold, syntheticItalic}],
         textStyleRange: [raw descriptor]}
        `leading` reads "auto" when auto-leading is on. Raises if the layer is not text.
    """

    command = createCommand("getTextStyle", {
        "layerId":layer_id
    })

    return sendCommand(command)


@mcp.tool()
def copy_text_style(
    source_layer_id: int,
    target_layer_name: str = None,
    target_layer_ids: list[int] = None,
    mode: str = "UNIFORM"
    ):
    """Copies typography from one text layer onto other text layers, without touching their text.

    This is the safe way to push a font, size, tracking, leading and colour across a banner
    set: it writes Photoshop's own style descriptor back verbatim rather than setting
    attributes one at a time, which is what destroys fonts.

    By default the targets are every OTHER text layer sharing the source's name -- the
    multi-artboard case. The source is always excluded, so re-running is safe. Layers that
    are not text layers are reported in `skipped`, never edited.

    Args:
        source_layer_id (int): Text layer to copy the style FROM.
        target_layer_name (str, optional): Name to match targets on. Defaults to the
            source layer's own name.
        target_layer_ids (list[int], optional): Explicit target IDs. Beats target_layer_name.
        mode (str): "UNIFORM" (default) applies the source's FIRST run style to the whole of
            each target's text. This is almost always what you want across sizes, because
            the same headline wraps to one line at 728x90 and three at 300x600, so run
            boundaries never line up. "PER_RUN" replays the source's exact run boundaries and
            raises unless the target's text is the same length -- use it only for a genuine
            mixed-style line, e.g. one bold word inside a sentence, on identical copy.

    Returns:
        {source: {layerId, name, fonts}, mode, applied: [{layerId, name, fonts, runCount}],
         count, skipped: [{layerId, name, reason}]}
        `fonts` on each applied layer is re-read from Photoshop after the write, so compare
        it against the source's to confirm the font actually landed. A layer whose readback
        failed comes back as {layerId, name, verified: false, reason} with no `fonts` -- the
        style was written, it just could not be confirmed, so check that layer by hand.
    """

    command = createCommand("copyTextStyle", {
        "sourceLayerId":source_layer_id,
        "targetLayerName":target_layer_name,
        "targetLayerIds":target_layer_ids,
        "mode":mode
    })

    return sendCommand(command)


@mcp.tool()
def apply_text_style(
    text_style_range: list,
    layer_ids: list[int] = None,
    layer_name: str = None,
    uniform: bool = True
    ):
    """Writes a raw textStyleRange descriptor onto text layers.

    Pair this with get_text_style, whose `textStyleRange` output is exactly the shape this
    expects. Use it when the style was captured earlier or comes from another document; to
    copy within one document, copy_text_style is simpler.

    Args:
        text_style_range (list): Raw descriptor from get_text_style's `textStyleRange`.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name.
            One of layer_ids or layer_name is required.
        uniform (bool): True (default) applies the first run's style across each target's
            whole string. False replays the run boundaries and raises on a length mismatch.

    Returns:
        {applied: [{layerId, name}], count, skipped: [{layerId, name, reason}]}
    """

    command = createCommand("applyTextStyle", {
        "textStyleRange":text_style_range,
        "layerIds":layer_ids,
        "layerName":layer_name,
        "uniform":uniform
    })

    return sendCommand(command)


@mcp.tool()
def add_inner_shadow_layer_style(
    color: dict = {"red": 0, "green": 0, "blue": 0},
    blend_mode: str = "MULTIPLY",
    opacity: int = 35,
    angle: int = 120,
    distance: int = 5,
    choke: int = 0,
    size: int = 5,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds an Inner Shadow layer style -- a shadow cast INSIDE the layer's edges.

    Args:
        color (dict): Shadow colour as RGB 0-255.
        blend_mode (str): Blend mode. MULTIPLY is Photoshop's default.
        opacity (int): 0-100.
        angle (int): Light direction, -180 to 180.
        distance (int): Offset in pixels.
        choke (int): Hardens the shadow's edge, 0-100.
        size (int): Blur radius in pixels.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addInnerShadowLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "color":color, "blendMode":blend_mode, "opacity":opacity,
        "angle":angle, "distance":distance, "choke":choke, "size":size
    })

    return sendCommand(command)


@mcp.tool()
def add_outer_glow_layer_style(
    color: dict = {"red": 255, "green": 255, "blue": 190},
    blend_mode: str = "SCREEN",
    opacity: int = 35,
    spread: int = 0,
    size: int = 5,
    noise: int = 0,
    technique: str = "SOFTER",
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds an Outer Glow layer style -- a halo spreading outward from the layer's edges.

    Args:
        color (dict): Glow colour as RGB 0-255.
        blend_mode (str): Blend mode. SCREEN is Photoshop's default and the one that reads
            as light; NORMAL makes it look like a flat outline.
        opacity (int): 0-100.
        spread (int): Pushes the glow outward before it fades, 0-100.
        size (int): Blur radius in pixels.
        noise (int): Grain in the glow, 0-100.
        technique (str): "SOFTER" (default) for a blurred falloff, "PRECISE" for a hard
            edge that follows the shape.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addOuterGlowLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "color":color, "blendMode":blend_mode, "opacity":opacity,
        "spread":spread, "size":size, "noise":noise, "technique":technique
    })

    return sendCommand(command)


@mcp.tool()
def add_inner_glow_layer_style(
    color: dict = {"red": 255, "green": 255, "blue": 190},
    blend_mode: str = "SCREEN",
    opacity: int = 35,
    spread: int = 0,
    size: int = 5,
    noise: int = 0,
    technique: str = "SOFTER",
    source: str = "EDGE",
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds an Inner Glow layer style -- light inside the layer's edges.

    Args:
        color (dict): Glow colour as RGB 0-255.
        blend_mode (str): Blend mode. SCREEN is Photoshop's default.
        opacity (int): 0-100.
        spread (int): Pushes the glow inward before it fades, 0-100.
        size (int): Blur radius in pixels.
        noise (int): Grain in the glow, 0-100.
        technique (str): "SOFTER" (default) for a blurred falloff, "PRECISE" for a hard
            edge that follows the shape.
        source (str): "EDGE" glows inward from the outline, "CENTER" glows outward from the
            middle. Photoshop's "Source" radio buttons.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addInnerGlowLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "color":color, "blendMode":blend_mode, "opacity":opacity,
        "spread":spread, "size":size, "noise":noise,
        "technique":technique, "source":source
    })

    return sendCommand(command)


@mcp.tool()
def add_satin_layer_style(
    color: dict = {"red": 0, "green": 0, "blue": 0},
    blend_mode: str = "MULTIPLY",
    opacity: int = 50,
    angle: int = 90,
    distance: int = 8,
    size: int = 7,
    invert: bool = False,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds a Satin layer style -- shading folded from the layer's own shape.

    Args:
        color (dict): Shading colour as RGB 0-255.
        blend_mode (str): Blend mode. MULTIPLY is Photoshop's default.
        opacity (int): 0-100.
        angle (int): -180 to 180.
        distance (int): Offset in pixels.
        size (int): Blur radius in pixels.
        invert (bool): Flips which parts of the shape are shaded.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addSatinLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "color":color, "blendMode":blend_mode, "opacity":opacity,
        "angle":angle, "distance":distance, "size":size, "invert":invert
    })

    return sendCommand(command)


@mcp.tool()
def add_color_overlay_layer_style(
    color: dict = {"red": 0, "green": 0, "blue": 0},
    blend_mode: str = "NORMAL",
    opacity: int = 100,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds a Color Overlay layer style -- flat colour over the layer, non-destructively.

    Prefer this over filling a layer when the colour has to stay editable, and over
    edit_text_layer's text_color for a text layer: that argument rewrites the character run
    and has destroyed fonts. An overlay leaves the type untouched.

    Args:
        color (dict): Overlay colour as RGB 0-255.
        blend_mode (str): Blend mode.
        opacity (int): 0-100.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addColorOverlayLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "color":color, "blendMode":blend_mode, "opacity":opacity
    })

    return sendCommand(command)


@mcp.tool()
def add_bevel_emboss_layer_style(
    style: str = "INNER",
    technique: str = "SMOOTH",
    direction: str = "UP",
    depth: int = 100,
    size: int = 5,
    soften: int = 0,
    angle: int = 120,
    altitude: int = 30,
    highlight_color: dict = {"red": 255, "green": 255, "blue": 255},
    highlight_blend_mode: str = "SCREEN",
    highlight_opacity: int = 75,
    shadow_color: dict = {"red": 0, "green": 0, "blue": 0},
    shadow_blend_mode: str = "MULTIPLY",
    shadow_opacity: int = 75,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds a Bevel & Emboss layer style -- a lit edge that reads as raised or carved.

    Args:
        style (str): "INNER" (default), "OUTER", "EMBOSS", "PILLOW" or "STROKE". Photoshop's
            own default when this is not sent is OUTER, not the INNER the dialog opens on,
            so it is always written explicitly.
        technique (str): "SMOOTH" (default), "CHISEL_HARD" or "CHISEL_SOFT".
        direction (str): "UP" (default) or "DOWN".
        depth (int): Strength of the bevel, 1-1000 percent.
        size (int): Bevel width in pixels.
        soften (int): Blurs the bevel, 0-16 pixels.
        angle (int): Light direction, -180 to 180.
        altitude (int): Light height, 0-90. Low is a raking light, 90 is straight on.
        highlight_color (dict): Lit-side colour as RGB 0-255.
        highlight_blend_mode (str): Blend mode for the lit side.
        highlight_opacity (int): 0-100.
        shadow_color (dict): Shaded-side colour as RGB 0-255.
        shadow_blend_mode (str): Blend mode for the shaded side.
        shadow_opacity (int): 0-100.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addBevelEmbossLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "style":style, "technique":technique, "direction":direction,
        "depth":depth, "size":size, "soften":soften,
        "angle":angle, "altitude":altitude,
        "highlightColor":highlight_color, "highlightBlendMode":highlight_blend_mode,
        "highlightOpacity":highlight_opacity,
        "shadowColor":shadow_color, "shadowBlendMode":shadow_blend_mode,
        "shadowOpacity":shadow_opacity
    })

    return sendCommand(command)


@mcp.tool()
def add_pattern_overlay_layer_style(
    pattern_name: str,
    pattern_id: str,
    blend_mode: str = "NORMAL",
    opacity: int = 100,
    scale: int = 100,
    linked: bool = True,
    layer_ids: list[int] = None,
    layer_name: str = None,
    merge: bool = True
    ):
    """Adds a Pattern Overlay layer style.

    The pattern must ALREADY exist in the document's pattern presets -- there is no API here
    to create one. Get its name and ID by applying the pattern to any layer by hand once and
    reading it back with get_layer_effects(layer_id=...): the `patternFill.pattern` object
    holds both.

    Args:
        pattern_name (str): The preset's name, exactly as Photoshop reports it.
        pattern_id (str): The preset's GUID, from get_layer_effects.
        blend_mode (str): Blend mode.
        opacity (int): 0-100.
        scale (int): Pattern scale, 1-1000 percent.
        linked (bool): Link the pattern to the layer so it moves with it.
        layer_ids (list[int], optional): Target layer IDs.
        layer_name (str, optional): Target every layer with this exact name -- in a
            multi-artboard file that is one call for the whole set. One of layer_ids or
            layer_name is required.
        merge (bool): True (default) keeps the layer's other effects. False replaces the
            whole style with just this one, because `set layerEffects` is always a
            whole-stack write in Photoshop.

    Returns:
        {applied: [{layerId, name, effects}], count}. `effects` is re-read from Photoshop
        after the write, and the call RAISES if the effect is not actually present -- these
        descriptors ignore a field they do not understand rather than failing, so the
        readback is the only real proof.
    """

    command = createCommand("addPatternOverlayLayerStyle", {
        "layerIds":layer_ids, "layerName":layer_name, "merge":merge,
        "patternName":pattern_name, "patternId":pattern_id,
        "blendMode":blend_mode, "opacity":opacity, "scale":scale, "linked":linked
    })

    return sendCommand(command)


@mcp.tool()
def duplicate_layer(layer_to_duplicate_id:int, duplicate_layer_name:str):
    """
    Duplicates the layer specified by layer_to_duplicate_id ID, creating a new layer above it with the name specified by duplicate_layer_name

    Args:
        layer_to_duplicate_id (id): The id of the layer to be duplicated
        duplicate_layer_name (str): Name for the newly created layer
    """

    command = createCommand("duplicateLayer", {
        "sourceLayerId":layer_to_duplicate_id,
        "duplicateLayerName":duplicate_layer_name,
    })

    return sendCommand(command)

@mcp.tool()
def flatten_all_layers(layer_name:str):
    """
    Flatten all layers in the document into a single layer with specified name

    Args:
        layer_name (str): The name of the merged layer
    """

    command = createCommand("flattenAllLayers", {
        "layerName":layer_name,
    })

    return sendCommand(command)

@mcp.tool()
def add_color_balance_adjustment_layer(
    layer_id: int,
    highlights:list = [0,0,0],
    midtones:list = [0,0,0],
    shadows:list = [0,0,0]):
    """Adds an adjustment layer to the layer with the specified ID to adjust color balance

    Each property highlights, midtones and shadows contains an array of 3 values between
    -100 and 100 that represent the relative position between two colors.

    First value is between cyan and red
    The second value is between magenta and green
    The third value is between yellow and blue    

    Args:
        layer_id (int): The ID of the layer to apply the color balance adjustment layer
        highlights (list): Relative color values for highlights
        midtones (list): Relative color values for midtones
        shadows (list): Relative color values for shadows
    """

    command = createCommand("addColorBalanceAdjustmentLayer", {
        "layerId":layer_id,
        "highlights":highlights,
        "midtones":midtones,
        "shadows":shadows
    })

    return sendCommand(command)

@mcp.tool()
def add_brightness_contrast_adjustment_layer(
    layer_id: int,
    brightness:int = 0,
    contrast:int = 0):
    """Adds an adjustment layer to the layer with the specified ID to adjust brightness and contrast

    Args:
        layer_id (int): The ID of the layer to apply the brightness and contrast adjustment layer
        brightness (int): The brightness value (-150 to 150)
        contrasts (int): The contrast value (-50 to 100)
    """

    command = createCommand("addBrightnessContrastAdjustmentLayer", {
        "layerId":layer_id,
        "brightness":brightness,
        "contrast":contrast
    })

    return sendCommand(command)


@mcp.tool()
def add_stroke_layer_style(
    layer_id: int,
    size: int = 2,
    color: dict = {"red": 0, "green": 0, "blue": 0},
    opacity: int = 100,
    position: str = "CENTER",
    blend_mode: str = "NORMAL"
    ):
    """Adds a stroke layer style to the layer with the specified ID.
    
    Args:
        layer_id (int): The ID of the layer to apply the stroke effect to.
        size (int, optional): The width of the stroke in pixels. Defaults to 2.
        color (dict, optional): The color of the stroke as RGB values. Defaults to black {"red": 0, "green": 0, "blue": 0}.
        opacity (int, optional): The opacity of the stroke as a percentage (0-100). Defaults to 100.
        position (str, optional): The position of the stroke relative to the layer content. 
                                 Options include "CENTER", "INSIDE", or "OUTSIDE". Defaults to "CENTER".
        blend_mode (str, optional): The blend mode for the stroke effect. Defaults to "NORMAL".
    """

    command = createCommand("addStrokeLayerStyle", {
        "layerId":layer_id,
        "size":size,
        "color":color,
        "opacity":opacity,
        "position":position,
        "blendMode":blend_mode
    })

    return sendCommand(command)


@mcp.tool()
def add_vibrance_adjustment_layer(
    layer_id: int,
    vibrance:int = 0,
    saturation:int = 0):
    """Adds an adjustment layer to layer with the specified ID to adjust vibrance and saturation
    
    Args:
        layer_id (int): The ID of the layer to apply the vibrance and saturation adjustment layer
        vibrance (int): Controls the intensity of less-saturated colors while preventing oversaturation of already-saturated colors. Range -100 to 100.
        saturation (int): Controls the intensity of all colors equally. Range -100 to 100.
    """
    #0.1 to 255

    command = createCommand("addAdjustmentLayerVibrance", {
        "layerId":layer_id,
        "saturation":saturation,
        "vibrance":vibrance
    })

    return sendCommand(command)

@mcp.tool()
def add_black_and_white_adjustment_layer(
    layer_id: int,
    colors: dict = {"blue": 20, "cyan": 60, "green": 40, "magenta": 80, "red": 40, "yellow": 60},
    tint: bool = False,
    tint_color: dict = {"red": 225, "green": 211, "blue": 179}
):
    """Adds a Black & White adjustment layer to the specified layer.
    
    Creates an adjustment layer that converts the target layer to black and white. Optionally applies a color tint to the result.
    
    Args:
        layer_id (int): The ID of the layer to apply the black and white adjustment to.
        colors (dict): Controls how each color channel converts to grayscale. Values range from 
                      -200 to 300, with higher values making that color appear lighter in the 
                      conversion. Must include all keys: red, yellow, green, cyan, blue, magenta.
        tint (bool, optional): Whether to apply a color tint to the black and white result.
                              Defaults to False.
        tint_color (dict, optional): The RGB color dict to use for tinting
                                    with "red", "green", and "blue" keys (values 0-255).
    """

    command = createCommand("addAdjustmentLayerBlackAndWhite", {
        "layerId":layer_id,
        "colors":colors,
        "tint":tint,
        "tintColor":tint_color
    })

    return sendCommand(command)

@mcp.tool()
def apply_gaussian_blur(layer_id: int, radius: float = 2.5):
    """Applies a Gaussian Blur to the layer with the specified ID
    
    Args:
        layer_id (int): ID of layer to be blurred
        radius (float): The blur radius in pixels determining the intensity of the blur effect. Default is 2.5.
        Valid values range from 0.1 (subtle blur) to 10000 (extreme blur).

    Returns:
        dict: Response from the Photoshop operation
        
    Raises:
        RuntimeError: If the operation fails or times out
    """



    command = createCommand("applyGaussianBlur", {
        "layerId":layer_id,
        "radius":radius,
    })

    return sendCommand(command)




@mcp.tool()
def apply_motion_blur(layer_id: int, angle: int = 0, distance: float = 30):
    """Applies a Motion Blur to the layer with the specified ID

    Args:
    layer_id (int): ID of layer to be blurred
    angle (int): The angle in degrees (0 to 360) that determines the direction of the motion blur effect. Default is 0.
    distance (float): The distance in pixels that controls the length/strength of the motion blur. Default is 30.
        Higher values create a more pronounced motion effect.

    Returns:
        dict: Response from the Photoshop operation
        
    Raises:
        RuntimeError: If the operation fails or times out
    """


    command = createCommand("applyMotionBlur", {
        "layerId":layer_id,
        "angle":angle,
        "distance":distance
    })

    return sendCommand(command)


@mcp.resource("config://get_instructions")
def get_instructions() -> str:
    """Read this first! Returns information and instructions on how to use Photoshop and this API"""

    return f"""
    You are a photoshop expert who is creative and loves to help other people learn to use Photoshop and create. You are well versed in composition, design and color theory, and try to follow that theory when making decisions.

    Unless otherwise specified, all commands act on the currently active document in Photoshop

    Rules to follow:

    1. Think deeply about how to solve the task
    2. Always check your work
    3. You can view the current visible photoshop file by calling get_document_image
    4. Pay attention to font size (dont make it too big)
    5. Always use alignment (align_content()) to position your text.
    6. Read the info for the API calls to make sure you understand the requirements and arguments
    7. When you make a selection, clear it once you no longer need it

    Here are some general tips for when working with Photoshop.

    In general, layers are created from bottom up, so keep that in mind as you figure out the order or operations. If you want you have lower layers show through higher ones you must either change the opacity of the higher layers and / or blend modes.

    When using fonts there are a couple of things to keep in mind. First, the font origin is the bottom left of the font, not the top right.

    Suggestions for sizes:
    Paragraph text : 8 to 12 pts
    Headings : 14 - 20 pts
    Single Word Large : 20 to 25pt

    Pay attention to what layer names are needed for. Sometimes the specify the name of a newly created layer and sometimes they specify the name of the layer that the action should be performed on.

    As a general rule, you should not flatten files unless asked to do so, or its necessary to apply an effect or look.

    When generating an image, you do not need to first create a pixel layer. A layer will automatically be created when you generate the image.

    Colors are defined via a dict with red, green and blue properties with values between 0 and 255
    {{"red":255, "green":0, "blue":0}}

    Bounds is defined as a dict with top, left, bottom and right properties
    {{"top": 0, "left": 0, "bottom": 250, "right": 300}}

    Valid options for API calls:

    alignment_modes: {", ".join(alignment_modes)}

    justification_modes: {", ".join(justification_modes)}

    blend_modes: {", ".join(blend_modes)}

    anchor_positions: {", ".join(anchor_positions)}

    interpolation_methods: {", ".join(interpolation_methods)}

    fonts: {", ".join(font_names[:FONT_LIMIT])}
    """

font_names = list_all_fonts_postscript()

interpolation_methods = [
   "AUTOMATIC",
   "BICUBIC",
   "BICUBICSHARPER",
   "BICUBICSMOOTHER",
   "BILINEAR",
   "NEARESTNEIGHBOR"
]

anchor_positions = [
   "BOTTOMCENTER",
   "BOTTOMLEFT", 
   "BOTTOMRIGHT", 
   "MIDDLECENTER", 
   "MIDDLELEFT", 
   "MIDDLERIGHT", 
   "TOPCENTER", 
   "TOPLEFT", 
   "TOPRIGHT"
]

justification_modes = [
    "CENTER",
    "CENTERJUSTIFIED",
    "FULLYJUSTIFIED",
    "LEFT",
    "LEFTJUSTIFIED",
    "RIGHT",
    "RIGHTJUSTIFIED"
]

alignment_modes = [
    "LEFT",
    "CENTER_HORIZONTAL",
    "RIGHT",
    "TOP",
    "CENTER_VERTICAL",
    "BOTTOM"
]

blend_modes = [
    "COLOR",
    "COLORBURN",
    "COLORDODGE",
    "DARKEN",
    "DARKERCOLOR",
    "DIFFERENCE",
    "DISSOLVE",
    "DIVIDE",
    "EXCLUSION",
    "HARDLIGHT",
    "HARDMIX",
    "HUE",
    "LIGHTEN",
    "LIGHTERCOLOR",
    "LINEARBURN",
    "LINEARDODGE",
    "LINEARLIGHT",
    "LUMINOSITY",
    "MULTIPLY",
    "NORMAL",
    "OVERLAY",
    "PASSTHROUGH",
    "PINLIGHT",
    "SATURATION",
    "SCREEN",
    "SOFTLIGHT",
    "SUBTRACT",
    "VIVIDLIGHT"
]
