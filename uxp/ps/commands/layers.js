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
    normalizeLineBreaks,
    resolveLayerTargets,
    opt,
    fileEntryExists,
    deleteFileIfExists,
    waitForFile
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

//Shows a layer AND every group above it. This is the bug that made this tool
//write blank files: setVisibleAllLayers(false) hides the artboard groups too,
//and a leaf inside a hidden group renders nothing however visible the leaf
//itself is. The tool reported success and produced a canvas-sized PNG with
//alpha 0 everywhere.
const _showLayerAndAncestors = (layer) => {
    let node = layer;

    while (node) {
        node.visible = true;
        node = node.parent;
    }
};

//Trimmed, per-layer cutouts. `exportSelectionAsFileTypePressed` crops to the
//layer's own bounds and keeps transparency, so no visibility juggling and no
//document save is involved at all. It names the file after the LAYER, so a
//caller-supplied filename needs a rename afterwards.
const _exportLayerTrimmed = async (layer, filePath) => {
    let slash = filePath.lastIndexOf("/");
    let destFolder = filePath.substring(0, slash);
    let wanted = filePath.substring(slash + 1);

    let dot = wanted.lastIndexOf(".");
    let fileType = (dot === -1 ? "png" : wanted.substring(dot + 1)).toLowerCase();

    //Export As names the file after the LAYER, so several layers sharing a name
    //(one per artboard, which is the normal case) all target the same path.
    //Clearing it first makes "has it appeared?" an honest question.
    let produced = `${destFolder}/${layer.name}.${fileType}`;

    //`produced` is named after the LAYER, not after the caller's filename, so
    //when the two differ it can be somebody else's file: exporting layer "logo"
    //to logo-300x250.png would otherwise delete an existing logo.png sitting in
    //the same folder. Move it aside instead, and put it back in the finally
    //below -- waitForFile still gets an honest question either way.
    let stashName = null;

    if (produced !== filePath && (await fileEntryExists(produced))) {
        stashName = `${layer.name}.${fileType}.adb-mcp-stash`;
        await deleteFileIfExists(`${destFolder}/${stashName}`);

        let stale = await fs.getEntryWithUrl(`file:${produced}`);
        let intoFolder = await fs.getEntryWithUrl(`file:${destFolder}`);

        await stale.moveTo(intoFolder, { newName: stashName, overwrite: true });
    } else {
        await deleteFileIfExists(produced);
    }

    let out;

    try {
        out = await _exportSelectedLayerTo(
            layer,
            filePath,
            destFolder,
            wanted,
            fileType,
            produced
        );
    } finally {
        if (stashName) {
            //This must NEVER throw. A throw from a finally REPLACES the
            //exception the try was raising, so a failed restore would bury the
            //real "export never appeared" message -- and on the success path it
            //would turn an export that is sitting correctly on disk into
            //success:false. Report the stranded file instead; its path is
            //deterministic, so the caller can put it back by hand.
            try {
                let stash = await fs.getEntryWithUrl(
                    `file:${destFolder}/${stashName}`
                );
                let intoFolder = await fs.getEntryWithUrl(`file:${destFolder}`);

                await stash.moveTo(intoFolder, {
                    newName: `${layer.name}.${fileType}`,
                    overwrite: true,
                });
            } catch (e) {
                let stashPath = `${destFolder}/${stashName}`;

                console.log(
                    `exportLayersAsPng : could not restore ${stashPath} to ${produced} : ${e.message}`
                );

                if (out) {
                    out.stashLeftAt = stashPath;
                    out.warning = `${produced} was moved aside and could not be put back; it is at ${stashPath}`;
                }
            }
        }
    }

    return out;
};

