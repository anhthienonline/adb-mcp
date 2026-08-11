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

const { app, constants, action, imaging } = require("photoshop");
const fs = require("uxp").storage.localFileSystem;

const {
    setVisibleAllLayers,
    findLayer,
    execute,
    parseColor,
    getAnchorPosition,
    getInterpolationMethod,
    getBlendMode,
    getJustificationMode,
    selectLayer,
    hasActiveSelection,
    _saveDocumentAs,
    convertFontSize,
    convertFromPhotoshopFontSize,
    normalizeLineBreaks
} = require("./utils");


// Function to capture visibility state
const _captureVisibilityState = (layers) => {
    const state = new Map();

    const capture = (layerSet) => {
        for (const layer of layerSet) {
            state.set(layer.id, layer.visible);
            if (layer.layers && layer.layers.length > 0) {
                capture(layer.layers);
            }
        }
    };

    capture(layers);
    return state;
};

// Function to restore visibility state
const _restoreVisibilityState = async (state) => {
    const restore = (layerSet) => {
        for (const layer of layerSet) {
            if (state.has(layer.id)) {
                layer.visible = state.get(layer.id);
            }

            if (layer.layers && layer.layers.length > 0) {
                restore(layer.layers);
            }
        }
    };

    await execute(async () => {
        restore(app.activeDocument.layers);
    });
};

const exportLayersAsPng = async (command) => {
    let options = command.options;
    let layersInfo = options.layersInfo;

    const results = [];


    let originalState;
    await execute(async () => {
        originalState = _captureVisibilityState(app.activeDocument.layers);
        setVisibleAllLayers(false);
    });

    for (const info of layersInfo) {
        let result = {};

        let layer = findLayer(info.layerId);

        try {
            if (!layer) {
                throw new Error(
                    `exportLayersAsPng: Could not find layer with ID: [${info.layerId}]` // Fixed error message
                );
            }
            await execute(async () => {
                layer.visible = true;
            });

            let tmp = await _saveDocumentAs(info.filePath, "PNG");

            result = {
                ...tmp,
                layerId: info.layerId,
                success: true
            };

        } catch (e) {
            result = {
                ...info,
                success: false,
                message: e.message
            };
        } finally {
            if (layer) {
                await execute(async () => {
                    layer.visible = false;
                });
            }
        }

        results.push(result);
    }

    //_restoreVisibilityState opens its own modal scope, so do not wrap it in
    //another one: nested executeAsModal calls throw, which used to leave every
    //layer stuck in the visibility state the export loop left behind.
    await _restoreVisibilityState(originalState);

    return results;
};

//The batchPlay fallback anchors by freeTransformCenterState, not by the
//AnchorPosition the caller passed. Hardcoding QCSAverage made every anchor
//behave as MIDDLECENTER: a TOPLEFT scale silently drifted by half the size
//change and had to be corrected by hand.
//
//Only QCSAverage (= MIDDLECENTER) is used here. The corner/side states exist
//(QCSCorner0.., QCSSide0..) but which one is top-left is not verified, and an
//unverified mapping anchors to the wrong corner just as silently as the bug it
//would replace. Reject other anchors loudly; scale about the centre and then
//translate to place the result.
const _quadCenterState = (anchorPosition) => {
    let a = String(anchorPosition || "MIDDLECENTER").toUpperCase();

    if (a === "MIDDLECENTER") {
        return "QCSAverage";
    }

    throw new Error(
        `scaleLayer : anchorPosition [${anchorPosition}] cannot be honoured for a layer inside an artboard - the batchPlay fallback only supports MIDDLECENTER. Scale about MIDDLECENTER, then translateLayer to the position you want.`
    );
};

const scaleLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `scaleLayer : Could not find layer with ID : [${layerId}]`
        );
    }

    //The anchor is NOT validated here on purpose. layer.scale() honours all nine
    //AnchorPositions, so a layer outside an artboard must keep working with any
    //of them; only the batchPlay fallback is limited. Validating up front broke
    //that. The fallback runs only when the scale left the box unchanged, so
    //throwing from inside it does not abandon a half-applied transform.
    let before = layer.bounds;
    let originWidth = before.right - before.left;
    let originHeight = before.bottom - before.top;

    await execute(async () => {
        let anchor = getAnchorPosition(options.anchorPosition);
        let interpolation = getInterpolationMethod(options.interpolationMethod);

        await layer.scale(options.width, options.height, anchor, {
            interpolation: interpolation,
        });
    });

    if (options.width === 100 && options.height === 100) {
        return;
    }

    //Same trap as translateLayer: layer.scale() resolves without error but does
    //nothing for layers inside an artboard, because Photoshop re-nests the layer
    //and cancels the transform. batchPlay's transform is not re-nested.
    let after = layer.bounds;
    if (
        after.right - after.left === originWidth &&
        after.bottom - after.top === originHeight
    ) {
        await execute(async () => {
            selectLayer(layer, true);
            await action.batchPlay(
                [
                    {
                        _obj: "transform",
                        _target: [
                            {
                                _ref: "layer",
                                _enum: "ordinal",
                                _value: "targetEnum",
                            },
                        ],
                        freeTransformCenterState: {
                            _enum: "quadCenterState",
                            _value: _quadCenterState(options.anchorPosition),
                        },
                        width: {
                            _unit: "percentUnit",
                            _value: options.width,
                        },
                        height: {
                            _unit: "percentUnit",
                            _value: options.height,
                        },
                        _options: { dialogOptions: "dontDisplay" },
                    },
                ],
                {}
            );
        }, "Scale layer (artboard fallback)");

        after = layer.bounds;
        if (
            after.right - after.left === originWidth &&
            after.bottom - after.top === originHeight
        ) {
            throw new Error(
                `scaleLayer : Layer [${layerId}] did not scale, including via the batchPlay fallback.`
            );
        }
    }
};

const rotateLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `rotateLayer : Could not find layer with ID : [${layerId}]`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let anchor = getAnchorPosition(options.anchorPosition);
        let interpolation = getInterpolationMethod(options.interpolationMethod);

        await layer.rotate(options.angle, anchor, {
            interpolation: interpolation,
        });
    });
};

const flipLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `flipLayer : Could not find layer with ID : [${layerId}]`
        );
    }

    await execute(async () => {
        await layer.flip(options.axis);
    });
};

const deleteLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `setLayerVisibility : Could not find layer with ID : [${layerId}]`
        );
    }

    await execute(async () => {
        layer.delete();
    });
};

const renameLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let newLayerName = options.newLayerName;

    await _renameLayer(layerId, newLayerName)
};

const _renameLayer = async (layerId, layerName) => {

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `_renameLayer : Could not find layer with ID : [${layerId}]`
        );
    }

    //Renaming a layer that lives inside an artboard can flip its visibility as
    //a side effect (Photoshop re-nests the layer), so put it back if it moved.
    //The flip can land either inside the modal scope or as it closes, so check
    //in both places.
    const wasVisible = layer.visible;

    await execute(async () => {
        layer.name = layerName;

        if (layer.visible !== wasVisible) {
            layer.visible = wasVisible;
        }
    }, `Rename layer to ${layerName}`);

    if (layer.visible !== wasVisible) {
        await execute(async () => {
            layer.visible = wasVisible;
        }, "Restore layer visibility");
    }
}

const renameLayers = async (command) => {
    let options = command.options;

    let data = options.layerData;

    for(const d of data) {
        await _renameLayer(d.layer_id, d.new_layer_name)
    }
};

