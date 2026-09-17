// Client-side port of the relevant parts of ome_figure/export_script.py
// Scope (first pass): single page, panel images + panel labels + ROI/shapes.
// No scalebar or colorbar export yet.

import { jsPDF } from "jspdf";
import { marked } from "marked";

const DEFAULT_OFFSET = 0;
const POINT_RADIUS = 5;

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
    for (const draw of computeLabelDraws(panel)) {
        drawLabel(doc, draw);
    }
}

// -------------------- ROI / shape drawing --------------------
// Port of ShapeExport / ShapeToPdfExport in export_script.py. Uses jsPDF's
// canvas-compatible context2d API, whose coordinate system (top-left origin,
// y increasing downward) already matches panel.x/y, so no y-axis flip is
// needed here (unlike the reportlab version, which draws bottom-up).

function getRgb(color) {
    color = color || "#000000";
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
