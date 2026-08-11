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

//const fs = require("uxp").storage.localFileSystem;
//const openfs = require('fs')
const {app, DocumentIntentOptions, ScriptLanguage} = require("indesign");


/*
 * Cua thoat hiem: chay JS bat ky tren InDesign DOM.
 *
 * Plugin InDesign chi co dung mot lenh (createDocument) nen khong doc duoc gi.
 * Thay vi boc tay tung ham nhu ben Photoshop, lam giong AfterEffects: mot lenh
 * chay script, the la phu tron DOM.
 *
 * Thu hai duong vi chua ro UXP cho phep cai nao:
 *   1. new Function(...) chay thang tren DOM cua UXP  — nhanh, cung mot tien trinh
 *   2. app.doScript(...) day sang engine ExtendScript — chac chan hon nhung ES3
 * Tra ve ca ten engine da dung de biet duong nao song.
 */
/*
 * `const {app} = require("indesign")` o dau file chay LUC NAP MODULE.
 * `app` la mot getter — neu luc do plugin chua san sang, no tra ve undefined
 * va bien `app` giu undefined mai mai. Lay lai moi lan can thi trung.
 */
const getApp = () => {
    try {
        return require("indesign").app;
    } catch (e) {
        return undefined;
    }
};

// So sanh hai cach lay app, chay trong MODULE scope (khong qua new Function)
const probeApp = async () => {
    const lazy = getApp();
    const out = {
        napModule_app: (typeof app),
        lazy_app: (typeof lazy)
    };
    try {
        out.lazy_activeDocument = lazy && lazy.activeDocument
            ? lazy.activeDocument.name : null;
    } catch (e) {
        out.lazy_err = e.toString();
    }
    try {
        out.soTrang = lazy && lazy.activeDocument
            ? lazy.activeDocument.pages.length : null;
    } catch (e) {
        out.trang_err = e.toString();
    }
    try {
        out.soPageItem = lazy && lazy.activeDocument
            ? lazy.activeDocument.pages.item(0).pageItems.length : null;
    } catch (e) {
        out.item_err = e.toString();
    }
    return out;
};

const toPlain = (v) => {
    if (v === undefined || v === null) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    try {
        JSON.stringify(v);
        return v;
    } catch (e) {
        return String(v);
    }
};

const executeScript = async (command) => {
    const src = command.options ? command.options.script : null;
    if (!src) {
        throw new Error("executeScript : requires options.script");
    }

    // `indesign` = ca module, `app` = thu duoc destructure ra khoi no.
    // main.js va commands/index.js dang hieu khac nhau ve cai nao la app that,
    // nen truyen ca hai vao cho script tu chon.
    const indesign = require("indesign");
    let uxpError = null;
    try {
        // `require` is deliberately NOT passed in. The proxy on localhost:3001
        // has no auth, so any local process can post a script here; handing it
        // `require` would hand it require('fs') and full disk access. Scripts get
        // the InDesign DOM only.
        const fn = new Function("app", "indesign",
                                '"use strict";\n' + src);
        const r = await fn(app || indesign.app, indesign);
        return {engine: "uxp", result: toPlain(r)};
    } catch (e) {
        uxpError = e.toString();
    }

    try {
        const r = app.doScript(src, ScriptLanguage.JAVASCRIPT);
        return {engine: "extendscript", result: toPlain(r)};
    } catch (e) {
        throw new Error(
            "executeScript : ca hai duong deu that bai." +
            "  [new Function] " + uxpError +
            "  [doScript] " + e.toString()
        );
    }
};


