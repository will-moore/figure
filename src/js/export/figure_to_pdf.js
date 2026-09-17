// Client-side port of the relevant parts of ome_figure/export_script.py
// Scope (first pass): single page, panel images + panel labels only.
// No scalebar, colorbar or ROI/shape export yet.

import { jsPDF } from "jspdf";
import { marked } from "marked";

const DEFAULT_OFFSET = 0;

// Same geometry as FigureExport.get_crop_region() in export_script.py
function getCropRegion(panel) {
    const zoom = parseFloat(panel.zoom);
    const frame_w = panel.width;
    const frame_h = panel.height;
    const dx = panel.dx || DEFAULT_OFFSET;
    const dy = panel.dy || DEFAULT_OFFSET;
    const orig_w = panel.orig_width;
    const orig_h = panel.orig_height;

    let tile_w = orig_w / (zoom / 100);
    let tile_h = orig_h / (zoom / 100);

    const orig_ratio = orig_w / orig_h;
    const wh = frame_w / frame_h;

    if (Math.abs(orig_ratio - wh) > 0.01) {
        if (orig_ratio < wh) {
            tile_h = tile_w / wh;
        } else {
            tile_w = tile_h * wh;
        }
    }

    return {
        x: ((orig_w - tile_w) / 2) - dx,
        y: ((orig_h - tile_h) / 2) - dy,
        width: tile_w,
        height: tile_h,
    };
}

// Same formatting as FigureExport.get_time_label_text() in export_script.py
function getTimeLabelText(deltaT, format, decPrec = 0) {
    let isNegative = deltaT < 0;
    const absT = Math.abs(deltaT);
    const npad = 2 + decPrec + (decPrec > 0 ? 1 : 0);
    const padNum = (num) => {
        let s = num.toFixed(decPrec);
        while (s.length < npad) s = "0" + s;
        return s;
    };
    let text;
    if (["milliseconds", "ms"].includes(format)) {
        text = `${(absT * 1000).toFixed(decPrec)} ms`;
    } else if (["secs", "seconds", "s"].includes(format)) {
        text = `${absT.toFixed(decPrec)} s`;
    } else if (["mins", "minutes", "m"].includes(format)) {
        text = `${(absT / 60).toFixed(decPrec)} mins`;
    } else if (["mins:secs", "m:s"].includes(format)) {
        const m = Math.floor(absT / 60);
        text = `${m}:${padNum(absT % 60)}`;
    } else if (["hrs:mins", "h:m"].includes(format)) {
        const h = Math.floor(absT / 3600);
        text = `${h}:${padNum((absT % 3600) / 60)}`;
    } else if (["hrs:mins:secs", "h:m:s"].includes(format)) {
        const h = Math.floor(absT / 3600);
        const m = Math.floor((absT % 3600) / 60);
        text = `${h}:${String(m).padStart(2, "0")}:${padNum(absT % 60)}`;
    } else {
        return "";
    }
    const decStr = decPrec === 0 ? "" : "." + "0".repeat(decPrec);
    const zeroForms = [`0${decStr} s`, `0:00${decStr}`, `0${decStr} mins`, `0:00:00${decStr}`];
    if (zeroForms.includes(text)) {
        isNegative = false;
    }
    return (isNegative ? "-" : "") + text;
}