//The export itself, split out so _exportLayerTrimmed's finally can always
//restore a file it moved aside, whether this threw or returned.
const _exportSelectedLayerTo = async (
    layer,
    filePath,
    destFolder,
    wanted,
    fileType,
    produced
) => {
    //Two calls, two modal scopes: this verb reads a selection Photoshop has
    //already committed, so selecting in the same call exports the previous
    //target or nothing.
    await execute(async () => {
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
    }, "Select layer for export");

    await execute(async () => {
        await action.batchPlay(
            [
                {
                    _obj: "exportSelectionAsFileTypePressed",
                    _target: [
                        {
                            _ref: "layer",
                            _enum: "ordinal",
                            _value: "targetEnum",
                        },
                    ],
                    fileType: fileType,
                    quality: 32,
                    metadata: 0,
                    destFolder: destFolder,
                    sRGB: true,
                    openWindow: false,
                },
            ],
            {}
        );
    }, "Export layer");

    //Export As is ASYNCHRONOUS: it returns before the file is written. Without
    //this wait the rename found nothing, and the next layer's select cancelled
    //the pending export outright -- three layers exported, one file on disk.
    let landed = await waitForFile(produced);

    if (!landed) {
        throw new Error(
            `exportLayersAsPng : Photoshop reported success but ${produced} never appeared`
        );
    }

    if (produced === filePath) {
        return { savedFilePath: filePath, trimmed: true };
    }

    await deleteFileIfExists(filePath);

    let entry = await fs.getEntryWithUrl(`file:${produced}`);
    let folder = await fs.getEntryWithUrl(`file:${destFolder}`);

    await entry.moveTo(folder, { newName: wanted, overwrite: true });

    if (!(await waitForFile(filePath, 3000))) {
        throw new Error(
            `exportLayersAsPng : exported ${produced} but the rename to ${filePath} did not land`
        );
    }

    return { savedFilePath: filePath, trimmed: true, renamedFrom: produced };
};

