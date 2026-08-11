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

const { app, constants, core } = require("photoshop");
const fs = require("uxp").storage.localFileSystem;
const openfs = require('fs')


const convertFontSize = (fontSize) => {
    return (app.activeDocument.resolution / 72) * fontSize
}

const convertFromPhotoshopFontSize = (photoshopFontSize) => {
    return photoshopFontSize / (app.activeDocument.resolution / 72);
}

// Photoshop's text engine only breaks lines on CR. Text arriving over JSON carries
// LF, and callers often send a literal "\n" instead, so both are stored verbatim
// and render as a missing-glyph box. Normalise every form to CR.
const normalizeLineBreaks = (contents) => {
    if (typeof contents !== "string") {
        return contents;
    }

    return contents
        .replace(/\\r\\n|\\n|\\r/g, "\r")
        .replace(/\r\n|\n/g, "\r");
}

const createFile = async (filePath) => {
    let url = `file:${filePath}`
    const fd = await openfs.open(url, "a+");
    await openfs.close(fd)

    return url
}

const parseColor = (color) => {
    try {
        const c = new app.SolidColor();
        c.rgb.red = color.red;
        c.rgb.green = color.green;
        c.rgb.blue = color.blue;

        return c;
    } catch (e) {
        throw new Error(`Invalid color values: ${JSON.stringify(color)}`);
    }
};

const getAlignmentMode = (mode) => {
    switch (mode) {
        case "LEFT":
            return "ADSLefts";
        case "CENTER_HORIZONTAL":
            return "ADSCentersH";
        case "RIGHT":
            return "ADSRights";
        case "TOP":
            return "ADSTops";
        case "CENTER_VERTICAL":
            return "ADSCentersV";
        case "BOTTOM":
            return "ADSBottoms";
        default:
            throw new Error(
                `getAlignmentMode : Unknown alignment mode : ${mode}`
            );
    }
};

const getJustificationMode = (value) => {
    return getConstantValue(constants.Justification, value, "Justification");
};

const getBlendMode = (value) => {
    return getConstantValue(constants.BlendMode, value, "BlendMode");
};

const getInterpolationMethod = (value) => {
    return getConstantValue(
        constants.InterpolationMethod,
        value,
        "InterpolationMethod"
    );
};

const getAnchorPosition = (value) => {
    return getConstantValue(constants.AnchorPosition, value, "AnchorPosition");
};

const getNewDocumentMode = (value) => {
    return getConstantValue(
        constants.NewDocumentMode,
        value,
        "NewDocumentMode"
    );
};

const getConstantValue = (c, v, n) => {
    let out = c[v.toUpperCase()];

    if (!out) {
        throw new Error(`getConstantValue : Unknown constant value :${c} ${v}`);
    }

    return out;
};

const selectLayer = (layer, exclusive = false) => {
    if (exclusive) {
        clearLayerSelections();
    }

    layer.selected = true;
};

const clearLayerSelections = (layers) => {
    if (!layers) {
        layers = app.activeDocument.layers;
    }

    for (const layer of layers) {
        layer.selected = false;

        if (layer.layers && layer.layers.length > 0) {
            clearLayerSelections(layer.layers);
        }
    }
};

const setVisibleAllLayers = (visible, layers) => {
    if (!layers) {
        layers = app.activeDocument.layers;
    }

    for (const layer of layers) {
        layer.visible = visible

        if (layer.layers && layer.layers.length > 0) {
            setVisibleAllLayers(visible, layer.layers)
        }
    }
};


const findLayer = (id, layers) => {
    if (!layers) {
        layers = app.activeDocument.layers;
    }

    for (const layer of layers) {
        if (layer.id === id) {
            return layer;
        }

        if (layer.layers && layer.layers.length > 0) {
            const found = findLayer(id, layer.layers);
            if (found) {
                return found; // Stop as soon as we’ve found the target layer
            }
        }
    }

    return null;
};


const findLayerByName = (name, layers) => {
    if (!layers) {
        layers = app.activeDocument.layers;
    }

    return app.activeDocument.layers.getByName(name);
};

const _saveDocumentAs = async (filePath, fileType) => {

    let url = await createFile(filePath)

    let saveFile = await fs.getEntryWithUrl(url);

    return await execute(async () => {

        fileType = fileType.toUpperCase()
        if (fileType == "JPG") {
            await app.activeDocument.saveAs.jpg(saveFile, {
                quality:9
            }, true)
        } else if (fileType == "PNG") {
            await app.activeDocument.saveAs.png(saveFile, {
            }, true)
        } else {
            await app.activeDocument.saveAs.psd(saveFile, {
                alphaChannels:true,
                annotations:true,
                embedColorProfile:true,
                layers:true,
                maximizeCompatibility:true,
                spotColor:true,
            }, true)
        }

        return {savedFilePath:saveFile.nativePath}
    });
};

