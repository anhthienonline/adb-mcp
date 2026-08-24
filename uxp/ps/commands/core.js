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
    _saveDocumentAs,
    parseColor,
    getAlignmentMode,
    getNewDocumentMode,
    selectLayer,
    findLayer,
    findLayerByName,
    execute,
    tokenify,
    hasActiveSelection,
    listOpenDocuments
} = require("./utils");

const openFile = async (command) => {
    let options = command.options;

    await execute(async () => {
        let entry = null;
        try {
            entry = await fs.getEntryWithUrl("file:" + options.filePath);
        } catch (e) {
            throw new Error(
                "openFile: Could not create file entry. File probably does not exist."
            );
        }

        await app.open(entry);
    });
};

//Scales the placed layer to cover the slot it replaced, centres it there and
//masks it to the slot. Without this the image lands centred on the canvas at its
//own size, which inside an artboard means it covers the artwork around it.
const _fitLayerToBounds = async (layer, target) => {
    let targetWidth = target.right - target.left;
    let targetHeight = target.bottom - target.top;
    let current = layer.bounds;
    let currentWidth = current.right - current.left;
    let currentHeight = current.bottom - current.top;

    if (!currentWidth || !currentHeight || !targetWidth || !targetHeight) {
        return;
    }

    //Cover, not contain: the slot must be filled edge to edge.
    let scale =
        Math.max(targetWidth / currentWidth, targetHeight / currentHeight) * 100;

    await layer.scale(scale, scale, constants.AnchorPosition.MIDDLECENTER);

    current = layer.bounds;
    let dx = Math.round(
        (target.left + targetWidth / 2) - (current.left + (current.right - current.left) / 2)
    );
    let dy = Math.round(
        (target.top + targetHeight / 2) - (current.top + (current.bottom - current.top) / 2)
    );

    if (dx || dy) {
        selectLayer(layer, true);
        await action.batchPlay(
            [
                {
                    _obj: "move",
                    _target: [
                        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                    ],
                    to: {
                        _obj: "offset",
                        horizontal: { _unit: "pixelsUnit", _value: dx },
                        vertical: { _unit: "pixelsUnit", _value: dy },
                    },
                    _options: { dialogOptions: "dontDisplay" },
                },
            ],
            {}
        );
    }

    //Clip the overflow away so the image reads as the slot, not a loose photo.
    selectLayer(layer, true);
    await action.batchPlay(
        [
            {
                _obj: "set",
                _target: [{ _ref: "channel", _property: "selection" }],
                to: {
                    _obj: "rectangle",
                    top: { _unit: "pixelsUnit", _value: target.top },
                    left: { _unit: "pixelsUnit", _value: target.left },
                    bottom: { _unit: "pixelsUnit", _value: target.bottom },
                    right: { _unit: "pixelsUnit", _value: target.right },
                },
                _options: { dialogOptions: "dontDisplay" },
            },
            {
                _obj: "make",
                new: { _class: "channel" },
                at: { _ref: "channel", _enum: "channel", _value: "mask" },
                using: { _enum: "userMaskEnabled", _value: "revealSelection" },
                _options: { dialogOptions: "dontDisplay" },
            },
            {
                _obj: "set",
                _target: [{ _ref: "channel", _property: "selection" }],
                to: { _enum: "ordinal", _value: "none" },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

const placeImage = async (command) => {
    let options = command.options;
    let layerId = options.layerId;
    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(`placeImage : Could not find layerId : ${layerId}`);
    }

    //placeEvent replaces the target layer, so its slot geometry and name have to
    //be read before the call or they are gone.
    let slot = {
        left: layer.bounds.left,
        top: layer.bounds.top,
        right: layer.bounds.right,
        bottom: layer.bounds.bottom,
    };
    let slotName = layer.name;

    await execute(async () => {
        selectLayer(layer, true);
        let layerId = layer.id;

        let imagePath = await tokenify(options.imagePath);

        let commands = [
            // Place
            {
                ID: layerId,
                _obj: "placeEvent",
                freeTransformCenterState: {
                    _enum: "quadCenterState",
                    _value: "QCSAverage",
                },
                null: {
                    _kind: "local",
                    _path: imagePath,
                },
                offset: {
                    _obj: "offset",
                    horizontal: {
                        _unit: "pixelsUnit",
                        _value: 0.0,
                    },
                    vertical: {
                        _unit: "pixelsUnit",
                        _value: 0.0,
                    },
                },
                replaceLayer: {
                    _obj: "placeEvent",
                    to: {
                        _id: layerId,
                        _ref: "layer",
                    },
                },
            },
            {
                _obj: "set",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
                to: {
                    _obj: "layer",
                    name: slotName,
                },
            },
        ];

        await action.batchPlay(commands, {});

        //placeEvent leaves the new smart object selected. It carries a fresh id,
        //so rasterizing via the caller's now-dead layerId always threw; the layer
        //is left as a smart object instead, which keeps the placement editable.
        let placed = app.activeDocument.activeLayers[0];

        if (placed) {
            await _fitLayerToBounds(placed, slot);
        }
    });
};

const getDocumentImage = async (command) => {
    let out = await execute(async () => {

        const pixelsOpt = {
            applyAlpha: true
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

const getDocumentInfo = async (command) => {
    let doc = app.activeDocument;
    let path = doc.path;

    let out = {
        height: doc.height,
        width: doc.width,
        colorMode: doc.mode.toString(),
        pixelAspectRatio: doc.pixelAspectRatio,
        resolution: doc.resolution,
        path: path,
        saved: path.length > 0,
        hasUnsavedChanges: !doc.saved,
    };

    return out;
};

const cropDocument = async (command) => {
    let options = command.options;

    if (!hasActiveSelection()) {
        throw new Error("cropDocument : Requires an active selection");
    }

    return await execute(async () => {
        let commands = [
            // Crop
            {
                _obj: "crop",
                delete: true,
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const removeBackground = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `removeBackground : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Remove Background
            {
                _obj: "removeBackground",
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const alignContent = async (command) => {
    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `alignContent : Could not find layerId : ${layerId}`
        );
    }

    if (!app.activeDocument.selection.bounds) {
        throw new Error(`alignContent : Requires an active selection`);
    }

    await execute(async () => {
        let m = getAlignmentMode(options.alignmentMode);

        selectLayer(layer, true);

        let commands = [
            {
                _obj: "align",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
                alignToCanvas: false,
                using: {
                    _enum: "alignDistributeSelector",
                    _value: m,
                },
            },
        ];
        await action.batchPlay(commands, {});
    });
};

const generateImage = async (command) => {
    let options = command.options;

    await execute(async () => {
        let doc = app.activeDocument;

        await doc.selection.selectAll();

        let contentType = "none";
        const c = options.contentType.toLowerCase()
        if (c === "photo" || c === "art") {
            contentType = c;
        }

        let commands = [
            // Generate Image current document
            {
                _obj: "syntheticTextToImage",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "document",
                        _value: "targetEnum",
                    },
                ],
                documentID: doc.id,
                layerID: 0,
                prompt: options.prompt,
                serviceID: "clio",
                serviceOptionsList: {
                    clio: {
                        _obj: "clio",
                        clio_advanced_options: {
                            text_to_image_styles_options: {
                                text_to_image_content_type: contentType,
                                text_to_image_effects_count: 0,
                                text_to_image_effects_list: [
                                    "none",
                                    "none",
                                    "none",
                                ],
                            },
                        },
                        dualCrop: true,
                        gentech_workflow_name: "text_to_image",
                        gi_ADVANCED: '{"enable_mts":true}',
                        gi_CONTENT_PRESERVE: 0,
                        gi_CROP: false,
                        gi_DILATE: false,
                        gi_ENABLE_PROMPT_FILTER: true,
                        gi_GUIDANCE: 6,
                        gi_MODE: "ginp",
                        gi_NUM_STEPS: -1,
                        gi_PROMPT: options.prompt,
                        gi_SEED: -1,
                        gi_SIMILARITY: 0,
                    },
                },
                workflow: "text_to_image",
                workflowType: {
                    _enum: "genWorkflow",
                    _value: "text_to_image",
                },
            },
            // Rasterize current layer
            {
                _obj: "rasterizeLayer",
                _target: [
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
            },
        ];
        let o = await action.batchPlay(commands, {});
        let layerId = o[0].layerID;

        //let l = findLayerByName(options.prompt);
        let l = findLayer(layerId);
        l.name = options.layerName;
    });
};

const generativeFill = async (command) => {
    const options = command.options;
    const layerId = options.layerId;
    const prompt = options.prompt;

    const layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `generativeFill : Could not find layerId : ${layerId}`
        );
    }

    if(!hasActiveSelection()) {
        throw new Error(
            `generativeFill : Requires an active selection.`
        ); 
    }

    await execute(async () => {
        let doc = app.activeDocument;

        let contentType = "none";
        const c = options.contentType.toLowerCase()
        if (c === "photo" || c === "art") {
            contentType = c;
        }

        let commands = [
            // Generative Fill current document
            {
                "_obj": "syntheticFill",
                "_target": [
                    {
                        "_enum": "ordinal",
                        "_ref": "document",
                        "_value": "targetEnum"
                    }
                ],
                "documentID": doc.id,
                "layerID": layerId,
                "prompt": prompt,
                "serviceID": "clio",
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
                        "gi_MODE": "tinp",
                        "gi_NUM_STEPS": -1,
                        "gi_PROMPT": prompt,
                        "gi_SEED": -1,
                        "gi_SIMILARITY": 0,


                        clio_advanced_options: {
                            text_to_image_styles_options: {
                                text_to_image_content_type: contentType,
                                text_to_image_effects_count: 0,
                                text_to_image_effects_list: [
                                    "none",
                                    "none",
                                    "none",
                                ],
                            },
                        },

                    }
                },
                "serviceVersion": "clio3",
                "workflowType": {
                    "_enum": "genWorkflow",
                    "_value": "in_painting"
                },
                "workflow_to_active_service_identifier_map": {
                    "gen_harmonize": "clio3",
                    "generate_background": "clio3",
                    "generate_similar": "clio3",
                    "generativeUpscale": "fal_aura_sr",
                    "in_painting": "clio3",
                    "instruct_edit": "clio3",
                    "out_painting": "clio3",
                    "text_to_image": "clio3"
                }
            }
        ];


        let o = await action.batchPlay(commands, {});
        let id = o[0].layerID;

        //let l = findLayerByName(options.prompt);
        let l = findLayer(id);
        l.name = options.layerName;
    });
};

const saveDocument = async (command) => {
    await execute(async () => {
        await app.activeDocument.save();
    });
};

const saveDocumentAs = async (command) => {
    let options = command.options;

    return await _saveDocumentAs(options.filePath, options.fileType);
};

const setActiveDocument = async (command) => {

    let options = command.options;
    let documentId = options.documentId;

    //iterate app.documents directly: listOpenDocuments() returns plain info
    //objects, and assigning one of those to app.activeDocument does nothing.
    for (let doc of app.documents) {
        if (doc.id === documentId) {
            await execute(async () => {
                app.activeDocument = doc;
            }, "Set active document");

            return
        }
    }

    throw new Error(
        `setActiveDocument : Could not find document with ID : ${documentId}`
    );
}

const getDocuments = async (command) => {
    return listOpenDocuments()
}

const duplicateDocument = async (command) => {
    let options = command.options;
    let name = options.name

    await execute(async () => {
        const doc = app.activeDocument;
        await doc.duplicate(name)
    });
};

const createDocument = async (command) => {
    let options = command.options;
    let colorMode = getNewDocumentMode(command.options.colorMode);
    let fillColor = parseColor(options.fillColor);

    await execute(async () => {
        await app.createDocument({
            typename: "DocumentCreateOptions",
            width: options.width,
            height: options.height,
            resolution: options.resolution,
            mode: colorMode,
            fill: constants.DocumentFill.COLOR,
            fillColor: fillColor,
            profile: "sRGB IEC61966-2.1",
        });

        let background = findLayerByName("Background");
        background.allLocked = false;
        background.name = "Background";
    });
};

// Verbs whose _path must ALREADY exist because they read it. Creating a missing
// file for one of these turns a typo into an empty file on disk plus a confusing
// downstream error, instead of saying which path was wrong. Anything not listed
// here keeps the create-if-missing behaviour, which is what an export or a save
// needs -- so an unknown verb behaves exactly as before and a missing name here
// can only ever cost the old behaviour, never a wrong one.
const READ_PATH_VERBS = [
    "open",
    "placeEvent",
    "placedLayerReplace",
    "placedLayerCreateFromFile",
    "importPresets",
];

// batchPlay only accepts UXP session tokens where a descriptor wants a file,
// never a raw filesystem path, so verbs like open / export / save-in fail with
// "invalid file token used". Swap every absolute _path for a token first.
// Output files (a .gif about to be written) do not exist yet, hence the create
// fallback -- getEntryWithUrl throws on a missing file. No `overwrite` on that
// create: we are in the branch where the file did NOT resolve, so overwrite can
// only matter when getEntryWithUrl failed for some other reason (permissions, a
// detached volume) -- and truncating a file that does exist is the worst
// possible response to that.
const tokenizePath = async (path, mustExist) => {
    let url = "file:" + path;
    let entry;

    try {
        entry = await fs.getEntryWithUrl(url);
    } catch (e) {
        if (mustExist) {
            throw new Error(
                `executeBatchPlayCommand : ${path} does not exist, and this descriptor reads it rather than writing it`
            );
        }

        entry = await fs.createEntryWithUrl(url);
    }

    return await fs.createSessionToken(entry);
};

const tokenizeDescriptorPaths = async (node, mustExist = false) => {
    if (Array.isArray(node)) {
        for (let item of node) {
            await tokenizeDescriptorPaths(item, mustExist);
        }
        return;
    }

    if (node === null || typeof node !== "object") {
        return;
    }

    // _obj names the verb, and a nested descriptor inherits the intent of the
    // one it sits inside until a nested _obj says otherwise.
    if (typeof node._obj === "string") {
        mustExist = READ_PATH_VERBS.indexOf(node._obj) !== -1;
    }

    for (let key of Object.keys(node)) {
        let value = node[key];

        // a token is already an opaque string; only absolute paths need work
        if (key === "_path" && typeof value === "string" && value.startsWith("/")) {
            node[key] = await tokenizePath(value, mustExist);
        } else {
            await tokenizeDescriptorPaths(value, mustExist);
        }
    }
};

const executeBatchPlayCommand = async (commands) => {
    let options = commands.options;
    let c = options.commands;

    await tokenizeDescriptorPaths(c);

    let out = await execute(async () => {
        let o = await action.batchPlay(c, {});

        //Default stays o[0] for backwards compatibility. Reads need the whole
        //array: a single call asking about N layers otherwise reports only the
        //first, which reads as "the other N-1 have nothing".
        return options.returnAll === true ? o : o[0]
    });

    console.log(out)
    return out;
}

const commandHandlers = {
    generativeFill,
    executeBatchPlayCommand,
    setActiveDocument,
    getDocuments,
    duplicateDocument,
    getDocumentImage,
    openFile,
    placeImage,
    getDocumentInfo,
    cropDocument,
    removeBackground,
    alignContent,
    generateImage,
    saveDocument,
    saveDocumentAs,
    createDocument,
};

module.exports = {
    commandHandlers,
};