const createDocument = async (command) => {
    console.log("createDocument")

    const options = command.options

    let documents = app.documents
    let margins = options.margins

    let unit = getUnitForIntent(DocumentIntentOptions.WEB_INTENT)

    app.marginPreferences.bottom = `${margins.bottom}${unit}`
    app.marginPreferences.top = `${margins.top}${unit}`
    app.marginPreferences.left = `${margins.left}${unit}`
    app.marginPreferences.right = `${margins.right}${unit}`

    app.marginPreferences.columnCount = options.columns.count
    app.marginPreferences.columnGutter = `${options.columns.gutter}${unit}`
    

    let documentPreferences = {
        pageWidth: `${options.pageWidth}${unit}`,
        pageHeight: `${options.pageHeight}${unit}`,
        pagesPerDocument: options.pagesPerDocument,
        facingPages: options.facingPages,
        intent: DocumentIntentOptions.WEB_INTENT
    }

    const showingWindow = true
    //Boolean showingWindow, DocumentPreset documentPreset, Object withProperties 
    documents.add({showingWindow, documentPreferences})
}


/*
 * Truoc day ham nay chi biet WEB_INTENT va NEM LOI voi moi intent khac.
 * main.js goi getActiveDocumentSettings() sau MOI lenh thanh cong, nen mot file
 * PRINT (kieu pho bien nhat cua InDesign) lam moi lenh that bai — ke ca lenh da
 * chay xong. Gio tra ve don vi hop ly va khong bao gio nem loi.
 */
const getUnitForIntent = (intent) => {
    const s = intent ? intent.toString() : "";
    const is = (opt) => opt && s === opt.toString();

    if (is(DocumentIntentOptions.WEB_INTENT)) return "px";
    if (is(DocumentIntentOptions.MOBILE_INTENT)) return "px";
    if (is(DocumentIntentOptions.DIGITAL_PUBLISHING_INTENT)) return "px";
    if (is(DocumentIntentOptions.PRINT_INTENT)) return "pt";

    return "pt";   // in an la mac dinh cua InDesign
}

const parseAndRouteCommand = async (command) => {
    let action = command.action;

    let f = commandHandlers[action];

    if (typeof f !== "function") {
        throw new Error(`Unknown Command: ${action}`);
    }
    
    console.log(f.name)
    return f(command);
};




const getActiveDocumentSettings = (command) => {
    // main.js goi ham nay sau moi lenh. Neu no nem loi thi lenh da chay xong
    // van bi bao FAILURE — nen khong duoc phep nem.
    const document = app ? app.activeDocument : null
    if (!document) {
        return null
    }


    const d = document.documentPreferences
    const documentPreferences = {
        pageWidth:d.pageWidth,
        pageHeight:d.pageHeight,
        pagesPerDocument:d.pagesPerDocument,
        facingPages:d.facingPages,
        measurementUnit:getUnitForIntent(d.intent)
    }

    const marginPreferences = {
        top:document.marginPreferences.top,
        bottom:document.marginPreferences.bottom,
        left:document.marginPreferences.left,
        right:document.marginPreferences.right,
        columnCount : document.marginPreferences.columnCount,
        columnGutter : document.marginPreferences.columnGutter
    }
    return {documentPreferences, marginPreferences}
}

const checkRequiresActiveDocument = async (command) => {
    // truoc day goi requiresActiveProject — ham do khong ton tai o dau ca,
    // nen guard nay nem ReferenceError voi moi lenh khac createDocument
    if (!requiresActiveDocument(command)) {
        return;
    }

    let document = app.activeDocument
    if (!document) {
        throw new Error(
            `${command.action} : Requires an open InDesign document`
        );
    }
};

const requiresActiveDocument = (command) => {
    // executeScript khong can document mo san — script co the tu quyet dinh
    return !["createDocument", "executeScript", "probeApp"].includes(command.action);
};


// PHAI dat sau moi dinh nghia o tren.
// `const` nam trong temporal dead zone: neu khai bao commandHandlers o phia tren
// getActiveDocumentSettings thi module nem ReferenceError ngay luc nap, va plugin
// chet han — panel khong con Connect duoc nua.
const commandHandlers = {
    createDocument,
    executeScript,
    probeApp,
    getActiveDocumentSettings   // da viet san nhung truoc day quen dang ky
};


module.exports = {
    getActiveDocumentSettings,
    checkRequiresActiveDocument,
    parseAndRouteCommand
};
