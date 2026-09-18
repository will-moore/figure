// Client-side port of the relevant parts of ome_figure/export_script.py
// Covers multi-page figure grids, panel images, labels, ROIs/shapes, scalebar,
// colorbar, and the trailing info/legend page.

import { jsPDF } from "jspdf";
import { marked } from "marked";

const DEFAULT_OFFSET = 0;
const POINT_RADIUS = 5;

// Same as unit_symbols in export_script.py, used for scalebar unit conversion
const UNIT_SYMBOLS = {
    ANGSTROM: { symbol: "\u00c5", microns: 0.0001 },
    CENTIMETER: { symbol: "cm", microns: 10000.0 },
    KILOMETER: { symbol: "km", microns: 1000000000.0 },
    METER: { symbol: "m", microns: 1000000.0 },
    MICROMETER: { symbol: "\u00b5m", microns: 1 },
    MILLIMETER: { symbol: "mm", microns: 1000.0 },
    NANOMETER: { symbol: "nm", microns: 0.001 },
};

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
    drawShapes(doc, panel);
    drawScalebar(doc, panel);
    for (const draw of computeLabelDraws(panel)) {
        drawLabel(doc, draw);
    }
    drawColorbar(doc, panel);
}

// -------------------- Scalebar drawing --------------------
// Port of FigureExport.draw_scalebar()/draw_scalebar_line() in export_script.py

function drawScalebarLine(doc, x1, y1, x2, y2, width, [r, g, b]) {
    const ctx = doc.context2d;
    ctx.save();
    ctx.strokeStyle = rgbaCss([r, g, b, 1]);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
}

function drawPageText(doc, text, x, y, fontSize, [r, g, b], align) {
    const ctx = doc.context2d;
    ctx.save();
    ctx.font = `${fontSize}pt helvetica`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgbaCss([r, g, b, 1]);
    ctx.fillText(markdownToPlainText(text), x, y);
    ctx.restore();
}

function drawScalebar(doc, panel) {
    const sb = panel.scalebar;
    if (!sb || !sb.show) return;
    if (!(panel.pixel_size_x > 0)) return;

    const x = panel.x, y = panel.y, width = panel.width, height = panel.height;
    const spacer = sb.margin !== undefined ? sb.margin : 10;
    const rgb = getRgb(sb.color);
    const position = sb.position || "bottomright";
    const barHeight = sb.height !== undefined ? sb.height : 3;
    const halfHeight = Math.floor(barHeight / 2);

    let lx, ly, align = "left";
    if (position === "topleft") { lx = x + spacer; ly = y + spacer + halfHeight; }
    else if (position === "topright") { lx = x + width - spacer; ly = y + spacer + halfHeight; align = "right"; }
    else if (position === "bottomleft") { lx = x + spacer; ly = y + height - spacer - halfHeight; }
    else { lx = x + width - spacer; ly = y + height - spacer - halfHeight; align = "right"; } // bottomright

    let pixelSizeX = panel.pixel_size_x;
    if (panel.zoom_level_scale) pixelSizeX = pixelSizeX / panel.zoom_level_scale;

    const crop = getCropRegion(panel);
    const pixelsLength = sb.length / pixelSizeX;
    const scaleToCanvas = panel.width / crop.width;
    let canvasLength = pixelsLength * scaleToCanvas;

    const pixelUnit = panel.pixel_size_x_unit;
    const scalebarUnit = sb.units || pixelUnit;
    if (UNIT_SYMBOLS[pixelUnit] && UNIT_SYMBOLS[scalebarUnit]) {
        const convertFactor = UNIT_SYMBOLS[scalebarUnit].microns / UNIT_SYMBOLS[pixelUnit].microns;
        canvasLength = convertFactor * canvasLength;
    }

    const lxEnd = align === "left" ? lx + canvasLength : lx - canvasLength;

    drawScalebarLine(doc, lx, ly, lxEnd, ly, barHeight, rgb);

    if (sb.show_label) {
        let symbol = "\u00B5m";
        if (panel.pixel_size_x_symbol) symbol = panel.pixel_size_x_symbol;
        if (scalebarUnit && UNIT_SYMBOLS[scalebarUnit]) symbol = UNIT_SYMBOLS[scalebarUnit].symbol;
        const label = `${sb.length} ${symbol}`;

        let fontSize = 10;
        const parsedFontSize = parseInt(sb.font_size, 10);
        if (!isNaN(parsedFontSize)) fontSize = parsedFontSize;

        let textY = position.includes("bottom") ? ly - fontSize - 5 : ly + 5;
        const sign = position === "bottomleft" || position === "bottomright" ? -1 : 1;

        drawPageText(doc, label, (lx + lxEnd) / 2, textY + sign * halfHeight, fontSize, rgb, "center");
    }
}