const groupLayers = async (command) => {
    let options = command.options;
    const layerIds = options.layerIds;

    let layers = [];

    for (const layerId of layerIds) {

        let layer = findLayer(layerId);

        if (!layer) {
            throw new Error(
                `groupLayers : Could not find layerId : ${layerId}`
            );
        }

        layers.push(layer);
    }

    await execute(async () => {
        await app.activeDocument.createLayerGroup({
            name: options.groupName,
            fromLayers: layers,
        });
    });
};

const setLayerVisibility = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `setLayerVisibility : Could not find layer with ID : [${layerId}]`
        );
    }

    await execute(async () => {
        layer.visible = options.visible;
    });
};

const translateLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `translateLayer : Could not find layer with ID : [${layerId}]`
        );
    }

    let xOffset = options.xOffset;
    let yOffset = options.yOffset;

    if (!xOffset && !yOffset) {
        return;
    }

    //One deterministic path, never translate()-then-maybe-fallback. Two traps
    //made that pattern corrupt other artboards:
    //  - layer.translate() is silently cancelled for layers inside an artboard,
    //    because Photoshop re-nests the layer and drops the offset;
    //  - layer.bounds is a cached snapshot, so a "did it move?" check cannot
    //    tell a cancelled move from a successful one. When translate() HAD
    //    worked, the stale read ran the fallback too and the layer moved twice.
    //batchPlay's move is not re-nested, so use only that. It honours the
    //targetEnum reference alone - passing _id makes it a silent no-op - so the
    //layer has to be the selection, and the ONLY one: batchPlay's select adds
    //to whatever is already selected, which silently drags the previous
    //target along. Clear first (layer.selected alone does not stick for some
    //layers inside artboards, area text especially), then select by id.
    let before = await _readBounds(layer.id);

    await execute(async () => {
        await _selectOnly(layer);
        await action.batchPlay([_offsetCommand(xOffset, yOffset)], {});
    }, "Translate layer");

    //Verify against a fresh read so a wrong-layer move cannot pass as success.
    //Groups report no usable box (see _readBounds), so they are unverifiable -
    //skip rather than fail a move that worked.
    let after = await _readBounds(layer.id);

    if (!before || !after) {
        return;
    }

    let movedX = after.left - before.left;
    let movedY = after.top - before.top;

    if (movedX === xOffset && movedY === yOffset) {
        return;
    }

    //Roll back before reporting. Throwing on a document that HAS changed is what
    //made callers compensate for a move they thought never happened, applying it
    //a second time - a layer asked for +45 ended up at +90.
    await execute(async () => {
        await _selectOnly(layer);
        await action.batchPlay([_offsetCommand(-movedX, -movedY)], {});
    }, "Translate layer (rollback)");

    throw new Error(
        `translateLayer : Layer [${layerId}] asked for (${xOffset}, ${yOffset}) but moved (${movedX}, ${movedY}). The move has been rolled back.`
    );
};

//"move" only honours the targetEnum reference - passing _id makes it a silent
//no-op - so the layer has to be the selection, and the ONLY one: batchPlay's
//select adds to whatever is already selected, which silently drags the previous
//target along. Clear first (layer.selected alone does not stick for some layers
//inside artboards, area text especially), then select by id.
const _selectOnly = async (layer) => {
    selectLayer(layer, true);

    await action.batchPlay(
        [
            {
                _obj: "select",
                _target: [{ _ref: "layer", _id: layer.id }],
                layerID: [layer.id],
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

const _offsetCommand = (xOffset, yOffset) => {
    return {
        _obj: "move",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: xOffset },
            vertical: { _unit: "pixelsUnit", _value: yOffset },
        },
        _options: { dialogOptions: "dontDisplay" },
    };
};

//layer.bounds on the UXP object is cached; ask Photoshop directly instead.
const _readBounds = async (layerId) => {
    let result = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [{ _ref: "layer", _id: layerId }],
            },
        ],
        {}
    );

    let b = result[0]?.bounds;

    //A layer SET has no ink box: Photoshop answers with the whole artboard
    //(measured 0,0,1472,1200) and never updates it, so a group that moved
    //correctly reads as "moved (0,0)". Return null and let the caller skip
    //verification rather than fail a move that worked.
    if (!b || result[0]?.layerSection?._value === "layerSectionStart") {
        return null;
    }

    return {
        left: b.left._value !== undefined ? b.left._value : b.left,
        top: b.top._value !== undefined ? b.top._value : b.top,
    };
};