// Markdown labels can't be rendered as rich text by jsPDF, so render to plain text.
function markdownToPlainText(text) {
    let html = marked.parse(text || "");
    html = html.replace(/<\/(p|div|li)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").trim();
}

function hexToRgb(color) {
    color = (color || "000000").replace("#", "");
    return [
        parseInt(color.substring(0, 2), 16) || 0,
        parseInt(color.substring(2, 4), 16) || 0,
        parseInt(color.substring(4, 6), 16) || 0,
    ];
}

// Substitutes [property;options] tokens in label text, mirroring the regex-driven
// substitution block in FigureExport.draw_labels() in export_script.py
function substituteLabelText(text, panel, viewportRegion) {
    const parseRe = /\[.+?\]/g;
    let lastIdx = 0;
    let result = "";
    let match;
    while ((match = parseRe.exec(text)) !== null) {
        result += text.slice(lastIdx, match.index);
        let labelValue = "";
        const expr = match[0].slice(1, -1).split(";");
        const propNf = expr[0].trim().split(".");
        const params = {};
        for (const value of expr.slice(1)) {
            const kv = value.split("=");
            if (kv.length > 1) {
                const n = parseInt(kv[1].trim(), 10);
                if (!isNaN(n)) params[kv[0].trim()] = n;
            }
        }
        const offset = params.offset;
        let precision = params.precision;

        if (propNf[0] === "time" || propNf[0] === "t") {
            const theT = panel.theT;
            const timestamps = panel.deltaT;
            if (propNf.length === 1 || propNf[1] === "index") {
                labelValue = String(theT + 1);
            } else {
                let dT = 0;
                if (timestamps && theT < timestamps.length) {
                    dT = timestamps[theT];
                    if (offset !== undefined && offset >= 1 && offset <= timestamps.length) {
                        dT -= timestamps[offset - 1];
                    }
                }
                precision = precision === undefined ? 0 : precision;
                labelValue = getTimeLabelText(dT, propNf[1], precision);
            }
        } else if (propNf[0] === "image") {
            const format = propNf.length > 1 ? propNf[1] : "name";
            if (format === "name") {
                const parts = (panel.name || "").split("/");
                labelValue = parts[parts.length - 1];
            } else if (format === "id") {
                labelValue = String(panel.imageId);
            }
            labelValue = labelValue.replace(/_/g, "\\_");
        } else if (["dataset", "project", "plate", "screen", "run", "acquisition", "well", "field", "wellsample"].includes(propNf[0])) {
            let key = propNf[0];
            let defaultFrmt = "name";
            if (key === "well") defaultFrmt = "label";
            if (key === "field") { defaultFrmt = "index"; key = "wellsample"; }
            if (key === "run") key = "acquisition";
            const format = propNf.length > 1 ? propNf[1] : defaultFrmt;
            if (format === "id" || format === defaultFrmt) {
                const parent = (panel.parents && panel.parents[key]) || null;
                labelValue = parent ? String(parent[format] ?? "") : "undefined";
            } else {
                labelValue = "";
            }
            labelValue = labelValue.replace(/_/g, "\\_");
        } else if (["x", "y", "z", "width", "height", "w", "h", "rotation", "rot"].includes(propNf[0])) {
            let format = propNf.length > 1 ? propNf[1] : "pixel";
            if (format === "px") format = "pixel";
            let prop = propNf[0];
            if (prop === "w") prop = "width";
            else if (prop === "h") prop = "height";
            else if (prop === "rot") prop = "rotation";

            precision = precision === undefined ? 2 : precision;

            if (prop === "z") {
                const sizeZ = panel.sizeZ;
                const pixelSizeZ = panel.pixel_size_z || 0;
                const zSymbol = panel.pixel_size_z_symbol || "\u00B5m";
                if (panel.z_projection) {
                    const zStart = panel.z_start, zEnd = panel.z_end;
                    if (format === "pixel") {
                        labelValue = `${zStart + 1}-${zEnd + 1}`;
                    } else if (format === "unit" && sizeZ) {
                        labelValue = `${(zStart * pixelSizeZ).toFixed(precision)} ${zSymbol} - ${(zEnd * pixelSizeZ).toFixed(precision)} ${zSymbol}`;
                    }
                } else {
                    let theZ = panel.theZ || 0;
                    if (format === "pixel") {
                        if (offset !== undefined && offset >= 1) theZ -= offset;
                        labelValue = String(theZ + 1);
                    } else if (format === "unit" && sizeZ && theZ < sizeZ) {
                        if (offset !== undefined && offset >= 1) theZ -= offset;
                        labelValue = `${(theZ * pixelSizeZ).toFixed(precision)} ${zSymbol}`;
                    }
                }
            } else if (prop === "rotation") {
                labelValue = `${parseInt(panel.rotation, 10)}${panel.rotation_symbol}`;
            } else {
                const value = viewportRegion[prop];
                if (format === "pixel") {
                    labelValue = String(Math.trunc(value));
                } else if (format === "unit") {
                    let scale;
                    if (["x", "width"].includes(prop)) scale = panel.pixel_size_x;
                    else if (["y", "height"].includes(prop)) scale = panel.pixel_size_y;
                    scale = scale || 0;
                    labelValue = `${(value * scale).toFixed(precision)} ${panel.pixel_size_x_symbol}`;
                }
            }
        } else if (["channels", "c"].includes(propNf[0])) {
            labelValue = (panel.channels || [])
                .filter((c) => c.active)
                .map((c) => c.label)
                .join(" ");
        } else if (propNf[0] === "zoom") {
            let zoom = panel.zoom;
            try { zoom = Math.round(zoom); } catch (e) { /* keep original */ }
            labelValue = `${zoom} %`;
        }
        result += labelValue || match[0];
        lastIdx = parseRe.lastIndex;
    }
    result += text.slice(lastIdx);
    return result;
}

// Groups panel labels by position and computes their page (top-down) coordinates,
// mirroring FigureExport.draw_labels() in export_script.py (minus the actual drawing).
function computeLabelDraws(panel) {
    const x = panel.x;
    const y = panel.y;
    const width = panel.width;
    const height = panel.height;
    const border = panel.border;
    const viewportRegion = getCropRegion(panel);

    const positions = {
        top: [], bottom: [], left: [], leftvert: [], right: [], rightvert: [],
        topleft: [], topright: [], bottomleft: [], bottomright: [],
    };

    const pageColor = "ffffff"; // page_color not in MVP scope, panels always drawn on white
    for (const rawLabel of panel.labels || []) {
        const label = Object.assign({}, rawLabel);
        label.text = markdownToPlainText(substituteLabelText(label.text, panel, viewportRegion));
        label.size = parseInt(label.size, 10);
        const pos = label.position;
        const labelOnPage = ["left", "right", "top", "bottom", "leftvert", "rightvert"].includes(pos);
        if (labelOnPage) {
            const labelColor = (label.color || "").toLowerCase();
            if (labelColor === "000000" && pageColor === "000000") label.color = "ffffff";
            if (labelColor === "ffffff" && pageColor === "ffffff") label.color = "000000";
        }
        if (positions[pos]) positions[pos].push(label);
    }

    const draws = [];
    const addDraw = (label, lx, ly, align, angle) => {
        draws.push({
            text: label.text,
            x: lx,
            y: ly,
            size: label.size,
            color: hexToRgb(label.color),
            align: align || "left",
            angle: angle || 0,
        });
        return label.size;
    };

    const spacer = 5;
    const borderWidth = border && border.showBorder ? border.strokeWidth : 0;
    const borderSpacer = spacer + borderWidth;

    for (const [key, labels] of Object.entries(positions)) {
        if (labels.length === 0) continue;
        if (key === "topleft") {
            let lx = x + spacer, ly = y + spacer;
            for (const label of labels) { ly += addDraw(label, lx, ly, "left") + spacer; }
        } else if (key === "topright") {
            let lx = x + width - spacer, ly = y + spacer;
            for (const label of labels) { ly += addDraw(label, lx, ly, "right") + spacer; }
        } else if (key === "bottomleft") {
            let lx = x + spacer, ly = y + height;
            for (const label of [...labels].reverse()) { ly -= (label.size + spacer); addDraw(label, lx, ly, "left"); }
        } else if (key === "bottomright") {
            let lx = x + width - spacer, ly = y + height;
            for (const label of [...labels].reverse()) { ly -= (label.size + spacer); addDraw(label, lx, ly, "right"); }
        } else if (key === "top") {
            let lx = x + width / 2, ly = y - borderWidth;
            for (const label of [...labels].reverse()) { ly -= (label.size + spacer); addDraw(label, lx, ly, "center"); }
        } else if (key === "bottom") {
            let lx = x + width / 2, ly = y + height + borderSpacer;
            for (const label of labels) { ly += addDraw(label, lx, ly, "center") + spacer; }
        } else if (key === "left") {
            const totalH = labels.reduce((s, l) => s + l.size, 0) + spacer * (labels.length - 1);
            let lx = x - borderSpacer, ly = y + (height - totalH) / 2;
            for (const label of labels) { ly += addDraw(label, lx, ly, "right") + spacer; }
        } else if (key === "right") {
            const totalH = labels.reduce((s, l) => s + l.size, 0) + spacer * (labels.length - 1);
            let lx = x + width + borderSpacer, ly = y + (height - totalH) / 2;
            for (const label of labels) { ly += addDraw(label, lx, ly, "left") + spacer; }
        } else if (key === "leftvert") {
            let lx = x - borderSpacer, ly = y + height / 2;
            for (const label of [...labels].reverse()) { lx -= (label.size + spacer); addDraw(label, lx, ly, "center", 90); }
        } else if (key === "rightvert") {
            let lx = x + width + borderSpacer, ly = y + height / 2;
            for (const label of [...labels].reverse()) { lx += (label.size + spacer); addDraw(label, lx, ly, "center", -90); }
        }
    }
    return draws;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Panel rotation is already baked into panel.src by get_viewport_src().
// Only horizontal/vertical flip still needs to be applied here.
async function getPanelImageDataUrl(panel) {
    const img = await loadImage(panel.src);
    if (!panel.horizontal_flip && !panel.vertical_flip) {
        return panel.src;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(panel.horizontal_flip ? canvas.width : 0, panel.vertical_flip ? canvas.height : 0);
    ctx.scale(panel.horizontal_flip ? -1 : 1, panel.vertical_flip ? -1 : 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    return canvas.toDataURL("image/png");
}

function drawPanelBorder(doc, panel) {
    const border = panel.border;
    if (!border || !border.showBorder) return;
    const [r, g, b] = hexToRgb(border.color);
    const strokeWidth = border.strokeWidth;
    const shift = strokeWidth / 2;
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(strokeWidth);
    doc.rect(
        panel.x - shift,
        panel.y - shift,
        panel.width + shift * 2,
        panel.height + shift * 2,
        "S"
    );
}

function drawLabel(doc, draw) {
    doc.setFont("helvetica");
    doc.setFontSize(draw.size);
    doc.setTextColor(draw.color[0], draw.color[1], draw.color[2]);
    const lines = draw.text.split("\n");
    const options = { align: draw.align };
    if (draw.angle) options.angle = draw.angle;
    doc.text(lines, draw.x, draw.y + draw.size, options);
}

async function addPanelToPdf(doc, panel) {
    const dataUrl = await getPanelImageDataUrl(panel);
    doc.addImage(dataUrl, "PNG", panel.x, panel.y, panel.width, panel.height);
    drawPanelBorder(doc, panel);
    for (const draw of computeLabelDraws(panel)) {
        drawLabel(doc, draw);
    }
}

// Builds a single-page PDF (panels + labels only) from the figureJSON produced by
// FigureModel.figure_toJSON(true). Returns a Promise<Blob>.
export async function buildFigurePdf(figureJSON) {
    const pageWidth = figureJSON.paper_width;
    const pageHeight = figureJSON.paper_height;
    const doc = new jsPDF({
        orientation: pageWidth > pageHeight ? "landscape" : "portrait",
        unit: "pt",
        format: [pageWidth, pageHeight],
    });

    // First page only (narrower first-pass scope): panels with x,y within page bounds
    const panels = (figureJSON.panels || []).filter(
        (p) => p.x < pageWidth && p.y < pageHeight && p.x + p.width > 0 && p.y + p.height > 0
    );

    for (const panel of panels) {
        await addPanelToPdf(doc, panel);
    }

    return doc.output("blob");
}
