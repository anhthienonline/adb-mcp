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
 * Artboards
 *
 * Every descriptor here was checked against a live document, because the
 * artboard verbs fail in the silent way rather than the loud way:
 *
 *   - `editArtboardEvent` needs `artboardRect` NESTED inside its `artboard`
 *     object. Passed as a sibling it returns {} and SUCCESS and changes
 *     nothing.
 *   - `editArtboardEvent` also refuses a layer-id target. The artboard must be
 *     the current selection and be addressed through targetEnum.
 *   - `make artboardSection` DOES honour `artboardRect`, but ignores `name`,
 *     so the artboard has to be renamed afterwards.
 *   - `make artboardSection` swallows any selected layers into the new
 *     artboard. `selectNoLayers` first for an empty one.
 *   - `exportSelectionAsFileTypePressed` only sees a selection committed by a
 *     PREVIOUS batchPlay call. Chaining select+export in one call exports
 *     nothing and still reports SUCCESS.
 *
 * `transform` with offset is used to move an artboard: it carries the frame
 * and its contents together, which `editArtboardEvent` on a shifted rect does
 * not.
 * ---------------------------------------------------------------------- */

const { app, action } = require("photoshop");

const {
    findLayer,
    execute,
    opt,
    fileEntryExists,
    deleteFileIfExists,
    waitForFile,
} = require("./utils");

const _rectOf = (ab) => {
    return ab && ab.artboardRect ? ab.artboardRect : null;
};

//Returns the artboard's whole descriptor, not just the rect: resizing has to
//write the preset name, colour and background type back or Photoshop resets
//them to defaults.
const _readArtboard = async (layerId) => {
    let result = await action.batchPlay(
        [
            {
                _obj: "get",
                _target: [
                    { _property: "artboard" },
                    { _ref: "layer", _id: layerId },
                ],
            },
        ],
        { synchronousExecution: true }
    );

    let ab = result && result[0] ? result[0].artboard : null;

    return _rectOf(ab) ? ab : null;
};

const _describe = (layer, ab) => {
    let r = _rectOf(ab);

    return {
        layerId: layer.id,
        name: layer.name,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.right - r.left,
        height: r.bottom - r.top,
    };
};

//Artboards are always top level, and the UXP DOM reports them as plain groups
//-- there is no `kind` to filter on. Probing `get artboard` is the reliable
//test: a normal group has no artboardRect.
const _collectArtboards = async () => {
    let out = [];

    for (const layer of app.activeDocument.layers) {
        let ab = await _readArtboard(layer.id);

        if (ab) {
            out.push({ layer: layer, artboard: ab });
        }
    }

    return out;
};

const _resolveArtboards = async (options) => {
    let all = await _collectArtboards();

    if (options.artboardIds && options.artboardIds.length) {
        let out = [];

        for (const id of options.artboardIds) {
            let hit = all.find((a) => a.layer.id === id);

            if (!hit) {
                throw new Error(
                    `resolveArtboards : Layer [${id}] is not an artboard`
                );
            }

            out.push(hit);
        }

        return out;
    }

    if (options.artboardName) {
        let out = all.filter((a) => a.layer.name === options.artboardName);

        if (!out.length) {
            throw new Error(
                `resolveArtboards : No artboard named : ${options.artboardName}`
            );
        }

        return out;
    }

    //no filter means every artboard, which is what the bulk verbs want
    return all;
};

const getArtboards = async (command) => {
    let all = await _collectArtboards();

    let out = all.map((a) => _describe(a.layer, a.artboard));

    out.sort((a, b) => a.left - b.left || a.top - b.top);

    return { count: out.length, artboards: out };
};