const setLayerProperties = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `setLayerProperties : Could not find layer with ID : [${layerId}]`
        );
    }

    await execute(async () => {
        layer.blendMode = getBlendMode(options.blendMode);
        layer.opacity = options.layerOpacity;
        layer.fillOpacity = options.fillOpacity;

        if (layer.isClippingMask != options.isClippingMask) {
            selectLayer(layer, true);
            let command = options.isClippingMask
                ? {
                    _obj: "groupEvent",
                    _target: [
                        {
                            _enum: "ordinal",
                            _ref: "layer",
                            _value: "targetEnum",
                        },
                    ],
                }
                : {
                    _obj: "ungroup",
                    _target: [
                        {
                            _enum: "ordinal",
                            _ref: "layer",
                            _value: "targetEnum",
                        },
                    ],
                };

            await action.batchPlay([command], {});
        }
    });
};

const duplicateLayer = async (command) => {
    let options = command.options;

    await execute(async () => {
        let layer = findLayer(options.sourceLayerId);

        if (!layer) {
            throw new Error(
                `duplicateLayer : Could not find sourceLayerId : ${options.sourceLayerId}`
            );
        }

        let d = await layer.duplicate();
        d.name = options.duplicateLayerName;
    });
};

const flattenAllLayers = async (command) => {
    const options = command.options;
    const layerName = options.layerName

    await execute(async () => {
        await app.activeDocument.flatten();

        let layers = app.activeDocument.layers;

        if (layers.length != 1) {
            throw new Error(`flattenAllLayers : Unknown error`);
        }

        let l = layers[0];
        l.allLocked = false;
        l.name = layerName;
    });
};

const getLayerBounds = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `getLayerBounds : Could not find layerId : ${layerId}`
        );
    }

    let b = layer.bounds;
    return { left: b.left, top: b.top, bottom: b.bottom, right: b.right };
};

