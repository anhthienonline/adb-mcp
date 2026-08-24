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

/* ------------------------------------------------------------------------
 * Text style: read and replay
 *
 * The point of this file is that `edit_text_layer` cannot carry typography
 * safely. Passing text_color to it silently rewrote GTAmerica-CondensedBold to
 * MyriadPro-Regular -- unrecoverable without the font installed -- because
 * writing one character attribute replaces the whole run.
 *
 * So styles are moved the same way layer styles are: read Photoshop's own
 * `textStyle` descriptor and write it back verbatim. No field list to keep in
 * sync, no attribute silently reset to a default because it was not mentioned.
 * ---------------------------------------------------------------------- */

const { app, action, constants } = require("photoshop");

const {
    selectLayer,
    findLayer,
    findLayersByName,
    resolveLayerTargets,
    execute,
    opt,
    convertFromPhotoshopFontSize,
} = require("./utils");

const _isTextLayer = (layer) => {
    return (
        String(layer.kind).toUpperCase() ===
        String(constants.LayerKind.TEXT).toUpperCase()
    );
};

const _readTextKey = async (layerId) => {
    let result = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [{ _ref: "layer", _id: layerId }],
            },
        ],
        { synchronousExecution: true }
    );

    let textKey = result && result[0] ? result[0].textKey : null;

    if (!textKey || !textKey.textStyleRange || !textKey.textStyleRange.length) {
        throw new Error(
            `readTextKey : Could not read textStyleRange for layer [${layerId}]`
        );
    }

    return textKey;
};

//A readable summary of one run. The raw descriptor is returned alongside it,
//because that -- not this -- is what gets written back.
//size, leading and friends arrive as {_unit:"pointsUnit", _value:N}. Handing the
//descriptor straight to the point converter divides an object by a number, which
//is NaN and serialises as null -- every size read back as null until this was
//unwrapped.
const _unit = (v) => (v && v._value !== undefined ? v._value : v);

const _summariseRun = (run, contents) => {
    let style = run.textStyle || {};

    let color = style.color
        ? {
              red: Math.round(style.color.red),
              green: Math.round(style.color.grain),
              blue: Math.round(style.color.blue),
          }
        : null;

    return {
        from: run.from,
        to: run.to,
        text:
            contents === undefined
                ? undefined
                //`to` can be one past the end; substring clamps, so this is
                //safe, but it is why `to` and contentsLength differ by one
                : contents.substring(run.from, run.to),
        font: style.fontPostScriptName,
        fontStyle: style.fontStyleName,
        size:
            style.size === undefined
                ? undefined
                : convertFromPhotoshopFontSize(_unit(style.size)),
        leading:
            style.autoLeading === true
                ? "auto"
                : style.leading === undefined
                ? undefined
                : convertFromPhotoshopFontSize(_unit(style.leading)),
        tracking: _unit(style.tracking),
        color: color,
        allCaps:
            style.fontCaps && style.fontCaps._value
                ? style.fontCaps._value
                : undefined,
        syntheticBold: style.syntheticBold,
        syntheticItalic: style.syntheticItalic,
    };
};

const getTextStyle = async (command) => {
    let options = command.options;

    let layer = findLayer(options.layerId);

    if (!layer) {
        throw new Error(
            `getTextStyle : Could not find layerId : ${options.layerId}`
        );
    }

    if (!_isTextLayer(layer)) {
        throw new Error(
            `getTextStyle : Layer [${layer.id}] "${layer.name}" is not a text layer (kind: ${layer.kind})`
        );
    }

    let textKey = await _readTextKey(layer.id);
    let contents = layer.textItem.contents;

    return {
        layerId: layer.id,
        name: layer.name,
        contents: contents,
        contentsLength: contents.length,
        runCount: textKey.textStyleRange.length,
        runs: textKey.textStyleRange.map((r) => _summariseRun(r, contents)),
        //verbatim, for copy_text_style / apply_text_style
        textStyleRange: textKey.textStyleRange,
    };
};