const _selectLayerById = async (layerId) => {
    return action.batchPlay(
        [
            {
                _obj: "select",
                _target: [{ _ref: "layer", _id: layerId }],
                //`layerID: [id]` makes this a REPLACE. Without it, and with a DOM
    //`layer.selected = true` that does not stick for layers inside artboards, an
    //operation on targetEnum silently hits whatever else was still selected --
    //that is how scaling one layer shrank a second one in another artboard.
                layerID: [layerId],
                makeVisible: false,
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

const _writeArtboardRect = async (layerId, ab, rect) => {
    await _selectLayerById(layerId);

    return action.batchPlay(
        [
            {
                _obj: "editArtboardEvent",
                _target: [
                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                ],
                artboard: {
                    _obj: "artboard",
                    artboardRect: {
                        _obj: "classFloatRect",
                        top: rect.top,
                        left: rect.left,
                        bottom: rect.bottom,
                        right: rect.right,
                    },
                    artboardPresetName: ab.artboardPresetName || "",
                    color: ab.color || {
                        _obj: "RGBColor",
                        red: 255,
                        grain: 255,
                        blue: 255,
                    },
                    artboardBackgroundType:
                        ab.artboardBackgroundType === undefined
                            ? 1
                            : ab.artboardBackgroundType,
                },
            },
        ],
        {}
    );
};

const createArtboard = async (command) => {
    let options = command.options;

    let left = options.left;
    let top = options.top;
    let rect = {
        top: top,
        left: left,
        bottom: top + options.height,
        right: left + options.width,
    };

    let before = app.activeDocument.layers.map((l) => l.id);

    await execute(async () => {
        await action.batchPlay(
            [
                //without this the new artboard swallows whatever is selected
                {
                    _obj: "selectNoLayers",
                    _target: [
                        {
                            _ref: "layer",
                            _enum: "ordinal",
                            _value: "targetEnum",
                        },
                    ],
                },
                {
                    _obj: "make",
                    _target: [{ _ref: "artboardSection" }],
                    artboardRect: {
                        _obj: "classFloatRect",
                        top: rect.top,
                        left: rect.left,
                        bottom: rect.bottom,
                        right: rect.right,
                    },
                },
            ],
            {}
        );
    }, "Create artboard");

    let created = app.activeDocument.layers.find(
        (l) => before.indexOf(l.id) === -1
    );

    if (!created) {
        throw new Error(
            "createArtboard : Photoshop reported success but no new artboard appeared"
        );
    }

    //`make artboardSection` ignores a name, so set it afterwards
    if (options.name) {
        await execute(async () => {
            created.name = options.name;
        }, "Name artboard");
    }

    let ab = await _readArtboard(created.id);

    if (!ab) {
        throw new Error(
            `createArtboard : Layer [${created.id}] was created but is not an artboard`
        );
    }

    return _describe(created, ab);
};

const resizeArtboard = async (command) => {
    let options = command.options;

    let targets = await _resolveArtboards(options);

    let applied = [];

    await execute(async () => {
        for (const t of targets) {
            let current = _rectOf(t.artboard);

            //Left and top are held by default so the frame only ever grows
            //right and down. Growing from the other side ejects any layer that
            //ends up outside the rect, and an ejected layer is invisible to
            //per-artboard export.
            let left = opt(options.left, current.left);
            let top = opt(options.top, current.top);
            let width = opt(options.width, current.right - current.left);
            let height = opt(options.height, current.bottom - current.top);

            let rect = {
                left: left,
                top: top,
                right: left + width,
                bottom: top + height,
            };

            await _writeArtboardRect(t.layer.id, t.artboard, rect);

            applied.push({
                layerId: t.layer.id,
                name: t.layer.name,
                width: width,
                height: height,
            });
        }
    }, "Resize artboard");

    //re-read rather than trust SUCCESS: this verb fails silently
    let verified = [];
    let mismatched = [];

    for (const a of applied) {
        let ab = await _readArtboard(a.layerId);
        let r = _rectOf(ab);

        let got = { width: r.right - r.left, height: r.bottom - r.top };

        if (got.width === a.width && got.height === a.height) {
            verified.push({ ...a, ...got });
        } else {
            mismatched.push({ ...a, actualWidth: got.width, actualHeight: got.height });
        }
    }

    if (mismatched.length) {
        //Carry the ones that DID resize. Every target above was already
        //written, so an error listing only the failures leaves the caller
        //blind to how much of the document has moved -- and a blind retry on a
        //half-resized set of artboards is how frames end up overlapping.
        throw new Error(
            `resizeArtboard : Photoshop reported success but the rect is not what was asked for : ${JSON.stringify(
                mismatched
            )} -- these DID resize and are not rolled back : ${JSON.stringify(
                verified
            )}`
        );
    }

    return { applied: verified, count: verified.length };
};

//`move` with an offset, NOT `transform`. Measured side by side on an artboard
//whose contents had fractional bounds (a text layer scaled to 50%):
//
//  transform QCSAverage  +25 -> +24   +1 -> +0   and the frame grew 300 -> 302
//  move + offset         +25 -> +25   +1 -> +1   frame unchanged
//
//`transform` anchors on the average centre of the selection, so fractional
//content bounds round the result -- and a 1px correction rounds away to nothing,
//which is why a nudge loop could never converge. `move` is exact. It is the same
//verb translateLayer uses, which is why moves of plain layers were always exact
//while artboards drifted.
const _offsetArtboard = async (layerId, xOffset, yOffset) => {
    await _selectLayerById(layerId);

    return action.batchPlay(
        [
            {
                _obj: "move",
                _target: [
                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                ],
                to: {
                    _obj: "offset",
                    horizontal: { _unit: "pixelsUnit", _value: xOffset },
                    vertical: { _unit: "pixelsUnit", _value: yOffset },
                },
                _options: { dialogOptions: "dontDisplay" },
            },
        ],
        {}
    );
};

//`transform` offset is not pixel-exact on an artboard: measured a +25 move that
//landed as +24, and a 300-wide frame that came back 301 after a few moves. So
//every mover re-reads and corrects. Position is corrected with `transform`
//(which carries the contents), and only the SIZE is repaired with
//`editArtboardEvent` -- that verb moves the frame without its contents, so using
//it for position would leave the artwork behind.
const _snapArtboard = async (layerId, target) => {
    let ab = await _readArtboard(layerId);
    let r = _rectOf(ab);

    let dx = target.left - r.left;
    let dy = target.top - r.top;

    if (dx || dy) {
        await _offsetArtboard(layerId, dx, dy);
        ab = await _readArtboard(layerId);
        r = _rectOf(ab);
    }

    if (
        target.width !== undefined &&
        (r.right - r.left !== target.width || r.bottom - r.top !== target.height)
    ) {
        await _writeArtboardRect(layerId, ab, {
            left: r.left,
            top: r.top,
            right: r.left + target.width,
            bottom: r.top + target.height,
        });
    }
};

const moveArtboard = async (command) => {
    let options = command.options;

    let xOffset = options.xOffset || 0;
    let yOffset = options.yOffset || 0;

    if (!xOffset && !yOffset) {
        return { applied: [], count: 0 };
    }

    let targets = await _resolveArtboards(options);

    let wanted = targets.map((t) => {
        let r = _rectOf(t.artboard);

        return {
            layerId: t.layer.id,
            name: t.layer.name,
            left: r.left + xOffset,
            top: r.top + yOffset,
            width: r.right - r.left,
            height: r.bottom - r.top,
        };
    });

    await execute(async () => {
        for (const w of wanted) {
            await _offsetArtboard(w.layerId, xOffset, yOffset);
        }
    }, "Move artboard");

    await execute(async () => {
        for (const w of wanted) {
            await _snapArtboard(w.layerId, w);
        }
    }, "Snap artboard");

    let applied = [];

    for (const w of wanted) {
        let r = _rectOf(await _readArtboard(w.layerId));

        applied.push({
            layerId: w.layerId,
            name: w.name,
            left: r.left,
            top: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
            asRequested:
                r.left === w.left &&
                r.top === w.top &&
                r.right - r.left === w.width &&
                r.bottom - r.top === w.height,
        });
    }

    let drifted = applied.filter((a) => !a.asRequested);

    if (drifted.length) {
        //Same reason as resizeArtboard: the move already happened on every
        //target, so say which ones landed rather than only which ones did not.
        throw new Error(
            `moveArtboard : could not land these artboards exactly : ${JSON.stringify(
                drifted
            )} -- these DID move as asked and are not rolled back : ${JSON.stringify(
                applied.filter((a) => a.asRequested)
            )}`
        );
    }

    return { applied: applied, count: applied.length };
};

//The step that decides whether a multi-artboard resize is five minutes or
//impossible: widening a frame while its neighbour is 100px away makes the two
//overlap, and recovering from that means deleting layers, which has its own
//traps. Spread first with a gap wider than any target size, resize, then tile
//back.
const arrangeArtboards = async (command) => {
    let options = command.options;

    let gap = opt(options.gap, 100);
    let startLeft = opt(options.startLeft, 0);
    let startTop = opt(options.startTop, 0);

    let all = await _collectArtboards();

    if (!all.length) {
        throw new Error("arrangeArtboards : Document has no artboards");
    }

    let ordered = all
        .map((a) => ({ ...a, rect: _rectOf(a.artboard) }))
        .sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top);

    let moved = [];
    let cursor = startLeft;

    await execute(async () => {
        for (const a of ordered) {
            let dx = cursor - a.rect.left;
            let dy = startTop - a.rect.top;

            if (dx || dy) {
                await _offsetArtboard(a.layer.id, dx, dy);
            }

            moved.push({
                layerId: a.layer.id,
                name: a.layer.name,
                left: cursor,
                top: startTop,
                width: a.rect.right - a.rect.left,
                height: a.rect.bottom - a.rect.top,
            });

            cursor += a.rect.right - a.rect.left + gap;
        }
    }, "Arrange artboards");

    //`transform` offset lands a pixel out often enough to matter -- measured an
    //artboard at left 679 instead of 680, its box a pixel wider than it started.
    //Tiling by accumulated arithmetic is therefore not exact, so re-read and
    //nudge rather than just reporting the drift.
    await execute(async () => {
        for (const m of moved) {
            await _snapArtboard(m.layerId, m);
        }
    }, "Correct artboard drift");

    //verify from the live rects, not from the arithmetic
    let verified = [];

    for (const m of moved) {
        let ab = await _readArtboard(m.layerId);
        let r = _rectOf(ab);

        verified.push({
            layerId: m.layerId,
            name: m.name,
            left: r.left,
            top: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
            asRequested:
                r.left === m.left &&
                r.top === m.top &&
                r.right - r.left === m.width &&
                r.bottom - r.top === m.height,
        });
    }

    let drifted = verified.filter((v) => !v.asRequested);

    return {
        arranged: verified,
        count: verified.length,
        drifted: drifted,
        boundingWidth: cursor - gap - startLeft,
    };
};

const exportArtboards = async (command) => {
    let options = command.options;

    //Nothing here creates the folder, and the export verb does not either: it
    //writes nothing and still reports SUCCESS, so a mistyped destination used to
    //cost an 8-second waitForFile per artboard and then report them all as
    //`missing` without saying why. Say why, once, up front.
    if (!(await fileEntryExists(options.destFolder))) {
        throw new Error(
            `exportArtboards : destFolder does not exist : ${options.destFolder}`
        );
    }

    let targets = await _resolveArtboards(options);

    let fileType = String(opt(options.fileType, "png")).toLowerCase();

    //`quality` is NOT one field: for PNG this verb reads it as the BIT DEPTH
    //(8, 24 or 32), and a 0-100 value there makes the export write nothing at
    //all -- no file, not even the destination folder, and still SUCCESS.
    //Measured: quality 32 exported, quality 90 exported nothing. So the caller's
    //quality only reaches the lossy formats.
    let quality = fileType === "png" ? 32 : opt(options.quality, 90);

    let exported = [];
    let missing = [];

    for (const t of targets) {
        let expectedFile = `${options.destFolder}/${t.layer.name}.${fileType}`;

        //Clear any stale file so "did it appear?" is an honest question
        await deleteFileIfExists(expectedFile);

        //Two separate calls, and two separate modal scopes. The export verb
        //reads the selection Photoshop has already committed, so a select in
        //the same batchPlay call -- or even the same modal scope -- leaves it
        //exporting the previous target, or nothing at all.
        await execute(async () => {
            await _selectLayerById(t.layer.id);
        }, "Select artboard");

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
                        quality: quality,
                        metadata: 0,
                        destFolder: options.destFolder,
                        sRGB: true,
                        openWindow: false,
                    },
                ],
                {}
            );
        }, "Export artboard");

        //Export As is asynchronous, so the file may not exist yet. Waiting for
        //it is both the fix and the verification: without it the NEXT
        //iteration's select cancels this export and the file never appears.
        let landed = await waitForFile(expectedFile);

        if (landed) {
            exported.push({
                layerId: t.layer.id,
                name: t.layer.name,
                file: expectedFile,
            });
        } else {
            missing.push({
                layerId: t.layer.id,
                name: t.layer.name,
                expectedFile: expectedFile,
            });
        }
    }

    if (missing.length && !exported.length) {
        throw new Error(
            `exportArtboards : nothing was written : ${JSON.stringify(missing)}`
        );
    }

    return {
        exported: exported,
        count: exported.length,
        //`requested` so that a partial export cannot read as a complete one:
        //count alone looks like success until you know what was asked for.
        requested: targets.length,
        missing: missing,
        note: missing.length
            ? `INCOMPLETE : ${exported.length} of ${targets.length} artboards were written. The rest are listed in 'missing' and no file exists for them.`
            : "Filenames come from the artboard names. Each file was confirmed on disk before this returned.",
    };
};

const commandHandlers = {
    getArtboards,
    createArtboard,
    resizeArtboard,
    moveArtboard,
    arrangeArtboards,
    exportArtboards,
};

module.exports = {
    commandHandlers,
};