// -------------------- Colorbar drawing --------------------
// Port of FigureExport.get_color_ramp()/draw_colorbar()/draw_colorbar_ticks() in export_script.py.
// The ramp gradient is rendered directly with a canvas linear-gradient instead
// of building a pixel array, since it's mathematically the same black<->channel-color ramp.

function buildColorRampDataUrl(channelColor, reverseIntensity, isVertical) {
    let hex = channelColor || "";
    if (hex.endsWith(".lut")) hex = "FFFFFF"; // TODO: app should provide the real LUT ramp
    const rgb = hex.length === 6 ? getRgb("#" + hex) : [0, 0, 0];
    const full = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const black = "rgb(0,0,0)";

    const canvas = document.createElement("canvas");
    canvas.width = isVertical ? 2 : 256;
    canvas.height = isVertical ? 256 : 2;
    const ctx = canvas.getContext("2d");

    const grad = isVertical
        ? ctx.createLinearGradient(0, 0, 0, canvas.height)
        : ctx.createLinearGradient(0, 0, canvas.width, 0);
    // top->bottom (vertical) or left->right (horizontal), flipped by reverseIntensity
    const [start, end] = isVertical
        ? reverseIntensity ? [black, full] : [full, black]
        : reverseIntensity ? [full, black] : [black, full];
    grad.addColorStop(0, start);
    grad.addColorStop(1, end);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawColorbarTicks(doc, colorbar, rampD, labels, labelsX, labelsY) {
    const fontSize = parseInt(colorbar.font_size, 10);
    const markLen = colorbar.mark_len;
    const tickMargin = colorbar.tick_margin;
    const pos = colorbar.position;
    const tickThickness = colorbar.tick_thickness !== undefined ? colorbar.tick_thickness : 1;
    const rgb = getRgb("#" + colorbar.axis_color);
    const align = rampD.align;

    labels.forEach((label, i) => {
        let posX = labelsX[i], posY = labelsY[i];
        let shift = 0;
        if (i === 0) shift = -tickThickness / 2;
        else if (i === labels.length - 1) shift = tickThickness / 2;

        let x1, y1, x2, y2, xText, yText;
        if (pos === "left" || pos === "right") {
            posY -= shift;
            x1 = posX; y1 = posY; y2 = posY;
            yText = posY;
            if (pos === "left") { x2 = posX - markLen; xText = posX - markLen - tickMargin; }
            else { x2 = posX + markLen; xText = posX + markLen + tickMargin; }
        } else {
            posX -= shift;
            x1 = posX; x2 = posX; y1 = posY;
            xText = posX;
            if (pos === "top") { y2 = posY - markLen; yText = posY - fontSize - markLen - tickMargin; }
            else { y2 = posY + markLen; yText = posY + markLen + tickMargin; }
        }

        if (markLen > 0) drawScalebarLine(doc, x1, y1, x2, y2, tickThickness, rgb);
        drawPageText(doc, label, xText, yText, fontSize, rgb, align);
    });

    let x1, y1, x2, y2;
    if (pos === "top" || pos === "bottom") {
        x1 = rampD.x; x2 = rampD.x + rampD.width;
        y1 = pos === "bottom" ? rampD.y + rampD.height : rampD.y;
        y2 = y1;
    } else {
        x1 = pos === "right" ? rampD.x + rampD.width : rampD.x;
        y1 = rampD.y; y2 = rampD.y + rampD.height;
        x2 = x1;
    }
    drawScalebarLine(doc, x1, y1, x2, y2, tickThickness, rgb);
}

function drawColorbar(doc, panel) {
    const colorbar = panel.colorbar;
    if (!colorbar || !colorbar.show) return;

    const channel = (panel.channels || []).find((c) => c.active);
    if (!channel) return;

    const gap = colorbar.gap;
    const thickness = colorbar.thickness;
    const position = colorbar.position;
    const numTicks = colorbar.num_ticks;
    const { start, end } = channel.window;

    const decimals = Math.max(0, Math.ceil(-Math.log10((end - start) / numTicks)));
    const posRatio = Array.from({ length: numTicks }, (_, i) => i / (numTicks - 1 || 1));
    let labels = posRatio.map((r) => (start + (end - start) * r).toFixed(decimals));

    const rampD = {};
    let labelsX, labelsY;
    const isVertical = position === "left" || position === "right";

    if (isVertical) {
        rampD.width = thickness;
        rampD.height = panel.height;
        rampD.y = panel.y;
        rampD.x = panel.x - (gap + thickness);
        rampD.align = "right";
        let rampLabelX = rampD.x;
        labelsY = posRatio.map((r) => rampD.y + panel.height * r);
        labels = [...labels].reverse();
        if (position === "right") {
            rampD.x = panel.x + panel.width + gap;
            rampD.align = "left";
            rampLabelX = rampD.x + rampD.width;
        }
        labelsX = labels.map(() => rampLabelX);
    } else {
        rampD.width = panel.width;
        rampD.height = thickness;
        rampD.x = panel.x;
        rampD.y = panel.y - (gap + thickness);
        rampD.align = "center";
        labelsX = posRatio.map((r) => rampD.x + panel.width * r);
        let rampLabelY = rampD.y;
        if (position === "bottom") {
            rampD.y = panel.y + panel.height + gap;
            rampLabelY = rampD.y + rampD.height;
        }
        labelsY = labels.map(() => rampLabelY);
    }

    const dataUrl = buildColorRampDataUrl(channel.color, channel.reverseIntensity, isVertical);
    doc.addImage(dataUrl, "PNG", rampD.x, rampD.y, rampD.width, rampD.height);

    drawColorbarTicks(doc, colorbar, rampD, labels, labelsX, labelsY);
}

// -------------------- ROI / shape drawing --------------------
// Port of ShapeExport / ShapeToPdfExport in export_script.py. Uses jsPDF's
// canvas-compatible context2d API, whose coordinate system (top-left origin,
// y increasing downward) already matches panel.x/y, so no y-axis flip is
// needed here (unlike the reportlab version, which draws bottom-up).

function getRgb(color) {
    color = color || "#000000";
    if (!color.startsWith("#") && color.length === 6) {
        color = "#" + color;
    }
    return [
        parseInt(color.slice(1, 3), 16) || 0,
        parseInt(color.slice(3, 5), 16) || 0,
        parseInt(color.slice(5, 7), 16) || 0,
    ];
}

function getRgbaInt(color) {
    color = color || "#000000";
    const hex = (s, fallback) => {
        const v = parseInt(s, 16);
        return isNaN(v) ? fallback : v;
    };
    return [
        hex(color.slice(1, 3), 0),
        hex(color.slice(3, 5), 0),
        hex(color.slice(5, 7), 0),
        hex(color.slice(7, 9), 255),
    ];
}

function getRgba(color) {
    const [r, g, b, a] = getRgbaInt(color);
    return [r, g, b, a / 255];
}

function rgbaCss([r, g, b, a]) {
    return `rgba(${r},${g},${b},${a === undefined ? 1 : a})`;
}

function applyTransform(tf, [x, y]) {
    if (!tf) return [x, y];
    return [x * tf.A00 + y * tf.A01 + tf.A02, x * tf.A10 + y * tf.A11 + tf.A12];
}

function applyRotation([x, y], [cx, cy], rotationDeg) {
    const dx = cx - x, dy = cy - y;
    const h = Math.sqrt(dx * dx + dy * dy);
    const angle1 = Math.atan2(dx, dy);
    const angle2 = angle1 - (rotationDeg * Math.PI) / 180;
    const newo = Math.sin(angle2) * h;
    const newa = Math.cos(angle2) * h;
    return [cx - newo, cy - newa];
}

// Same geometry as ShapeToPdfExport.panel_to_page_coords() in export_script.py
function panelToPageCoords(panel, crop, scale, shapeX, shapeY) {
    let x = shapeX, y = shapeY;
    const hFlip = panel.horizontal_flip;
    const vFlip = panel.vertical_flip;
    if (hFlip) x = crop.width - x + 2 * crop.x;
    if (vFlip) y = crop.height - y + 2 * crop.y;

    let rotation = panel.rotation || 0;
    if (vFlip !== hFlip) rotation = -rotation;
    if (rotation !== 0) {
        const cx = crop.x + crop.width / 2;
        const cy = crop.y + crop.height / 2;
        const dx = cx - x, dy = cy - y;
        const h = Math.sqrt(dx * dx + dy * dy);
        const angle1 = Math.atan2(dx, dy);
        const angle2 = angle1 - (rotation * Math.PI) / 180;
        x = cx - Math.sin(angle2) * h;
        y = cy - Math.cos(angle2) * h;
    }

    x = x - crop.x;
    y = y - crop.y;
    const inPanel = !(x < 0 || x > crop.width || y < 0 || y > crop.height);

    x = x * scale + panel.x;
    y = y * scale + panel.y;
    return { x, y, inPanel };
}

function boundsOf(points) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return {
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
}

function drawShapeLabel(ctx, shape, center) {
    const text = shape.text;
    if (!text || !center) return;
    const size = (shape.fontSize || 12) * (2 / 3);
    const [r, g, b, a] = getRgba(shape.strokeColor);
    ctx.save();
    ctx.font = `${size}pt helvetica`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgbaCss([r, g, b, 0.5 + a / 2]);
    ctx.fillText(text, center.cx, center.cy);
    ctx.restore();
}

function drawLineShape(ctx, panel, crop, scale, shape) {
    const start = panelToPageCoords(panel, crop, scale, shape.x1, shape.y1);
    const end = panelToPageCoords(panel, crop, scale, shape.x2, shape.y2);
    if (!start.inPanel && !end.inPanel) return;

    ctx.save();
    ctx.strokeStyle = rgbaCss([...getRgb(shape.strokeColor), 1]);
    ctx.lineWidth = parseFloat(shape.strokeWidth || 1);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();

    drawShapeLabel(ctx, shape, boundsOf([[start.x, start.y], [end.x, end.y]]));
}

function drawArrowShape(ctx, panel, crop, scale, shape) {
    const start = panelToPageCoords(panel, crop, scale, shape.x1, shape.y1);
    const end = panelToPageCoords(panel, crop, scale, shape.x2, shape.y2);
    if (!start.inPanel && !end.inPanel) return;

    const strokeWidth = parseFloat(shape.strokeWidth || 1);
    const headSize = strokeWidth * 4 + 5;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const wing1 = angle + Math.PI - 0.4;
    const wing2 = angle + Math.PI + 0.4;
    const notch = {
        x: end.x + Math.cos(angle + Math.PI) * headSize * 0.5,
        y: end.y + Math.sin(angle + Math.PI) * headSize * 0.5,
    };
    const wingPoint1 = { x: end.x + Math.cos(wing1) * headSize, y: end.y + Math.sin(wing1) * headSize };
    const wingPoint2 = { x: end.x + Math.cos(wing2) * headSize, y: end.y + Math.sin(wing2) * headSize };

    const [r, g, b] = getRgb(shape.strokeColor);
    ctx.save();
    ctx.strokeStyle = rgbaCss([r, g, b, 1]);
    ctx.fillStyle = rgbaCss([r, g, b, 1]);
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(notch.x, notch.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(wingPoint1.x, wingPoint1.y);
    ctx.lineTo(wingPoint2.x, wingPoint2.y);
    ctx.lineTo(end.x, end.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawShapeLabel(ctx, shape, boundsOf([[start.x, start.y], [end.x, end.y]]));
}

function drawPolygonShape(ctx, panel, crop, scale, shape, rawPoints, closed) {
    let inViewport = false;
    const pagePoints = rawPoints.map(([px, py]) => {
        const c = panelToPageCoords(panel, crop, scale, px, py);
        if (c.inPanel) inViewport = true;
        return [c.x, c.y];
    });
    if (!inViewport || pagePoints.length === 0) return;

    ctx.save();
    ctx.lineWidth = parseFloat(shape.strokeWidth || 1);
    ctx.strokeStyle = rgbaCss(getRgba(shape.strokeColor));

    let hasFill = false;
    if (shape.fillColor !== undefined) {
        const rgba = getRgba(shape.fillColor);
        if (shape.fillOpacity !== undefined) rgba[3] = parseFloat(shape.fillOpacity);
        ctx.fillStyle = rgbaCss(rgba);
        hasFill = true;
    }

    ctx.beginPath();
    ctx.moveTo(pagePoints[0][0], pagePoints[0][1]);
    for (const [x, y] of pagePoints.slice(1)) ctx.lineTo(x, y);
    if (closed) ctx.closePath();
    if (hasFill && closed) ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawShapeLabel(ctx, shape, boundsOf(pagePoints));
}

function rectangleToPoints(shape) {
    let points = [
        [shape.x, shape.y],
        [shape.x + shape.width, shape.y],
        [shape.x + shape.width, shape.y + shape.height],
        [shape.x, shape.y + shape.height],
    ];
    if (shape.rotation) {
        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        points = points.map((p) => applyRotation(p, [cx, cy], shape.rotation));
    }
    return points.map((p) => applyTransform(shape.transform, p));
}

function parsePointsString(pointsStr) {
    return pointsStr.split(" ").filter(Boolean).map((pair) => {
        const [x, y] = pair.split(",");
        return [parseFloat(x), parseFloat(y)];
    });
}

function drawEllipseShape(ctx, panel, crop, scale, shape) {
    const c = panelToPageCoords(panel, crop, scale, shape.x, shape.y);
    if (!c.inPanel) return;

    const rx = shape.radiusX * scale;
    const ry = shape.radiusY * scale;

    let rotation = shape.rotation || 0;
    const hFlip = panel.horizontal_flip;
    const vFlip = panel.vertical_flip;
    if (vFlip) rotation = -rotation;
    if (hFlip) rotation = 180 - rotation;
    rotation = vFlip !== hFlip ? (rotation - panel.rotation) * -1 : (rotation + panel.rotation) * -1;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.lineWidth = parseFloat(shape.strokeWidth || 1);
    ctx.strokeStyle = rgbaCss(getRgba(shape.strokeColor));

    ctx.beginPath();
    ctx.ellipse(0, 0, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
    if (shape.fillColor !== undefined) {
        const rgba = getRgba(shape.fillColor);
        if (shape.fillOpacity !== undefined) rgba[3] = parseFloat(shape.fillOpacity);
        ctx.fillStyle = rgbaCss(rgba);
        ctx.fill();
    }
    ctx.stroke();
    ctx.restore();

    drawShapeLabel(ctx, shape, { cx: c.x, cy: c.y });
}

function drawPointShape(ctx, panel, crop, scale, shape) {
    drawEllipseShape(ctx, panel, crop, scale, {
        ...shape,
        radiusX: POINT_RADIUS / scale,
        radiusY: POINT_RADIUS / scale,
    });
}

function drawTextShape(doc, ctx, panel, crop, scale, shape) {
    const text = shape.text || "";
    if (shape.showText === false || text === "") return;

    const fontSize = shape.fontSize || 12;
    const strokeColor = shape.strokeColor || "#FFFFFF";
    const fillColor = shape.fillColor || "#000000";
    const fillOpacity = parseFloat(shape.fillOpacity || 0);
    const anchor = shape.textAnchor || "start";
    const coords = panelToPageCoords(panel, crop, scale, shape.x, shape.y);
    const hFlip = panel.horizontal_flip;

    let align = "left";
    if (anchor === "middle") align = "center";
    else if ((anchor === "end" && !hFlip) || (anchor === "start" && hFlip)) align = "right";

    doc.setFont("helvetica");
    doc.setFontSize(fontSize);
    const textWidth = doc.getTextWidth(text);
    let x0 = 0;
    if (align === "center") x0 = textWidth / 2;
    else if (align === "right") x0 = textWidth;

    ctx.save();
    if (fillOpacity > 0) {
        const pad = 1;
        ctx.fillStyle = rgbaCss([...getRgb(fillColor), fillOpacity]);
        ctx.fillRect(
            coords.x - x0 - pad,
            coords.y - fontSize * 0.8 - pad,
            textWidth + pad * 2,
            fontSize * 1.1 + pad * 2
        );
    }
    ctx.font = `${fontSize}pt helvetica`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgbaCss([...getRgb(strokeColor), 1]);
    ctx.fillText(text, coords.x, coords.y);
    ctx.restore();
}

function drawShapes(doc, panel) {
    if (!panel.shapes || panel.shapes.length === 0) return;
    const crop = getCropRegion(panel);
    const scale = panel.width / crop.width;
    const ctx = doc.context2d;

    // Draw text shapes last, same ordering as ShapeExport in export_script.py
    const shapes = [...panel.shapes].sort((a, b) => {
        const aText = a.type.toLowerCase() === "text" ? 1 : 0;
        const bText = b.type.toLowerCase() === "text" ? 1 : 0;
        return aText - bText;
    });

    for (const shape of shapes) {
        const type = (shape.type || "").toLowerCase();
        if (type === "line") drawLineShape(ctx, panel, crop, scale, shape);
        else if (type === "arrow") drawArrowShape(ctx, panel, crop, scale, shape);
        else if (type === "rectangle") drawPolygonShape(ctx, panel, crop, scale, shape, rectangleToPoints(shape), true);
        else if (type === "polygon") drawPolygonShape(ctx, panel, crop, scale, shape, parsePointsString(shape.points), true);
        else if (type === "polyline") drawPolygonShape(ctx, panel, crop, scale, shape, parsePointsString(shape.points), false);
        else if (type === "ellipse") drawEllipseShape(ctx, panel, crop, scale, shape);
        else if (type === "point") drawPointShape(ctx, panel, crop, scale, shape);
        else if (type === "text") drawTextShape(doc, ctx, panel, crop, scale, shape);
    }
}

// Same check as FigureExport.panel_is_on_page() in export_script.py
function panelIsOnPage(panel, page, pageWidth, pageHeight) {
    const px = panel.x, px2 = px + panel.width;
    const py = panel.y, py2 = py + panel.height;
    const cx = page.x, cx2 = cx + pageWidth;
    const cy = page.y, cy2 = cy + pageHeight;
    return px < cx2 && cx < px2 && py < cy2 && cy < py2;
}

// Same as FigureExport.add_page_color() in export_script.py
function fillPageColor(doc, pageColor, pageWidth, pageHeight) {
    if (!pageColor || pageColor.toLowerCase() === "ffffff") return;
    const [r, g, b] = getRgb("#" + pageColor);
    const ctx = doc.context2d;
    ctx.save();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.restore();
}

// Builds a PDF (multi-page figure grids, panels + labels/ROIs/scalebar/colorbar,
// plus the trailing info/legend page) from the figureJSON produced by
// FigureModel.figure_toJSON(true). Returns a Promise<Blob>.
export async function buildFigurePdf(figureJSON) {
    const pageWidth = figureJSON.paper_width;
    const pageHeight = figureJSON.paper_height;
    const doc = new jsPDF({
        orientation: pageWidth > pageHeight ? "landscape" : "portrait",
        unit: "pt",
        format: [pageWidth, pageHeight],
    });

    const pageCount = parseInt(figureJSON.page_count, 10) || 1;
    const paperSpacing = figureJSON.paper_spacing !== undefined ? figureJSON.paper_spacing : 50;
    const pageColCount = parseInt(figureJSON.page_col_count, 10) || 1;
    const allPanels = figureJSON.panels || [];

    let col = 0, row = 0;
    for (let p = 0; p < pageCount; p++) {
        if (p > 0) doc.addPage([pageWidth, pageHeight]);

        // Page's offset within the grid of pages, in figure (panel) coordinates
        const page = {
            x: col * (pageWidth + paperSpacing),
            y: row * (pageHeight + paperSpacing),
        };

        fillPageColor(doc, figureJSON.page_color, pageWidth, pageHeight);

        const panelsOnPage = allPanels.filter((panel) => panelIsOnPage(panel, page, pageWidth, pageHeight));
        for (const panel of panelsOnPage) {
            // Shift into this page's local coordinates so existing draw code (which
            // only reads panel.x/panel.y) needs no further changes.
            const pagePanel = { ...panel, x: panel.x - page.x, y: panel.y - page.y };
            await addPanelToPdf(doc, pagePanel);
        }

        col += 1;
        if (col >= pageColCount) {
            col = 0;
            row += 1;
        }
    }

    await addInfoPage(doc, figureJSON, pageWidth, pageHeight);

    return doc.output("blob");
}

// -------------------- Info / legend page --------------------
// Port of FigureExport.add_info_page()/add_para_with_thumb()/get_thumbnail() in
// export_script.py. Appends a final page with the figure title, legend and a
// list of images used (with thumbnails + clickable links).

// Splits markdown into block-level paragraphs of plain text (links become "text (url)")
function markdownToParagraphs(text) {
    let html = marked.parse(text || "");
    html = html.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)");
    const div = document.createElement("div");
    div.innerHTML = html;
    const paragraphs = [];
    for (const child of div.children) {
        const t = (child.textContent || "").trim();
        if (t) paragraphs.push(t);
    }
    if (paragraphs.length === 0) {
        const t = (div.textContent || "").trim();
        if (t) paragraphs.push(t);
    }
    return paragraphs;
}

async function getThumbnailDataUrl(panel) {
    const img = await loadImage(panel.src);
    const w = img.width, h = img.height;
    const newW = w > h ? 96 : (w / h) * 96;
    const newH = w > h ? (h / w) * 96 : 96;
    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;
    canvas.getContext("2d").drawImage(img, 0, 0, newW, newH);
    return canvas.toDataURL("image/png");
}

const INFO_PAGE_STYLES = {
    h1: { fontSize: 18, bold: true },
    h3: { fontSize: 14, bold: true },
    normal: { fontSize: 10, bold: false },
};

// state.topY tracks the current cursor distance from the top of the page
function addPagedParagraph(doc, state, text, style) {
    doc.setFont("helvetica", style.bold ? "bold" : "normal");
    doc.setFontSize(style.fontSize);
    const lines = doc.splitTextToSize(text, state.pageWidth - state.margin * 2);
    const lineHeight = style.fontSize * 1.2;
    const parah = lines.length * lineHeight;

    if (state.topY + parah > state.pageHeight - state.margin) {
        doc.addPage([state.pageWidth, state.pageHeight]);
        state.topY = state.margin;
    }
    doc.setTextColor(0, 0, 0);
    doc.text(lines, state.margin, state.topY + style.fontSize);
    state.topY += parah + 10;
}

function addImageEntry(doc, state, panel, thumbDataUrl) {
    const imgw = 25, imgh = 25, spacer = 10;
    const style = INFO_PAGE_STYLES.normal;
    const lineHeight = style.fontSize * 1.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(style.fontSize);

    const textX = state.margin + imgw + spacer;
    const nameLines = doc.splitTextToSize(panel.name || "", state.pageWidth - state.margin * 2 - imgw - spacer);
    const parah = Math.max((nameLines.length + 1) * lineHeight, imgh);

    if (state.topY + parah > state.pageHeight - state.margin) {
        doc.addPage([state.pageWidth, state.pageHeight]);
        state.topY = state.margin;
    }
    doc.addImage(thumbDataUrl, "PNG", state.margin, state.topY, imgw, imgh);
    doc.setTextColor(0, 0, 0);
    doc.text(nameLines, textX, state.topY + style.fontSize);

    const url = String(panel.imageId);
    doc.setTextColor(0, 0, 255);
    doc.textWithLink(url, textX, state.topY + style.fontSize + nameLines.length * lineHeight, { url });
    doc.setTextColor(0, 0, 0);

    state.topY += parah + spacer;
}

async function addInfoPage(doc, figureJSON, pageWidth, pageHeight) {
    const margin = Math.min(pageWidth, pageHeight) / 9.0;
    doc.addPage([pageWidth, pageHeight]);
    const state = { pageWidth, pageHeight, margin, topY: margin };

    addPagedParagraph(doc, state, figureJSON.figureName || "Figure", INFO_PAGE_STYLES.h1);

    if (figureJSON.legend) {
        addPagedParagraph(doc, state, "Legend:", INFO_PAGE_STYLES.h3);
        for (const paragraph of markdownToParagraphs(figureJSON.legend)) {
            addPagedParagraph(doc, state, paragraph, INFO_PAGE_STYLES.normal);
        }
    }

    addPagedParagraph(doc, state, "Figure contains the following images:", INFO_PAGE_STYLES.h3);

    // Sort panels top-to-bottom, then left-to-right, same as add_info_page()
    const panels = [...(figureJSON.panels || [])].sort((a, b) => (a.y + a.x * 0.01) - (b.y + b.x * 0.01));
    const seenImageIds = new Set();
    const scalebarLengths = new Set();

    for (const panel of panels) {
        if (panel.scalebar && panel.scalebar.show) {
            const unitSymbol = UNIT_SYMBOLS[panel.scalebar.units]
                ? UNIT_SYMBOLS[panel.scalebar.units].symbol
                : "\u00B5m";
            scalebarLengths.add(`${panel.scalebar.length} ${unitSymbol}`);
        }
        if (seenImageIds.has(panel.imageId)) continue;
        seenImageIds.add(panel.imageId);
        const thumbDataUrl = await getThumbnailDataUrl(panel);
        addImageEntry(doc, state, panel, thumbDataUrl);
    }

    if (scalebarLengths.size > 0) {
        addPagedParagraph(doc, state, "Scalebars:", INFO_PAGE_STYLES.h3);
        addPagedParagraph(doc, state, `Scalebar Lengths: ${[...scalebarLengths].join(", ")}`, INFO_PAGE_STYLES.normal);
    }
}