const _writeTextStyleRange = async (layer, textStyleRange) => {
    //Clearing the selection through the DOM alone does NOT stick for layers
    //inside artboards -- area text especially -- so the batchPlay select below
    //carries `layerID` to REPLACE the selection. Without it a `set` on
    //targetEnum restyles whatever else happened to be selected.
    selectLayer(layer, true);

    return action.batchPlay(
        [
            {
                _obj: "select",
                _target: [{ _ref: "layer", _id: layer.id }],
                layerID: [layer.id],
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
            },
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

//UNIFORM: one style over the whole string. Works whatever the target says,
//which is what a banner set needs -- the same headline is one line at 728x90
//and three at 300x600, so the run boundaries never line up.
const _uniformRanges = (baseStyle, length) => {
    return [
        {
            _obj: "textStyleRange",
            from: 0,
            to: length,
            textStyle: Object.assign({}, baseStyle, {
                //lets everything not named here inherit instead of snapping to
                //a default
                styleSheetHasParent: true,
            }),
        },
    ];
};

//PER_RUN: replay the source's boundaries. Only honest when the two strings are
//the same length; otherwise the ranges land on different words and the result
//looks deliberate while being wrong.
const _perRunRanges = (sourceRuns, length) => {
    let last = sourceRuns[sourceRuns.length - 1];

    //Photoshop extends the final range one character past the string, so a
    //14-character layer reports `to: 15`. Comparing the raw numbers would make
    //PER_RUN fail even on identical copy. Both are accepted.
    if (last.to !== length && last.to !== length + 1) {
        throw new Error(
            `copyTextStyle : PER_RUN needs matching text lengths - source runs end at ${last.to}, target text is ${length} characters. Use UNIFORM, or edit the text first.`
        );
    }

    return sourceRuns.map((r) => ({
        _obj: "textStyleRange",
        from: r.from,
        to: r.to,
        textStyle: Object.assign({}, r.textStyle, {
            styleSheetHasParent: true,
        }),
    }));
};

const copyTextStyle = async (command) => {
    let options = command.options;

    let source = findLayer(options.sourceLayerId);

    if (!source) {
        throw new Error(
            `copyTextStyle : Could not find sourceLayerId : ${options.sourceLayerId}`
        );
    }

    if (!_isTextLayer(source)) {
        throw new Error(
            `copyTextStyle : Source layer [${source.id}] "${source.name}" is not a text layer (kind: ${source.kind})`
        );
    }

    let sourceKey = await _readTextKey(source.id);
    let sourceRuns = sourceKey.textStyleRange;

    let mode = String(opt(options.mode, "UNIFORM")).toUpperCase();

    if (mode !== "UNIFORM" && mode !== "PER_RUN") {
        throw new Error(
            `copyTextStyle : mode must be UNIFORM or PER_RUN, got : ${options.mode}`
        );
    }

    let targetOptions = {
        layerIds: options.targetLayerIds,
        layerName:
            options.targetLayerIds && options.targetLayerIds.length
                ? null
                : options.targetLayerName || source.name,
    };

    let targets = resolveLayerTargets(targetOptions, source.id);

    let applied = [];
    let skipped = [];

    await execute(async () => {
        for (const layer of targets) {
            if (!_isTextLayer(layer)) {
                skipped.push({
                    layerId: layer.id,
                    name: layer.name,
                    reason: `not a text layer (kind: ${layer.kind})`,
                });
                continue;
            }

            try {
                let contents = layer.textItem.contents;

                let ranges =
                    mode === "UNIFORM"
                        ? _uniformRanges(sourceRuns[0].textStyle, contents.length)
                        : _perRunRanges(sourceRuns, contents.length);

                await _writeTextStyleRange(layer, ranges);

                applied.push({ layerId: layer.id, name: layer.name });
            } catch (e) {
                skipped.push({
                    layerId: layer.id,
                    name: layer.name,
                    reason: e.message,
                });
            }
        }
    }, "Copy text style");

    //Verify from the file rather than from SUCCESS: a run that silently kept
    //its old font is exactly the failure this tool exists to prevent.
    let verified = [];

    for (const a of applied) {
        try {
            let key = await _readTextKey(a.layerId);

            verified.push({
                layerId: a.layerId,
                name: a.name,
                fonts: key.textStyleRange.map(
                    (r) => r.textStyle.fontPostScriptName
                ),
                runCount: key.textStyleRange.length,
            });
        } catch (e) {
            //_readTextKey throws when it cannot read the run list. The style has
            //ALREADY been written at this point, so letting that escape would
            //discard the whole report -- applied and skipped both -- for a
            //document that has changed. Report the layer as unverified instead.
            verified.push({
                layerId: a.layerId,
                name: a.name,
                verified: false,
                reason: e.message,
            });
        }
    }

    let expectedFonts = sourceRuns.map((r) => r.textStyle.fontPostScriptName);

    return {
        source: {
            layerId: source.id,
            name: source.name,
            fonts: expectedFonts,
        },
        mode: mode,
        applied: verified,
        count: verified.length,
        skipped: skipped,
    };
};

const applyTextStyle = async (command) => {
    let options = command.options;

    let ranges = options.textStyleRange;

    if (!ranges || !ranges.length) {
        throw new Error("applyTextStyle : textStyleRange is empty");
    }

    let targets = resolveLayerTargets(options);

    let applied = [];
    let skipped = [];

    await execute(async () => {
        for (const layer of targets) {
            if (!_isTextLayer(layer)) {
                skipped.push({
                    layerId: layer.id,
                    name: layer.name,
                    reason: `not a text layer (kind: ${layer.kind})`,
                });
                continue;
            }

            try {
                let contents = layer.textItem.contents;

                let payload =
                    options.uniform === false
                        ? _perRunRanges(ranges, contents.length)
                        : _uniformRanges(ranges[0].textStyle, contents.length);

                await _writeTextStyleRange(layer, payload);

                applied.push({ layerId: layer.id, name: layer.name });
            } catch (e) {
                skipped.push({
                    layerId: layer.id,
                    name: layer.name,
                    reason: e.message,
                });
            }
        }
    }, "Apply text style");

    return { applied: applied, count: applied.length, skipped: skipped };
};

const commandHandlers = {
    getTextStyle,
    copyTextStyle,
    applyTextStyle,
};

module.exports = {
    commandHandlers,
};