const execute = async (callback, commandName = "Executing command...") => {
    try {
        return await core.executeAsModal(async (executionContext) => {
            //commandName on executeAsModal only labels the progress UI. Without
            //suspendHistory every internal mutation lands as its own native
            //history state, so a single command can litter the history panel
            //and take several undos to back out.
            let hostControl = executionContext.hostControl;
            let documentID = app.activeDocument ? app.activeDocument.id : null;
            let suspensionID = null;

            if (documentID !== null) {
                try {
                    suspensionID = await hostControl.suspendHistory({
                        documentID: documentID,
                        name: commandName,
                    });
                } catch (e) {
                    //not fatal: fall back to unsuspended history
                    console.log(`suspendHistory failed : ${e}`);
                }
            }

            try {
                return await callback(executionContext);
            } finally {
                if (suspensionID !== null) {
                    try {
                        await hostControl.resumeHistory(suspensionID);
                    } catch (e) {
                        console.log(`resumeHistory failed : ${e}`);
                    }
                }
            }
        }, {
            commandName: commandName,
        });
    } catch (e) {
        throw new Error(`Error executing command [modal] : ${e}`);
    }
};

const tokenify = async (url) => {
    let out = await fs.createSessionToken(
        await fs.getEntryWithUrl("file:" + url)
    );
    return out;
};

const getElementPlacement = (placement) => {
    return constants.ElementPlacement[placement.toUpperCase()];
};

const hasActiveSelection = () => {
    return app.activeDocument.selection.bounds != null;
};

const getMostRecentlyModifiedFile = async (directoryPath)  => {
    try {
      // Get directory contents
      const dirEntries = await openfs.readdir(directoryPath);
      
      const fileDetails = [];
      
      // Process each file
      let i = 0
      for (const entry of dirEntries) {
        console.log(i++)
        const filePath = window.path.join(directoryPath, entry);
        
        // Get file stats using lstat
        try {
          const stats = await openfs.lstat(filePath);

          // Skip if it's a directory
          if (stats.isDirectory()) {
            continue;
          }
          
          fileDetails.push({
            name: entry,
            path: filePath,
            modifiedTime: stats.mtime,  // Date object
            modifiedTimestamp: stats.mtimeMs  // Use mtimeMs directly instead of getTime()
          });
        } catch (err) {
          console.log(`Error getting stats for ${filePath}:`, err);
          // Continue to next file if there's an error with this one
          continue;
        }
      }
      
      if (fileDetails.length === 0) {
        return null;
      }
      
      // Sort by modification timestamp (newest first)
      fileDetails.sort((a, b) => b.modifiedTimestamp - a.modifiedTimestamp);
      
      // Return the most recently modified file
      return fileDetails[0];
    } catch (err) {
      console.error('Error getting most recently modified file:', err);
      return null;
    }
  }

  const fileExists = async (filePath) => {
    try {
      await openfs.lstat(`file:${filePath}`);
      return true;
    } catch (error) {
        return false;
    }
  }

  const generateDocumentInfo = (document, activeDocument) => {
    return {
            name:document.name,
            id:document.id,
            isActive: document === activeDocument,
            path:document.path,
            saved:document.saved,
            title:document.title
        };
}

const listOpenDocuments = () => {
    const docs = app.documents;
    const activeDocument = app.activeDocument

    let out = []

    for (let doc of docs) {
        let d = generateDocumentInfo(doc, activeDocument)
        out.push(d)
    }

    return out
}

module.exports = {
    findLayerByName,
    generateDocumentInfo,
    listOpenDocuments,
    convertFromPhotoshopFontSize,
    convertFontSize,
    normalizeLineBreaks,
    setVisibleAllLayers,
    _saveDocumentAs,
    getMostRecentlyModifiedFile,
    fileExists,
    createFile,
    parseColor,
    getAlignmentMode,
    getJustificationMode,
    getBlendMode,
    getInterpolationMethod,
    getAnchorPosition,
    getNewDocumentMode,
    getConstantValue,
    selectLayer,
    clearLayerSelections,
    findLayer,
    execute,
    tokenify,
    getElementPlacement,
    hasActiveSelection
}