const rasterizeLayer = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `rasterizeLayer : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        layer.rasterize(constants.RasterizeType.ENTIRELAYER);
    });
};

//Photoshop's RGBColor descriptor names the green channel "grain".
const _rgbDescriptor = (color) => {
    return {
        _obj: "RGBColor",
        red: color.red,
        grain: color.green,
        blue: color.blue,
    };
};

//Resolves each requested range to [from, to) character indices. A range may be
//given either as {text:"Delivered."} (first occurrence) or as {from, to}.
const _resolveColorRanges = (colorRanges, contents) => {
    let resolved = [];

    for (const range of colorRanges) {
        if (!range || !range.color) {
            continue;
        }

        let from;
        let to;

        if (typeof range.text === "string" && range.text.length) {
            from = contents.indexOf(range.text);

            if (from < 0) {
                throw new Error(
                    `editTextLayer : colorRanges text not found in contents : "${range.text}"`
                );
            }

            to = from + range.text.length;
        } else {
            from = range.from;
            to = range.to;
        }

        if (!(from >= 0 && to > from && to <= contents.length)) {
            throw new Error(
                `editTextLayer : invalid colorRange [${from}, ${to}) for contents of length ${contents.length}`
            );
        }

        resolved.push({ from: from, to: to, color: range.color });
    }

    return resolved.sort((a, b) => a.from - b.from);
};

//Photoshop replaces the whole textStyleRange list, so every character has to be
//covered or the untouched runs fall back to defaults. The existing run's style
//descriptor is copied verbatim and only its colour swapped: reconstructing the
//descriptor from characterStyle would re-apply size in the wrong space on layers
//that carry a transform, blowing the point size up.
const _applyColorRanges = async (layer, contents, colorRanges) => {
    let resolved = _resolveColorRanges(colorRanges, contents);

    if (!resolved.length) {
        return;
    }

    let current = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [{ _ref: "layer", _id: layer.id }],
            },
        ],
        {}
    );

    let existing = current[0]?.textKey?.textStyleRange;

    if (!existing || !existing.length) {
        throw new Error(
            `editTextLayer : could not read textStyleRange for layer [${layer.id}]`
        );
    }

    let baseStyle = existing[0].textStyle;
    let baseColor = baseStyle.color;

    let segments = [];
    let cursor = 0;

    for (const range of resolved) {
        if (range.from < cursor) {
            throw new Error(
                `editTextLayer : overlapping colorRanges at index ${range.from}`
            );
        }

        if (range.from > cursor) {
            segments.push({ from: cursor, to: range.from });
        }

        segments.push(range);
        cursor = range.to;
    }

    if (cursor < contents.length) {
        segments.push({ from: cursor, to: contents.length });
    }

    let textStyleRange = segments.map((segment) => {
        return {
            _obj: "textStyleRange",
            from: segment.from,
            to: segment.to,
            textStyle: Object.assign({}, baseStyle, {
                color: segment.color
                    ? _rgbDescriptor(segment.color)
                    : baseColor,
            }),
        };
    });

    selectLayer(layer, true);

    await action.batchPlay(
        [
            {
                _obj: "set",
                _target: [
                    {
                        _ref: "textLayer",
                        _enum: "ordinal",
                        _value: "targetEnum",
                    },
                ],
                to: {
                    _obj: "textLayer",
                    textStyleRange: textStyleRange,
                },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

//Photoshop stores All Caps as a character attribute (fontCaps), not as the
//characters themselves, so retyping the string in lower case cannot clear it.
//Rewrites every run with the requested case, keeping the rest of its style.
const _applyTextCase = async (layer, textCase) => {
    let allowed = {
        //Photoshop's fontCaps enum spells the off state "normal"; "normalCaps"
        //is silently ignored and the run keeps whatever case it already had.
        normal: "normal",
        normalcaps: "normal",
        allcaps: "allCaps",
        smallcaps: "smallCaps",
    };

    let fontCaps = allowed[String(textCase).toLowerCase().replace(/[^a-z]/g, "")];

    if (!fontCaps) {
        throw new Error(
            `editTextLayer : unknown textCase "${textCase}". Use normal, allCaps or smallCaps.`
        );
    }

    let current = await action.batchPlay(
        [{ _obj: "get", _target: [{ _ref: "layer", _id: layer.id }] }],
        {}
    );

    let existing = current[0]?.textKey?.textStyleRange;

    if (!existing || !existing.length) {
        throw new Error(
            `editTextLayer : could not read textStyleRange for layer [${layer.id}]`
        );
    }

    let textStyleRange = existing.map((run) => {
        return {
            _obj: "textStyleRange",
            from: run.from,
            to: run.to,
            textStyle: Object.assign({}, run.textStyle, {
                fontCaps: { _enum: "fontCaps", _value: fontCaps },
            }),
        };
    });

    selectLayer(layer, true);

    await action.batchPlay(
        [
            {
                _obj: "set",
                _target: [
                    { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" },
                ],
                to: { _obj: "textLayer", textStyleRange: textStyleRange },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

const editTextLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`editTextLayer : Could not find layerId : ${layerId}`);
    }

    if (layer.kind.toUpperCase() != constants.LayerKind.TEXT.toUpperCase()) {
        throw new Error(`editTextLayer : Layer type must be TEXT : ${layer.kind}`);
    }

    await execute(async () => {
        const contents = options.contents;
        const fontSize = options.fontSize;
        const textColor = options.textColor;
        const fontName = options.fontName;


        console.log("contents", options.contents)
        console.log("fontSize", options.fontSize)
        console.log("textColor", options.textColor)
        console.log("fontName", options.fontName)

        if (contents != undefined) {
            layer.textItem.contents = normalizeLineBreaks(contents);
        }

        if (fontSize != undefined) {
            let s = convertFontSize(fontSize);
            layer.textItem.characterStyle.size = s;
        }

        if (textColor != undefined) {
            let c = parseColor(textColor);
            layer.textItem.characterStyle.color = c;
        }

        if (fontName != undefined) {
            layer.textItem.characterStyle.font = fontName;
        }

        //Before colorRanges, so that pass copies runs that already carry the
        //requested case.
        if (options.textCase != undefined) {
            await _applyTextCase(layer, options.textCase);
        }

        //Runs last so it reads the font, size and base colour already applied
        //above, and so its per-range colours are not overwritten by them.
        if (options.colorRanges != undefined) {
            await _applyColorRanges(
                layer,
                layer.textItem.contents,
                options.colorRanges
            );
        }
    });
}

const moveLayer = async (command) => {
    let options = command.options;

    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`moveLayer : Could not find layerId : ${layerId}`);
    }

    let position;
    switch (options.position) {
        case "TOP":
            position = "front";
            break;
        case "BOTTOM":
            position = "back";
            break;
        case "UP":
            position = "next";
            break;
        case "DOWN":
            position = "previous";
            break;
        default:
            throw new Error(
                `moveLayer: Unknown placement : ${options.position}`
            );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            {
                _obj: "move",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
                to: {
                    _enum: "ordinal",
                    _ref: "layer",
                    _value: position,
                },
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const createMultiLineTextLayer = async (command) => {
    let options = command.options;

    await execute(async () => {
        let c = parseColor(options.textColor);

        let fontSize = convertFontSize(options.fontSize);

        let contents = normalizeLineBreaks(options.contents);

        let a = await app.activeDocument.createTextLayer({
            //blendMode: constants.BlendMode.DISSOLVE,//ignored
            textColor: c,
            //color:constants.LabelColors.BLUE,//ignored
            //opacity:50, //ignored
            //name: "layer name",//ignored
            contents: contents,
            fontSize: fontSize,
            fontName: options.fontName, //"ArialMT",
            position: options.position, //y is the baseline of the text. Not top left
        });

        //https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/

        a.blendMode = getBlendMode(options.blendMode);
        a.name = options.layerName;
        a.opacity = options.opacity;

        await a.textItem.convertToParagraphText();
        a.textItem.paragraphStyle.justification = getJustificationMode(
            options.justification
        );

        selectLayer(a, true);
        let commands = [
            // Set current text layer
            {
                _obj: "set",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "textLayer",
                        _value: "targetEnum",
                    },
                ],
                to: {
                    _obj: "textLayer",

                    textShape: [
                        {
                            _obj: "textShape",
                            bounds: {
                                _obj: "rectangle",
                                bottom: options.bounds.bottom,
                                left: options.bounds.left,
                                right: options.bounds.right,
                                top: options.bounds.top,
                            },
                            char: {
                                _enum: "char",
                                _value: "box",
                            },
                            columnCount: 1,
                            columnGutter: {
                                _unit: "pointsUnit",
                                _value: 0.0,
                            },
                            firstBaselineMinimum: {
                                _unit: "pointsUnit",
                                _value: 0.0,
                            },
                            frameBaselineAlignment: {
                                _enum: "frameBaselineAlignment",
                                _value: "alignByAscent",
                            },
                            orientation: {
                                _enum: "orientation",
                                _value: "horizontal",
                            },
                            rowCount: 1,
                            rowGutter: {
                                _unit: "pointsUnit",
                                _value: 0.0,
                            },
                            rowMajorOrder: true,
                            spacing: {
                                _unit: "pointsUnit",
                                _value: 0.0,
                            },
                            transform: {
                                _obj: "transform",
                                tx: 0.0,
                                ty: 0.0,
                                xx: 1.0,
                                xy: 0.0,
                                yx: 0.0,
                                yy: 1.0,
                            },
                        },
                    ],
                },
            },
        ];

        a.textItem.contents = contents;
        await action.batchPlay(commands, {});
    });
};

const createSingleLineTextLayer = async (command) => {
    let options = command.options;

    await execute(async () => {
        let c = parseColor(options.textColor);

        let fontSize = convertFontSize(options.fontSize);

        let a = await app.activeDocument.createTextLayer({
            //blendMode: constants.BlendMode.DISSOLVE,//ignored
            textColor: c,
            //color:constants.LabelColors.BLUE,//ignored
            //opacity:50, //ignored
            //name: "layer name",//ignored
            contents: normalizeLineBreaks(options.contents),
            fontSize: fontSize,
            fontName: options.fontName, //"ArialMT",
            position: options.position, //y is the baseline of the text. Not top left
        });

        //https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/

        a.blendMode = getBlendMode(options.blendMode);
        a.name = options.layerName;
        a.opacity = options.opacity;
    });
};

const createPixelLayer = async (command) => {
    let options = command.options;

    await execute(async () => {
        //let c = parseColor(options.textColor)

        let b = getBlendMode(options.blendMode);

        let a = await app.activeDocument.createPixelLayer({
            name: options.layerName,
            opacity: options.opacity,
            fillNeutral: options.fillNeutral,
            blendMode: b,
        });
    });
};


const getLayers = async (command) => {
    let out = await execute(async () => {
        let result = [];

        // Function to recursively process layers
        const processLayers = (layersList) => {
            let layersArray = [];

            for (let i = 0; i < layersList.length; i++) {
                let layer = layersList[i];

                let kind = layer.kind.toUpperCase()

                let layerInfo = {
                    name: layer.name,
                    type: kind,
                    id: layer.id,
                    visible: layer.visible,
                    isClippingMask: layer.isClippingMask,
                    opacity: Math.round(layer.opacity),
                    blendMode: layer.blendMode.toUpperCase(),
                };

                if (kind == constants.LayerKind.TEXT.toUpperCase()) {

                    let _c = layer.textItem.characterStyle.color;
                    let color = {
                        red: Math.round(_c.rgb.red),
                        green: Math.round(_c.rgb.green),
                        blue: Math.round(_c.rgb.blue)
                    }

                    layerInfo.textInfo = {
                        fontSize: convertFromPhotoshopFontSize(layer.textItem.characterStyle.size),
                        fontName: layer.textItem.characterStyle.font,
                        fontColor: color,
                        text: layer.textItem.contents,
                        isMultiLineText: layer.textItem.isParagraphText
                    }
                }


                // Check if this layer has sublayers (is a group)
                if (layer.layers && layer.layers.length > 0) {
                    layerInfo.layers = processLayers(layer.layers);
                }

                layersArray.push(layerInfo);
            }

            return layersArray;
        };

        // Start with the top-level layers
        result = processLayers(app.activeDocument.layers);

        return result;
    });

    return out;
};

const removeLayerMask = async (command) => {
    const options = command.options;

    const layerId = options.layerId;
    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`removeLayerMask : Could not find layerId : ${layerId}`);
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Delete mask channel
            {
                _obj: "delete",
                _target: [
                    {
                        _enum: "channel",
                        _ref: "channel",
                        _value: "mask",
                    },
                ],
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const addLayerMask = async (command) => {
    if (!hasActiveSelection()) {
        throw new Error("addLayerMask : Requires an active selection.");
    }

    const options = command.options;

    const layerId = options.layerId;
    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`addLayerMask : Could not find layerId : ${layerId}`);
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Make
            {
                _obj: "make",
                at: {
                    _enum: "channel",
                    _ref: "channel",
                    _value: "mask",
                },
                new: {
                    _class: "channel",
                },
                using: {
                    _enum: "userMaskEnabled",
                    _value: "revealSelection",
                },
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const harmonizeLayer = async (command) => {
    const options = command.options;

    const layerId = options.layerId;
    const newLayerName = options.newLayerName;
    const rasterizeLayer = options.rasterizeLayer;

    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`harmonizeLayer : Could not find layerId : ${layerId}`);
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            {
                "_obj": "syntheticGenHarmonize",
                "_target": [
                    {
                        "_enum": "ordinal",
                        "_ref": "document",
                        "_value": "targetEnum"
                    }
                ],
                "documentID": 60,
                "layerID": 7,
                "prompt": "",
                "serviceID": "gen_harmonize",
                "serviceOptionsList": {
                    "clio": {
                        "_obj": "clio",
                        "dualCrop": true,
                        "gi_ADVANCED": "{\"enable_mts\":true}",
                        "gi_CONTENT_PRESERVE": 0,
                        "gi_CROP": false,
                        "gi_DILATE": false,
                        "gi_ENABLE_PROMPT_FILTER": true,
                        "gi_GUIDANCE": 6,
                        "gi_MODE": "ginp",
                        "gi_NUM_STEPS": -1,
                        "gi_PROMPT": "",
                        "gi_SEED": -1,
                        "gi_SIMILARITY": 0
                    },
                    "gen_harmonize": {
                        "_obj": "gen_harmonize",
                        "dualCrop": true,
                        "gi_SEED": -1
                    }
                },
                "workflow": "gen_harmonize",
                "workflowType": {
                    "_enum": "genWorkflow",
                    "_value": "gen_harmonize"
                },
                "workflow_to_active_service_identifier_map": {
                    "gen_harmonize": "gen_harmonize",
                    "generate_background": "clio3",
                    "generate_similar": "clio3",
                    "generativeUpscale": "fal_aura_sr",
                    "in_painting": "gen_harmonize",
                    "instruct_edit": "clio3",
                    "out_painting": "clio3",
                    "text_to_image": "clio3"
                }
            },

        ];


        console.log(rasterizeLayer)
        if(rasterizeLayer) {
            commands.push({
                _obj: "rasterizeLayer",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
            })
        }

        let o = await action.batchPlay(commands, {});
        let layerId = o[0].layerID;

        let l = findLayer(layerId);
        l.name = newLayerName;
    });
};

const getLayerImage = async (command) => {

    const options = command.options;
    const layerId = options.layerId;

    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`harmonizeLayer : Could not find layerId : ${layerId}`);
    }

    let out = await execute(async () => {

        const pixelsOpt = {
            applyAlpha: true,
            layerID:layerId
        };
        
        const imgObj = await imaging.getPixels(pixelsOpt);

        const base64Data = await imaging.encodeImageData({
            imageData: imgObj.imageData,
            base64: true,
        });

        const result = {
            base64Image: base64Data,
            dataUrl: `data:image/jpeg;base64,${base64Data}`,
            width: imgObj.imageData.width,
            height: imgObj.imageData.height,
            colorSpace: imgObj.imageData.colorSpace,
            components: imgObj.imageData.components,
            format: "jpeg",
        };

        imgObj.imageData.dispose();
        return result;
    });

    return out;
};

const commandHandlers = {
    renameLayers,
    getLayerImage,
    harmonizeLayer,
    editTextLayer,
    exportLayersAsPng,
    removeLayerMask,
    addLayerMask,
    getLayers,
    scaleLayer,
    rotateLayer,
    flipLayer,
    deleteLayer,
    renameLayer,
    groupLayers,
    setLayerVisibility,
    translateLayer,
    setLayerProperties,
    duplicateLayer,
    flattenAllLayers,
    getLayerBounds,
    rasterizeLayer,
    moveLayer,
    createMultiLineTextLayer,
    createSingleLineTextLayer,
    createPixelLayer,
};

module.exports = {
    commandHandlers,
};