const exportLayersAsPng = async (command) => {
    let options = command.options;
    let layersInfo = options.layersInfo;

    //TRIM is the default because a cutout is what "export this layer" means.
    //CANVAS keeps the old behaviour: a full-canvas PNG with only this layer
    //showing, which is what a compositing rebuild wants since every plate then
    //shares one coordinate space.
    let mode = String(opt(options.mode, "TRIM")).toUpperCase();

    if (mode !== "TRIM" && mode !== "CANVAS") {
        throw new Error(
            `exportLayersAsPng : mode must be TRIM or CANVAS, got : ${options.mode}`
        );
    }

    const results = [];

    if (mode === "TRIM") {
        for (const info of layersInfo) {
            let layer = findLayer(info.layerId);

            try {
                if (!layer) {
                    throw new Error(
                        `exportLayersAsPng : Could not find layer with ID : [${info.layerId}]`
                    );
                }

                let out = await _exportLayerTrimmed(layer, info.filePath);

                results.push({
                    ...out,
                    layerId: info.layerId,
                    name: layer.name,
                    success: true,
                });
            } catch (e) {
                results.push({
                    ...info,
                    success: false,
                    message: e.message,
                });
            }
        }

        return results;
    }

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
                    `exportLayersAsPng : Could not find layer with ID : [${info.layerId}]`
                );
            }
            await execute(async () => {
                _showLayerAndAncestors(layer);
            });

            let tmp = await _saveDocumentAs(info.filePath, "PNG");

            result = {
                ...tmp,
                layerId: info.layerId,
                name: layer.name,
                trimmed: false,
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
                //hide the ancestors again as well, or the next layer's export
                //carries this one's artboard with it
                await execute(async () => {
                    let node = layer;
                    while (node) {
                        node.visible = false;
                        node = node.parent;
                    }
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

const _scaleLayerOne = async (layer, options) => {
    let layerId = layer.id;

    //The anchor is NOT validated here on purpose. layer.scale() honours all nine
    //AnchorPositions, so a layer outside an artboard must keep working with any
    //of them; only the batchPlay fallback is limited. Validating up front broke
    //that. The fallback runs only when the scale left the box unchanged, so
    //throwing from inside it does not abandon a half-applied transform.
    //layer.bounds is a CACHED snapshot. Comparing it before and after made
    //this function believe a scale that HAD worked did nothing, so it ran the
    //batchPlay fallback as well and the layer was scaled TWICE -- 50% came out
    //at 25%. Measured on three text layers inside artboards. Read the live
    //bounds through batchPlay instead, exactly as translateLayer does.
    let before = await _readBounds(layer.id);

    await execute(async () => {
        //layer.scale() does NOT reliably act on the layer it is called on -- for
        //layers inside an artboard it acts on Photoshop's CURRENT SELECTION.
        //Measured: scaling layer 9 shrank layer 11 (the most recently created
        //layer, still selected) by the requested 50% and left 9 untouched, after
        //which the fallback scaled 9 as well. By name over three layers that
        //compounded to 27% / 25% / 27% instead of 50%. Selecting the target
        //first makes both paths hit the same layer.
        await _selectOnly(layer);

        let anchor = getAnchorPosition(options.anchorPosition);
        let interpolation = getInterpolationMethod(options.interpolationMethod);

        await layer.scale(options.width, options.height, anchor, {
            interpolation: interpolation,
        });
    });

    if (options.width === 100 && options.height === 100) {
        return { verified: true, reason: "no-op at 100%" };
    }

    //A layer SET has no measurable ink box, so there is no way to tell a scale
    //that worked from one that did not. Running the fallback on a guess is the
    //worse failure -- that is what double-scales -- so report it instead.
    let after = before ? await _readBounds(layer.id) : null;

    if (!before || !after) {
        return {
            verified: false,
            reason: "bounds not readable (layer set); scale not verified and the batchPlay fallback was skipped",
        };
    }

    //Same trap as translateLayer: layer.scale() resolves without error but does
    //nothing for layers inside an artboard, because Photoshop re-nests the layer
    //and cancels the transform. batchPlay's transform is not re-nested.
    if (after.width === before.width && after.height === before.height) {
        await execute(async () => {
            //_selectOnly, NOT selectLayer: batchPlay's select ADDS to the
            //current selection, and layer.selected alone does not stick for
            //layers inside artboards. Measured with selectLayer here, scaling
            //ONE layer shrank a second, unrelated layer in another artboard by
            //the same 50%, and a by-name run over three layers left them at
            //27%, 25% and 27% instead of 50%.
            await _selectOnly(layer);
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

        after = await _readBounds(layer.id);

        if (
            after &&
            after.width === before.width &&
            after.height === before.height
        ) {
            throw new Error(
                `scaleLayer : Layer [${layerId}] did not scale, including via the batchPlay fallback.`
            );
        }

        return _verifyScale(layerId, before, after, options, true);
    }

    return _verifyScale(layerId, before, after, options, false);
};

//"It changed" is not "it changed by the right amount". A selection that leaked
//to other layers scaled this one twice, which still passes a did-anything-change
//test. Check the ratio, and if it is wrong say so with the measured numbers --
//do NOT roll back: the inverse of a percentage scale is not exact, so undoing it
//would leave the layer a pixel or two off its original size.
const _verifyScale = (layerId, before, after, options, usedFallback) => {
    let out = {
        verified: true,
        usedFallback: usedFallback,
        width: after.width,
        height: after.height,
    };

    if (!before.width || !before.height) {
        return out;
    }

    //A 75x8 text box scaled to 38x6 measures as 51% x 75%: at that size a single
    //pixel of type rendering is 12% of the height. Too small to hold to a
    //percentage, so say it is unverified rather than raise on rounding.
    if (before.width < 24 || before.height < 24) {
        out.verified = false;
        out.reason = `box too small to verify (${before.width}x${before.height})`;
        return out;
    }

    let gotW = (after.width / before.width) * 100;
    let gotH = (after.height / before.height) * 100;

    //generous: a few pixels of type rendering, plus rounding on small boxes
    let tolerance = Math.max(6, options.width * 0.12);

    if (
        Math.abs(gotW - options.width) > tolerance ||
        Math.abs(gotH - options.height) > tolerance
    ) {
        throw new Error(
            `scaleLayer : Layer [${layerId}] asked for ${options.width}x${options.height}% but measured ${Math.round(
                gotW
            )}x${Math.round(
                gotH
            )}% (${before.width}x${before.height} -> ${after.width}x${after.height}). The document HAS changed - re-read the bounds, do not simply retry.`
        );
    }

    return out;
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
            `deleteLayer : Could not find layer with ID : [${layerId}]`
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

const _setLayerVisibilityOne = async (layer, options) => {
    let layerId = layer.id;

    await execute(async () => {
        layer.visible = options.visible;
    });
};

const _translateLayerOne = async (layer, options) => {
    let layerId = layer.id;

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

    let v = (x) => (x && x._value !== undefined ? x._value : x);

    let left = v(b.left);
    let top = v(b.top);
    let right = v(b.right);
    let bottom = v(b.bottom);

    return {
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        width: right - left,
        height: bottom - top,
    };
};

const _setLayerPropertiesOne = async (layer, options) => {
    let layerId = layer.id;

    //Only write what the caller actually chose. Writing all four every time
    //meant a call that set just the blend mode also reset opacity and fill to
    //100 and un-clipped the layer -- and with layerName targeting, across every
    //artboard at once. An omitted argument arrives as null, not undefined.
    let given = (v) => v !== undefined && v !== null;

    await execute(async () => {
        if (given(options.blendMode)) {
            layer.blendMode = getBlendMode(options.blendMode);
        }

        if (given(options.layerOpacity)) {
            layer.opacity = options.layerOpacity;
        }

        if (given(options.fillOpacity)) {
            layer.fillOpacity = options.fillOpacity;
        }

        if (
            given(options.isClippingMask) &&
            layer.isClippingMask != options.isClippingMask
        ) {
            //_selectOnly, NOT selectLayer: `groupEvent`/`ungroup` below act on
            //targetEnum, and `layer.selected = true` alone does not stick for
            //layers inside artboards -- the same trap that made scaleLayer clip
            //the wrong layer in another artboard. Now that layerName targets
            //every artboard at once, a selection that did not land means
            //clipping is applied to whatever else was selected.
            await _selectOnly(layer);

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

/* ------------------------------------------------------------------------
 * Bulk targeting
 *
 * A banner PSD repeats one set of layer names once per artboard, so almost
 * every real task is "do this to layer X in all 21 artboards". These wrappers
 * let a single call name its targets by layerId, layerIds or layerName and run
 * the existing single-layer logic over each match. Failures are collected per
 * layer instead of aborting the run: one bad layer must not leave the other
 * twenty half-applied with no report of what actually landed.
 * ---------------------------------------------------------------------- */

const _runOverTargets = async (name, worker, options) => {
    let targets = resolveLayerTargets(options);

    let applied = [];
    let failed = [];

    for (const layer of targets) {
        try {
            let detail = await worker(layer, options);

            applied.push(
                Object.assign({ layerId: layer.id, name: layer.name }, detail || {})
            );
        } catch (e) {
            failed.push({
                layerId: layer.id,
                name: layer.name,
                message: e.message,
            });
        }
    }

    if (!applied.length && failed.length) {
        throw new Error(
            `${name} : every target failed : ${failed
                .map((f) => `[${f.layerId}] ${f.message}`)
                .join(" | ")}`
        );
    }

    return { applied: applied, count: applied.length, failed: failed };
};

const setLayerVisibility = async (command) =>
    _runOverTargets("setLayerVisibility", _setLayerVisibilityOne, command.options);

const setLayerProperties = async (command) =>
    _runOverTargets("setLayerProperties", _setLayerPropertiesOne, command.options);

const translateLayer = async (command) =>
    _runOverTargets("translateLayer", _translateLayerOne, command.options);

const scaleLayer = async (command) =>
    _runOverTargets("scaleLayer", _scaleLayerOne, command.options);


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
