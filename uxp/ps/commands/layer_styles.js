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

const { app, action } = require("photoshop");

const {
    opt,
    selectLayer,
    findLayer,
    collectLayers,
    findLayersByName,
    resolveLayerTargets,
    getBlendMode,
    execute
} = require("./utils")

//A blend mode in a descriptor must be Photoshop's own enum member, which is
//camelCase: SOFTLIGHT is `softLight`, LINEARBURN is `linearBurn`. Lowercasing
//the caller's string only happens to work for the 15 single-word modes; the
//other 13 come out as `softlight`, which these descriptors IGNORE in silence --
//the effect is written with the default Normal and still reports success.
//getBlendMode maps from the same key list the MCP tools document, and throws on
//an unknown one, which is the loud failure this file wants everywhere else.
const _blendModeEnum = (value) => {
    return {
        _enum: "blendMode",
        _value: getBlendMode(value),
    };
};

const addDropShadowLayerStyle = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `addDropShadowLayerStyle : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let commands = [
            // Set Layer Styles of current layer
            {
                _obj: "set",
                _target: [
                    {
                        _property: "layerEffects",
                        _ref: "property",
                    },
                    {
                        _enum: "ordinal",
                        _ref: "layer",
                        _value: "targetEnum",
                    },
                ],
                to: {
                    _obj: "layerEffects",
                    dropShadow: {
                        _obj: "dropShadow",
                        antiAlias: false,
                        blur: {
                            _unit: "pixelsUnit",
                            _value: options.size,
                        },
                        chokeMatte: {
                            _unit: "pixelsUnit",
                            _value: options.spread,
                        },
                        color: {
                            _obj: "RGBColor",
                            blue: options.color.blue,
                            grain: options.color.green,
                            red: options.color.red,
                        },
                        distance: {
                            _unit: "pixelsUnit",
                            _value: options.distance,
                        },
                        enabled: true,
                        layerConceals: true,
                        localLightingAngle: {
                            _unit: "angleUnit",
                            _value: options.angle,
                        },
                        mode: _blendModeEnum(options.blendMode),
                        noise: {
                            _unit: "percentUnit",
                            _value: 0.0,
                        },
                        opacity: {
                            _unit: "percentUnit",
                            _value: options.opacity,
                        },
                        present: true,
                        showInDialog: true,
                        transferSpec: {
                            _obj: "shapeCurveType",
                            name: "Linear",
                        },
                        useGlobalAngle: true,
                    },
                    globalLightingAngle: {
                        _unit: "angleUnit",
                        _value: options.angle,
                    },
                    scale: {
                        _unit: "percentUnit",
                        _value: 100.0,
                    },
                },
            },
        ];

        await action.batchPlay(commands, {});
    });
};

const addStrokeLayerStyle = async (command) => {
    const options = command.options

    const layerId = options.layerId

    let layer = findLayer(layerId)

    if (!layer) {
        throw new Error(
            `addStrokeLayerStyle : Could not find layerId : ${layerId}`
        );
    }

    let position = "centeredFrame"

    if (options.position == "INSIDE") {
        position = "insetFrame"
    } else if (options.position == "OUTSIDE") {
        position = "outsetFrame"
    }


    await execute(async () => {
        selectLayer(layer, true);

        let strokeColor = options.color
        let commands = [
            // Set Layer Styles of current layer
            {
                "_obj": "set",
                "_target": [
                    {
                        "_property": "layerEffects",
                        "_ref": "property"
                    },
                    {
                        "_enum": "ordinal",
                        "_ref": "layer",
                        "_value": "targetEnum"
                    }
                ],
                "to": {
                    "_obj": "layerEffects",
                    "frameFX": {
                        "_obj": "frameFX",
                        "color": {
                            "_obj": "RGBColor",
                            "blue": strokeColor.blue,
                            "grain": strokeColor.green,
                            "red": strokeColor.red
                        },
                        "enabled": true,
                        "mode": _blendModeEnum(options.blendMode),
                        "opacity": {
                            "_unit": "percentUnit",
                            "_value": options.opacity
                        },
                        "overprint": false,
                        "paintType": {
                            "_enum": "frameFill",
                            "_value": "solidColor"
                        },
                        "present": true,
                        "showInDialog": true,
                        "size": {
                            "_unit": "pixelsUnit",
                            "_value": options.size
                        },
                        "style": {
                            "_enum": "frameStyle",
                            "_value": position
                        }
                    },
                    "scale": {
                        "_unit": "percentUnit",
                        "_value": 100.0
                    }
                }
            }
        ];

        await action.batchPlay(commands, {});
    });
}

const createGradientLayerStyle = async (command) => {

    let options = command.options;
    let layerId = options.layerId;

    let layer = findLayer(layerId);

    if (!layer) {
        throw new Error(
            `createGradientAdjustmentLayer : Could not find layerId : ${layerId}`
        );
    }

    await execute(async () => {
        selectLayer(layer, true);

        let angle = options.angle;
        let colorStops = options.colorStops;
        let opacityStops = options.opacityStops;

        let colors = [];
        for (let c of colorStops) {
            colors.push({
                _obj: "colorStop",
                color: {
                    _obj: "RGBColor",
                    blue: c.color.blue,
                    grain: c.color.green,
                    red: c.color.red,
                },
                location: Math.round((c.location / 100) * 4096),
                midpoint: c.midpoint,
                type: {
                    _enum: "colorStopType",
                    _value: "userStop",
                },
            });
        }

        let opacities = [];
        for (let o of opacityStops) {
            opacities.push({
                _obj: "transferSpec",
                location: Math.round((o.location / 100) * 4096),
                midpoint: o.midpoint,
                opacity: {
                    _unit: "percentUnit",
                    _value: o.opacity,
                },
            });
        }

        let commands = [
            // Make fill layer
            {
                _obj: "make",
                _target: [
                    {
                        _ref: "contentLayer",
                    },
                ],
                using: {
                    _obj: "contentLayer",
                    type: {
                        _obj: "gradientLayer",
                        angle: {
                            _unit: "angleUnit",
                            _value: angle,
                        },
                        gradient: {
                            _obj: "gradientClassEvent",
                            colors: colors,
                            gradientForm: {
                                _enum: "gradientForm",
                                _value: "customStops",
                            },
                            interfaceIconFrameDimmed: 4096.0,
                            name: "Custom",
                            transparency: opacities,
                        },
                        gradientsInterpolationMethod: {
                            _enum: "gradientInterpolationMethodType",
                            _value: "smooth",
                        },
                        type: {
                            _enum: "gradientType",
                            _value: options.type.toLowerCase(),
                        },
                    },
                },
            },
        ];

        await action.batchPlay(commands, {});
    });
};


/* ------------------------------------------------------------------------
 * Layer effects: read / copy / apply
 *
 * `set layerEffects` REPLACES the whole effects stack on a layer, so every
 * write below either carries the complete descriptor or merges into whatever
 * the layer already has. The only reliable way to reproduce a style a human
 * configured by hand is to read its descriptor and write that same descriptor
 * back onto the other layers -- there is no lossless way to re-author it from
 * a handful of named parameters.
 * ---------------------------------------------------------------------- */

const readLayerEffects = async (layerId) => {
    //reads target fine by layer id; writes do NOT (see writeLayerEffects)
    let result = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [
                    { _property: "layerEffects" },
                    { _ref: "layer", _id: layerId },
                ],
            },
        ],
        { synchronousExecution: true }
    );

    //a layer that never had a style returns SUCCESS and an empty descriptor
    let effects = result && result[0] ? result[0].layerEffects : null;

    if (!effects || !Object.keys(effects).length) {
        return null;
    }

    //a layer whose style was cleared keeps a skeleton of disabled slots, so
    //"has keys" is not the same as "has a style"
    return activeEffects(effects).length ? effects : null;
};

//Effect keys as they appear inside a layerEffects descriptor, mapped to the
//names the Photoshop UI uses, so the AI can tell what it is looking at.
const EFFECT_LABELS = {
    dropShadow: "Drop Shadow",
    innerShadow: "Inner Shadow",
    outerGlow: "Outer Glow",
    innerGlow: "Inner Glow",
    bevelEmboss: "Bevel & Emboss",
    chromeFX: "Satin",
    solidFill: "Color Overlay",
    gradientFill: "Gradient Overlay",
    patternFill: "Pattern Overlay",
    frameFX: "Stroke",
};

//Photoshop reports most effects twice: as a bare key, and as a `<key>Multi`
//array (Drop Shadow and friends can be stacked). Once any style has touched a
//layer the array is always there, holding disabled placeholder slots -- so the
//only honest test for "this layer has a style" is present && enabled.
const activeEffects = (effects) => {
    if (!effects) {
        return [];
    }

    let out = [];

    for (const key of Object.keys(EFFECT_LABELS)) {
        let value =
            effects[key] !== undefined ? effects[key] : effects[`${key}Multi`];

        if (value === undefined || value === null) {
            continue;
        }

        let entries = Array.isArray(value) ? value : [value];

        let live = entries.some(
            (e) => e && e.present !== false && e.enabled !== false
        );

        if (live) {
            out.push(EFFECT_LABELS[key]);
        }
    }

    return out;
};

//Reading layerEffects costs one batchPlay call per layer, which is minutes on
//a 300-layer banner file. `layerFXVisible` can be pulled for every layer in ONE
//multiGet, so use it to narrow the field first.
//Caveat: it reports the fx EYE, so a style that exists but was toggled off is
//not in this list. Pass an explicit layerId to read such a layer.
const layersWithVisibleFX = async () => {
    let doc = app.activeDocument;

    let countResult = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [
                    { _property: "numberOfLayers" },
                    { _ref: "document", _id: doc.id },
                ],
            },
        ],
        { synchronousExecution: true }
    );

    let count =
        countResult && countResult[0] ? countResult[0].numberOfLayers : 0;

    if (!count) {
        return null;
    }

    let listResult = await action.batchPlay(
        [
            {
                _obj: "multiGet",
                _target: [{ _ref: "document", _id: doc.id }],
                extendedReference: [
                    ["layerFXVisible", "layerID"],
                    { _obj: "layer", index: 1, count: count },
                ],
                options: {
                    failOnMissingProperty: false,
                    failOnMissingElement: false,
                },
            },
        ],
        { synchronousExecution: true }
    );

    let list = listResult && listResult[0] ? listResult[0].list : null;

    if (!list) {
        return null;
    }

    let ids = [];

    for (const item of list) {
        if (item && item.layerFXVisible === true) {
            ids.push(item.layerID);
        }
    }

    return ids;
};

const getLayerEffects = async (command) => {
    let options = command.options;
    let layerId = options.layerId;
    let layerName = options.layerName;

    //single layer : return the raw descriptor so it can be handed straight to
    //applyLayerEffects
    if (layerId !== undefined && layerId !== null) {
        let layer = findLayer(layerId);

        if (!layer) {
            throw new Error(
                `getLayerEffects : Could not find layerId : ${layerId}`
            );
        }

        let effects = await readLayerEffects(layerId);

        return {
            layerId: layerId,
            name: layer.name,
            effects: activeEffects(effects),
            layerEffects: effects,
        };
    }

    //otherwise : scan (optionally filtered by name) and report only the layers
    //that actually carry a style. Descriptors are omitted here on purpose --
    //dumping 300 of them would be unreadable.
    let candidates = layerName ? findLayersByName(layerName) : collectLayers();
    let scanned = candidates.length;

    let fxIds = await layersWithVisibleFX();

    if (fxIds) {
        candidates = candidates.filter((l) => fxIds.indexOf(l.id) !== -1);
    }

    let out = [];

    for (const layer of candidates) {
        let effects = await readLayerEffects(layer.id);

        if (!effects) {
            continue;
        }

        out.push({
            layerId: layer.id,
            name: layer.name,
            effects: activeEffects(effects),
        });
    }

    return {
        scanned: scanned,
        layersWithEffects: out,
    };
};

//`set layerEffects` REFUSES a layer-id target -- it fails with "The command
//Set is not currently available". The layer has to be selected first and
//addressed through targetEnum. Verified Aug 2026.
const writeLayerEffects = async (layerId, effects) => {
    return action.batchPlay(
        [
            {
                _obj: "select",
                _target: [{ _ref: "layer", _id: layerId }],
                layerID: [layerId],
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
            },
            {
                _obj: "set",
                _target: [
                    { _property: "layerEffects", _ref: "property" },
                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                ],
                to: effects,
            },
        ],
        {}
    );
};

const clearLayerEffects = async (layerId) => {
    return action.batchPlay(
        [
            {
                _obj: "select",
                _target: [{ _ref: "layer", _id: layerId }],
                layerID: [layerId],
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
            },
            {
                _obj: "disableLayerStyle",
                _target: [
                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                ],
            },
        ],
        {}
    );
};

//Drop Shadow, Inner Shadow, Color Overlay, Gradient Overlay and Stroke can be
//STACKED, so Photoshop represents them as a `<key>Multi` ARRAY -- and once that
//array exists on a layer, the singular key is ignored. Setting `innerShadow`
//next to an existing `innerShadowMulti` therefore did nothing at all: the write
//reported success and the effect never appeared. The array wins, so write into
//it. Effects that cannot stack (glows, bevel, satin) have no Multi form and keep
//using the singular key.
const _assignEffect = (target, key, value) => {
    let multi = `${key}Multi`;

    if (Object.prototype.hasOwnProperty.call(target, multi)) {
        target[multi] = [value];
        delete target[key];
    } else {
        target[key] = value;
    }
};

//Merge `source` on top of whatever `layerId` already has, so applying a
//gradient overlay does not silently throw away an existing drop shadow.
const mergeEffects = async (layerId, source) => {
    let existing = await readLayerEffects(layerId);

    if (!existing) {
        return source;
    }

    let merged = Object.assign({}, existing);

    for (const key of Object.keys(source)) {
        if (key === "_obj" || key === "scale") {
            merged[key] = source[key];
            continue;
        }

        _assignEffect(merged, key, source[key]);
    }

    merged._obj = "layerEffects";

    return merged;
};

const applyLayerEffects = async (command) => {
    let options = command.options;
    let effects = options.layerEffects;

    if (!effects || !Object.keys(effects).length) {
        throw new Error("applyLayerEffects : layerEffects is empty");
    }

    effects = Object.assign({}, effects, { _obj: "layerEffects" });

    let targets = resolveLayerTargets(options);
    let merge = options.merge === true;

    let applied = [];

    await execute(async () => {
        for (const layer of targets) {
            let payload = merge
                ? await mergeEffects(layer.id, effects)
                : effects;

            await writeLayerEffects(layer.id, payload);

            applied.push({ layerId: layer.id, name: layer.name });
        }
    }, "Apply layer effects");

    return { applied: applied, count: applied.length };
};

const copyLayerStyle = async (command) => {
    let options = command.options;
    let sourceLayerId = options.sourceLayerId;

    let source = findLayer(sourceLayerId);

    if (!source) {
        throw new Error(
            `copyLayerStyle : Could not find sourceLayerId : ${sourceLayerId}`
        );
    }

    let effects = await readLayerEffects(sourceLayerId);

    if (!effects) {
        throw new Error(
            `copyLayerStyle : Layer "${source.name}" (${sourceLayerId}) has no layer style to copy`
        );
    }

    effects = Object.assign({}, effects, { _obj: "layerEffects" });

    //default: every other layer sharing the source's name, which is the
    //multi-artboard case this exists for
    let targetOptions = {
        layerIds: options.targetLayerIds,
        layerName:
            options.targetLayerIds && options.targetLayerIds.length
                ? null
                : options.targetLayerName || source.name,
    };

    let targets = resolveLayerTargets(targetOptions, sourceLayerId);
    let merge = options.merge === true;

    let applied = [];

    await execute(async () => {
        for (const layer of targets) {
            let payload = merge
                ? await mergeEffects(layer.id, effects)
                : effects;

            await writeLayerEffects(layer.id, payload);

            applied.push({ layerId: layer.id, name: layer.name });
        }
    }, "Copy layer style");

    return {
        source: { layerId: sourceLayerId, name: source.name },
        effects: activeEffects(effects),
        applied: applied,
        count: applied.length,
    };
};

const removeLayerEffects = async (command) => {
    let targets = resolveLayerTargets(command.options);

    let cleared = [];

    await execute(async () => {
        for (const layer of targets) {
            await clearLayerEffects(layer.id);
            cleared.push({ layerId: layer.id, name: layer.name });
        }
    }, "Remove layer effects");

    return { cleared: cleared, count: cleared.length };
};

const buildGradient = (colorStops, opacityStops) => {
    let colors = [];
    for (let c of colorStops) {
        colors.push({
            _obj: "colorStop",
            color: {
                _obj: "RGBColor",
                //Photoshop keys the green channel as "grain" in RGBColor
                blue: c.color.blue,
                grain: c.color.green,
                red: c.color.red,
            },
            //stop positions are 0-4096 internally, not 0-100
            location: Math.round((c.location / 100) * 4096),
            midpoint: opt(c.midpoint, 50),
            type: {
                _enum: "colorStopType",
                _value: "userStop",
            },
        });
    }

    let opacities = [];
    for (let o of opacityStops) {
        opacities.push({
            _obj: "transferSpec",
            location: Math.round((o.location / 100) * 4096),
            midpoint: opt(o.midpoint, 50),
            opacity: {
                _unit: "percentUnit",
                _value: o.opacity,
            },
        });
    }

    return {
        _obj: "gradientClassEvent",
        colors: colors,
        gradientForm: {
            _enum: "gradientForm",
            _value: "customStops",
        },
        interfaceIconFrameDimmed: 4096.0,
        name: "Custom",
        transparency: opacities,
    };
};

const addGradientOverlayLayerStyle = async (command) => {
    let options = command.options;

    let effects = {
        _obj: "layerEffects",
        scale: {
            _unit: "percentUnit",
            _value: 100.0,
        },
        gradientFill: {
            _obj: "gradientLayer",
            align: options.alignWithLayer !== false,
            angle: {
                _unit: "angleUnit",
                _value: options.angle,
            },
            dither: options.dither === true,
            enabled: true,
            gradient: buildGradient(options.colorStops, options.opacityStops),
            //Inside a layer EFFECT the interpolation method lives under the
            //obfuscated key `$gs99`; writing `gradientsInterpolationMethod`
            //here is silently ignored and the gradient comes back "classic",
            //which bands. Both are sent so either key wins.
            gradientsInterpolationMethod: {
                _enum: "gradientInterpolationMethodType",
                _value: "smooth",
            },
            $gs99: {
                _enum: "gradientInterpolationMethodType",
                _value: "smooth",
            },
            mode: _blendModeEnum(options.blendMode),
            offset: {
                _obj: "paint",
                horizontal: {
                    _unit: "percentUnit",
                    _value: 0.0,
                },
                vertical: {
                    _unit: "percentUnit",
                    _value: 0.0,
                },
            },
            opacity: {
                _unit: "percentUnit",
                _value: options.opacity,
            },
            present: true,
            reverse: options.reverse === true,
            scale: {
                _unit: "percentUnit",
                _value: opt(options.scale, 100),
            },
            showInDialog: true,
            type: {
                _enum: "gradientType",
                _value: options.type.toLowerCase(),
            },
        },
    };

    //Same write-and-verify path as the other six, so every effect tool reports
    //`effects` read back from Photoshop rather than an assumption.
    return _applyEffectDescriptor(
        options,
        effects,
        "gradientFill",
        "Add gradient overlay"
    );
};


/* ------------------------------------------------------------------------
 * The remaining seven effects, built from parameters
 *
 * All of them go through _addEffect, so they share one merge policy and one
 * write path. Only fields the caller actually chose are sent: Photoshop fills
 * the rest with its own defaults, which is both shorter and safer than this
 * file carrying a guess at every default and enum spelling.
 * ---------------------------------------------------------------------- */

const _rgb = (color) => {
    return {
        _obj: "RGBColor",
        //Photoshop keys the green channel as "grain"
        red: color.red,
        grain: color.green,
        blue: color.blue,
    };
};

const _pct = (v) => ({ _unit: "percentUnit", _value: v });
const _px = (v) => ({ _unit: "pixelsUnit", _value: v });
const _deg = (v) => ({ _unit: "angleUnit", _value: v });

//Every effect shares these three, and every one of them must be set or the
//effect is written but not shown.
const _effectBase = (blendMode) => {
    let base = {
        enabled: true,
        present: true,
        showInDialog: true,
    };

    if (blendMode) {
        base.mode = _blendModeEnum(blendMode);
    }

    return base;
};

const _applyEffectDescriptor = async (options, effects, key, label) => {
    let targets = resolveLayerTargets(options);

    //merge by default: a layer in a finished design usually already carries a
    //stroke or a shadow, and `set layerEffects` would drop it
    let merge = options.merge !== false;

    let applied = [];

    await execute(async () => {
        for (const layer of targets) {
            let payload = merge
                ? await mergeEffects(layer.id, effects)
                : effects;

            await writeLayerEffects(layer.id, payload);

            applied.push({ layerId: layer.id, name: layer.name });
        }
    }, label);

    //Report what Photoshop actually holds, not what was asked for. These
    //descriptors reject a field they do not understand by ignoring it, so the
    //readback is the only proof the effect is really there.
    let verified = [];

    for (const a of applied) {
        let live = await readLayerEffects(a.layerId);

        verified.push({
            layerId: a.layerId,
            name: a.name,
            effects: activeEffects(live),
        });
    }

    let missing = verified.filter(
        (v) => v.effects.indexOf(EFFECT_LABELS[key]) === -1
    );

    if (missing.length) {
        //Name what DID land as well. Every target above has already been
        //written, so an error carrying only the failures leaves the caller
        //unable to tell which layers the document now differs on.
        let landed = verified.filter(
            (v) => v.effects.indexOf(EFFECT_LABELS[key]) !== -1
        );

        throw new Error(
            `${label} : Photoshop reported success but ${EFFECT_LABELS[key]} is not present on : ${JSON.stringify(
                missing
            )} -- it WAS applied to these and they are not rolled back : ${JSON.stringify(
                landed
            )}`
        );
    }

    return { applied: verified, count: verified.length };
};

const _addEffect = async (command, key, objName, build) => {
    let options = command.options;

    let effects = {
        _obj: "layerEffects",
        scale: _pct(100),
    };

    effects[key] = Object.assign(
        { _obj: objName },
        _effectBase(options.blendMode),
        build(options)
    );

    return _applyEffectDescriptor(options, effects, key, `add ${objName}`);
};

const addInnerShadowLayerStyle = async (command) =>
    _addEffect(command, "innerShadow", "innerShadow", (o) => ({
        color: _rgb(o.color),
        opacity: _pct(o.opacity),
        useGlobalAngle: false,
        localLightingAngle: _deg(o.angle),
        distance: _px(o.distance),
        chokeMatte: _px(o.choke),
        blur: _px(o.size),
        noise: _pct(0),
        antiAlias: false,
    }));

//"Softer" / "Precise" in the Technique menu. Verified against readback: an
//unrecognised member is IGNORED and Photoshop keeps its default, so a typo here
//shows up as a glow that quietly has the wrong edge.
const _matteTechnique = (technique) => {
    let t = String(technique || "SOFTER").toUpperCase();

    if (t !== "SOFTER" && t !== "PRECISE") {
        throw new Error(
            `technique must be SOFTER or PRECISE, got : ${technique}`
        );
    }

    return {
        _enum: "matteTechnique",
        _value: t === "PRECISE" ? "preciseMatte" : "softMatte",
    };
};

const addOuterGlowLayerStyle = async (command) =>
    _addEffect(command, "outerGlow", "outerGlow", (o) => ({
        color: _rgb(o.color),
        opacity: _pct(o.opacity),
        glowTechnique: _matteTechnique(o.technique),
        chokeMatte: _px(o.spread),
        blur: _px(o.size),
        noise: _pct(o.noise),
        antiAlias: false,
    }));

const addInnerGlowLayerStyle = async (command) =>
    _addEffect(command, "innerGlow", "innerGlow", (o) => {
        //"Source" in the UI. The key is `innerGlowSource` and the enum class is
        //`innerGlowSourceType` -- both confirmed by readback. `glowSource` with
        //enum `innerGlowSource`, which looks just as plausible, is accepted and
        //then ignored.
        let source = String(o.source || "EDGE").toUpperCase();

        if (source !== "EDGE" && source !== "CENTER") {
            throw new Error(
                `addInnerGlowLayerStyle : source must be EDGE or CENTER, got : ${o.source}`
            );
        }

        return {
            color: _rgb(o.color),
            opacity: _pct(o.opacity),
            glowTechnique: _matteTechnique(o.technique),
            chokeMatte: _px(o.spread),
            blur: _px(o.size),
            noise: _pct(o.noise),
            antiAlias: false,
            innerGlowSource: {
                _enum: "innerGlowSourceType",
                _value: source === "CENTER" ? "centerGlow" : "edgeGlow",
            },
        };
    });

const addSatinLayerStyle = async (command) =>
    _addEffect(command, "chromeFX", "chromeFX", (o) => ({
        color: _rgb(o.color),
        opacity: _pct(o.opacity),
        localLightingAngle: _deg(o.angle),
        distance: _px(o.distance),
        blur: _px(o.size),
        invert: o.invert === true,
        antiAlias: false,
    }));

const addColorOverlayLayerStyle = async (command) =>
    _addEffect(command, "solidFill", "solidFill", (o) => ({
        color: _rgb(o.color),
        opacity: _pct(o.opacity),
    }));

//Verified members. Photoshop's own default when bevelStyle is omitted is
//outerBevel, NOT the innerBevel the UI opens on, so this is always sent.
const BEVEL_STYLES = {
    INNER: "innerBevel",
    OUTER: "outerBevel",
    EMBOSS: "emboss",
    PILLOW: "pillowEmboss",
    STROKE: "strokeEmboss",
};

const BEVEL_TECHNIQUES = {
    SMOOTH: "softMatte",
    CHISEL_HARD: "preciseMatte",
    CHISEL_SOFT: "slopeLimitMatte",
};

//`stampIn`/`stampOut` are the values to WRITE. Note the asymmetry: written as
//`stampIn`, Photoshop reads it back as plain "in". Writing "out" is not a
//valid member -- it is ignored and the direction stays Up.
const BEVEL_DIRECTIONS = {
    UP: "stampIn",
    DOWN: "stampOut",
};

const _bevelEnum = (map, value, fallback, label) => {
    let key = String(value || fallback).toUpperCase();

    if (!map[key]) {
        throw new Error(
            `addBevelEmbossLayerStyle : ${label} must be one of ${Object.keys(
                map
            ).join(", ")}, got : ${value}`
        );
    }

    return map[key];
};

const addBevelEmbossLayerStyle = async (command) =>
    _addEffect(command, "bevelEmboss", "bevelEmboss", (o) => ({
        bevelStyle: {
            _enum: "bevelEmbossStyle",
            _value: _bevelEnum(BEVEL_STYLES, o.style, "INNER", "style"),
        },
        bevelTechnique: {
            _enum: "bevelTechnique",
            _value: _bevelEnum(
                BEVEL_TECHNIQUES,
                o.technique,
                "SMOOTH",
                "technique"
            ),
        },
        bevelDirection: {
            _enum: "bevelEmbossStampStyle",
            _value: _bevelEnum(
                BEVEL_DIRECTIONS,
                o.direction,
                "UP",
                "direction"
            ),
        },
        //depth
        strengthRatio: _pct(o.depth),
        blur: _px(o.size),
        softness: _px(o.soften),
        useGlobalAngle: false,
        localLightingAngle: _deg(o.angle),
        localLightingAltitude: _deg(o.altitude),
        highlightMode: _blendModeEnum(o.highlightBlendMode),
        highlightColor: _rgb(o.highlightColor),
        highlightOpacity: _pct(o.highlightOpacity),
        shadowMode: _blendModeEnum(o.shadowBlendMode),
        shadowColor: _rgb(o.shadowColor),
        shadowOpacity: _pct(o.shadowOpacity),
        antialiasGloss: false,
        useShape: false,
        useTexture: false,
    }));

const addPatternOverlayLayerStyle = async (command) =>
    _addEffect(command, "patternFill", "patternFill", (o) => ({
        opacity: _pct(o.opacity),
        pattern: {
            _obj: "pattern",
            name: o.patternName,
            //Photoshop identifies a pattern by this GUID. There is no API here
            //to create one, so it has to already exist in the document's
            //presets; get_layer_effects on a layer that uses the pattern is
            //the way to read its ID.
            ID: o.patternId,
        },
        scale: _pct(o.scale),
        linked: o.linked !== false,
        phase: {
            _obj: "paint",
            horizontal: 0,
            vertical: 0,
        },
    }));


const commandHandlers = {
    createGradientLayerStyle,
    addStrokeLayerStyle,
    addDropShadowLayerStyle,
    addGradientOverlayLayerStyle,
    getLayerEffects,
    applyLayerEffects,
    copyLayerStyle,
    removeLayerEffects,
    addInnerShadowLayerStyle,
    addOuterGlowLayerStyle,
    addInnerGlowLayerStyle,
    addBevelEmbossLayerStyle,
    addSatinLayerStyle,
    addColorOverlayLayerStyle,
    addPatternOverlayLayerStyle
};

module.exports = {
    commandHandlers
};