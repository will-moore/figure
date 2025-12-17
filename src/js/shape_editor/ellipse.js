/*
// Copyright (C) 2015-2023 University of Dundee & Open Microscopy Environment.
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following
// conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
// disclaimer in the documentation // and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived
// from this software without specific prior written permission.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING,
// BUT NOT LIMITED TO,
// THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS
// BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE // GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT // LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
// IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

import Raphael from "raphael";

var Ellipse = function Ellipse(options) {
  var self = this;
  this.manager = options.manager;
  this.paper = options.paper;

  if (options.id) {
    this._id = options.id;
  } else {
    this._id = this.manager.getRandomId();
  }
  this._x = options.x;
  this._y = options.y;
  this._radiusX = options.radiusX;
  this._radiusY = options.radiusY;
  this._rotation = options.rotation || 0;

  // We handle transform matrix by creating this.Matrix
  // This is used as a one-off transform of the handles positions
  // when they are created. This then updates the _x, _y, _radiusX, _radiusY & rotation
  // of the ellipse itself (see below)
  if (options.transform && options.transform.startsWith("matrix")) {
    var tt = options.transform
      .replace("matrix(", "")
      .replace(")", "")
      .split(" ");
    var a1 = parseFloat(tt[0]);
    var a2 = parseFloat(tt[1]);
    var b1 = parseFloat(tt[2]);
    var b2 = parseFloat(tt[3]);
    var c1 = parseFloat(tt[4]);
    var c2 = parseFloat(tt[5]);
    this.Matrix = Raphael.matrix(a1, a2, b1, b2, c1, c2);
  }

  if (this._radiusX === 0 || this._radiusY === 0) {
    this._yxRatio = 0.5;
  } else {
    this._yxRatio = this._radiusY / this._radiusX;
  }

  this._strokeColor = options.strokeColor;
  if(options.fillColor){
    this._fillColor = options.fillColor;
  }else{
      this._fillColor = "#ffffff";
  }
  if(options.fillOpacity){
      this._fillOpacity = options.fillOpacity;
  }else{
      this._fillOpacity = 0;
  }
  this._strokeWidth = options.strokeWidth || 2;
  this._selected = false;
  this._zoomFraction = 1;
  if (options.zoom) {
    this._zoomFraction = options.zoom / 100;
  }
  if (options.area) {
    this._area = options.area;
  } else {
    this._area = this._radiusX * this._radiusY * Math.PI;
  }
  this.handle_wh = 6;

  this.element = this.paper.ellipse();
  this.element.attr({ "fill-opacity": this._fillOpacity, fill: this._fillColor, cursor: "pointer" });

  // Drag handling of ellipse
  if (this.manager.canEdit) {
    this.element.drag(
      function (dx, dy) {
        // DRAG, update location and redraw
        dx = dx / self._zoomFraction;
        dy = dy / self._zoomFraction;

        var offsetX = dx - this.prevX;
        var offsetY = dy - this.prevY;
        this.prevX = dx;
        this.prevY = dy;

        // Manager handles move and redraw
        self.manager.moveSelectedShapes(offsetX, offsetY, true);
        return false;
      },
      function () {
        // START drag: note the start location
        self._handleMousedown();
        this.prevX = 0;
        this.prevY = 0;
        return false;
      },
      function () {
        // STOP
        // notify changed if moved
        if (this.prevX !== 0 || this.prevY !== 0) {
          self.manager.notifySelectedShapesChanged();
        }
        return false;
      }
    );
  }

  // create handles, applying this.Matrix if set
  this.createHandles();
  // update x, y, radiusX, radiusY & rotation
  // If we have Matrix, recalculate width/height ratio based on all handles
  var resizeWidth = !!this.Matrix;
  this.updateShapeFromHandles(resizeWidth);
  // and draw the Ellipse
  this.drawShape();
};

Ellipse.prototype.toJson = function toJson() {
  var rv = {
    type: "Ellipse",
    x: this._x,
    y: this._y,
    radiusX: this._radiusX,
    radiusY: this._radiusY,
    area: this._radiusX * this._radiusY * Math.PI,
    rotation: this._rotation,
    strokeWidth: this._strokeWidth,
    strokeColor: this._strokeColor,
    fillColor: this._fillColor,
    fillOpacity: this._fillOpacity
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

Ellipse.prototype.compareCoords = function compareCoords(json) {
  var selfJson = this.toJson(),
    match = true;
  if (json.type !== selfJson.type) {
    return false;
  }
  ["x", "y", "radiusX", "radiusY", "rotation"].forEach(function (c) {
    if (Math.round(json[c]) !== Math.round(selfJson[c])) {
      match = false;
    }
  });
  return match;
};

// Useful for pasting json with an offset
Ellipse.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x = json.x + dx;
  json.y = json.y + dy;
  return json;
};

// Shift this shape by dx and dy
Ellipse.prototype.offsetShape = function offsetShape(dx, dy) {
  this._x = this._x + dx;
  this._y = this._y + dy;
  this.drawShape();
};

// handle start of drag by selecting this shape
// if not already selected
Ellipse.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Ellipse.prototype.setColor = function setColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Ellipse.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

Ellipse.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Ellipse.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  this._strokeWidth = strokeWidth;
  this.drawShape();
};

Ellipse.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Ellipse.prototype.setFillColor = function setFillColor(fillColor) {
  this._fillColor = fillColor;
  this.drawShape();
};

Ellipse.prototype.getFillColor = function getFillColor() {
  return this._fillColor;
};

Ellipse.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  this._fillOpacity = fillOpacity;
  this.drawShape();
};

Ellipse.prototype.getFillOpacity = function getFillOpacity() {
  return this._fillOpacity;
};

Ellipse.prototype.destroy = function destroy() {
  this.element.remove();
  this.handles.remove();
};

Ellipse.prototype.intersectRegion = function intersectRegion(region) {
  var path = this.manager.regionToPath(region, this._zoomFraction * 100);
  var f = this._zoomFraction,
    x = parseInt(this._x * f, 10),
    y = parseInt(this._y * f, 10);

  if (Raphael.isPointInsidePath(path, x, y)) {
    return true;
  }
  var path2 = this.getPath(),
    i = Raphael.pathIntersection(path, path2);
  return i.length > 0;
};

Ellipse.prototype.getPath = function getPath() {
  // Adapted from https://github.com/poilu/raphael-boolean
  var a = this.element.attrs,
    radiusX = a.radiusX,
    radiusY = a.radiusY,
    cornerPoints = [
      [a.x - radiusX, a.y - radiusY],
      [a.x + radiusX, a.y - radiusY],
      [a.x + radiusX, a.y + radiusY],
      [a.x - radiusX, a.y + radiusY],
    ],
    path = [];
  var radiusShift = [
    [
      [0, 1],
      [1, 0],
    ],
    [
      [-1, 0],
      [0, 1],
    ],
    [
      [0, -1],
      [-1, 0],
    ],
    [
      [1, 0],
      [0, -1],
    ],
  ];

  //iterate all corners
  for (var i = 0; i <= 3; i++) {
    //insert starting point
    if (i === 0) {
      path.push(["M", cornerPoints[0][0], cornerPoints[0][1] + radiusY]);
    }

    //insert "curveto" (radius factor .446 is taken from Inkscape)
    var c1 = [
      cornerPoints[i][0] + radiusShift[i][0][0] * radiusX * 0.446,
      cornerPoints[i][1] + radiusShift[i][0][1] * radiusY * 0.446,
    ];
    var c2 = [
      cornerPoints[i][0] + radiusShift[i][1][0] * radiusX * 0.446,
      cornerPoints[i][1] + radiusShift[i][1][1] * radiusY * 0.446,
    ];
    var p2 = [
      cornerPoints[i][0] + radiusShift[i][1][0] * radiusX,
      cornerPoints[i][1] + radiusShift[i][1][1] * radiusY,
    ];
    path.push(["C", c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]]);
  }
  path.push(["Z"]);
  path = path.join(",").replace(/,?([achlmqrstvxz]),?/gi, "$1");

  if (this._rotation !== 0) {
    path = Raphael.transformPath(path, "r" + this._rotation);
  }
  return path;
};

Ellipse.prototype.isSelected = function isSelected() {
  return this._selected;
};

Ellipse.prototype.setZoom = function setZoom(zoom) {
  this._zoomFraction = zoom / 100;
  this.drawShape();
};

Ellipse.prototype.updateHandle = function updateHandle(
  handleId,
  x,
  y,
  shiftKey
) {
  // Refresh the handle coordinates, then update the specified handle
  // using MODEL coordinates
  this._handleIds = this.getHandleCoords();
  var h = this._handleIds[handleId];
  h.x = x;
  h.y = y;
  var resizeWidth = handleId === "left" || handleId === "right";
  this.updateShapeFromHandles(resizeWidth, shiftKey);
};

Ellipse.prototype.updateShapeFromHandles = function updateShapeFromHandles(
  resizeWidth,
  shiftKey
) {
  var hh = this._handleIds,
    lengthX = hh.end.x - hh.start.x,
    lengthY = hh.end.y - hh.start.y,
    widthX = hh.left.x - hh.right.x,
    widthY = hh.left.y - hh.right.y,
    rot;
  // Use the 'start' and 'end' handles to get rotation and length
  if (lengthX === 0) {
    this._rotation = 90;
  } else if (lengthX > 0) {
    rot = Math.atan(lengthY / lengthX);
    this._rotation = Raphael.deg(rot);
  } else if (lengthX < 0) {
    rot = Math.atan(lengthY / lengthX);
    this._rotation = 180 + Raphael.deg(rot);
  }

  // centre is half-way between 'start' and 'end' handles
  this._x = (hh.start.x + hh.end.x) / 2;
  this._y = (hh.start.y + hh.end.y) / 2;
  // Radius-x is half of distance between handles
  this._radiusX = Math.sqrt(lengthX * lengthX + lengthY * lengthY) / 2;
  // Radius-y may depend on handles OR on x/y ratio
  if (resizeWidth) {
    this._radiusY = Math.sqrt(widthX * widthX + widthY * widthY) / 2;
    this._yxRatio = this._radiusY / this._radiusX;
  } else {
    if (shiftKey) {
      this._yxRatio = 1;
    }
    this._radiusY = this._yxRatio * this._radiusX;
  }
  this._area = this._radiusX * this._radiusY * Math.PI;

  this.drawShape();
};

Ellipse.prototype.drawShape = function drawShape() {
  var strokeColor = this._strokeColor,
    strokeW = this._strokeWidth,
    fillColor = this._fillColor,
    fillOpacity = this._fillOpacity;

  var f = this._zoomFraction,
    x = this._x * f,
    y = this._y * f,
    radiusX = this._radiusX * f,
    radiusY = this._radiusY * f;

  this.element.attr({
    cx: x,
    cy: y,
    rx: radiusX,
    ry: radiusY,
    stroke: strokeColor,
    "stroke-width": strokeW * this.manager.getShapeScalingFraction(),
    fill: fillColor,
    'fill-opacity': fillOpacity
  });
  this.element.transform("r" + this._rotation);

  if (this.isSelected()) {
    this.handles.show().toFront();
  } else {
    this.handles.hide();
  }

  // handles have been updated (model coords)
  this._handleIds = this.getHandleCoords();
  var hnd, h_id, hx, hy;
  for (var h = 0, l = this.handles.length; h < l; h++) {
    hnd = this.handles[h];
    h_id = hnd.h_id;
    hx = this._handleIds[h_id].x * this._zoomFraction;
    hy = this._handleIds[h_id].y * this._zoomFraction;
    hnd.attr({ x: hx - this.handle_wh / 2, y: hy - this.handle_wh / 2 });
  }
};

Ellipse.prototype.setSelected = function setSelected(selected) {
  this._selected = !!selected;
  this.drawShape();
};

Ellipse.prototype.createHandles = function createHandles() {
  // ---- Create Handles -----

  // NB: handleIds are used to calculate ellipse coords
  // so handledIds are scaled to MODEL coords, not zoomed.
  this._handleIds = this.getHandleCoords();

  var self = this,
    // map of centre-points for each handle
    handleAttrs = {
      stroke: "#4b80f9",
      fill: "#fff",
      cursor: "move",
      "fill-opacity": 1.0,
    };

  // draw handles
  self.handles = this.paper.set();
  var _handle_drag = function () {
    return function (dx, dy, mouseX, mouseY, event) {
      dx = dx / self._zoomFraction;
      dy = dy / self._zoomFraction;
      // on DRAG...
      var absX = dx + this.ox,
        absY = dy + this.oy;
      self.updateHandle(this.h_id, absX, absY, event.shiftKey);
      return false;
    };
  };
  var _handle_drag_start = function () {
    return function () {
      // START drag: simply note the location we started
      // we scale by zoom to get the 'model' coordinates
      this.ox = (this.attr("x") + this.attr("width") / 2) / self._zoomFraction;
      this.oy = (this.attr("y") + this.attr("height") / 2) / self._zoomFraction;
      return false;
    };
  };
  var _handle_drag_end = function () {
    return function () {
      // simply notify manager that shape has changed
      self.manager.notifyShapesChanged([self]);
      return false;
    };
  };

  var hsize = this.handle_wh,
    hx,
    hy,
    handle;
  for (var key in this._handleIds) {
    hx = this._handleIds[key].x;
    hy = this._handleIds[key].y;
    // If we have a transformation matrix, apply it...
    if (this.Matrix) {
      var matrixStr = this.Matrix.toTransformString();
      // Matrix that only contains rotation and translation
      // E.g. t111.894472287,-140.195845758r32.881,0,0  Will be handled correctly:
      // Resulting handles position and x,y radii will be calculated
      // so we don't need to apply transform to ellipse itself
      // BUT, if we have other transforms such as skew, we can't do this.
      // Best to just show warning if Raphael can't resolve matrix to simpler transforms:
      // E.g. m2.39,-0.6,2.1,0.7,-1006,153
      if (matrixStr.indexOf("m") > -1) {
        console.log(
          "Matrix only supports rotation & translation. " +
            matrixStr +
            " may contain skew for shape: ",
          this.toJson()
        );
      }
      var mx = this.Matrix.x(hx, hy);
      var my = this.Matrix.y(hx, hy);
      hx = mx;
      hy = my;
      // update the source coordinates
      this._handleIds[key].x = hx;
      this._handleIds[key].y = hy;
    }
    handle = this.paper.rect(hx - hsize / 2, hy - hsize / 2, hsize, hsize);
    handle.attr({ cursor: "move" });
    handle.h_id = key;
    // handle.line = self;

    if (this.manager.canEdit) {
      handle.drag(_handle_drag(), _handle_drag_start(), _handle_drag_end());
    }
    self.handles.push(handle);
  }

  self.handles.attr(handleAttrs).hide(); // show on selection
};

Ellipse.prototype.getHandleCoords = function getHandleCoords() {
  // Returns MODEL coordinates (not zoom coordinates)
  var rot = Raphael.rad(this._rotation),
    x = this._x,
    y = this._y,
    radiusX = this._radiusX,
    radiusY = this._radiusY,
    startX = x - Math.cos(rot) * radiusX,
    startY = y - Math.sin(rot) * radiusX,
    endX = x + Math.cos(rot) * radiusX,
    endY = y + Math.sin(rot) * radiusX,
    leftX = x + Math.sin(rot) * radiusY,
    leftY = y - Math.cos(rot) * radiusY,
    rightX = x - Math.sin(rot) * radiusY,
    rightY = y + Math.cos(rot) * radiusY;

  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    left: { x: leftX, y: leftY },
    right: { x: rightX, y: rightY },
  };
};

// Class for creating Ellipse.
var CreateEllipse = function CreateEllipse(options) {
  this.paper = options.paper;
  this.manager = options.manager;
};

CreateEllipse.prototype.startDrag = function startDrag(startX, startY) {
  var strokeColor = this.manager.getStrokeColor(),
    strokeWidth = this.manager.getStrokeWidth(),
    fillColor = this.manager.getFillColor(),
    fillOpacity = this.manager.getFillOpacity(),
    zoom = this.manager.getZoom();

  this.ellipse = new Ellipse({
    manager: this.manager,
    paper: this.paper,
    x: startX,
    y: startY,
    radiusX: 0,
    radiusY: 0,
    area: 0,
    rotation: 0,
    strokeWidth: strokeWidth,
    zoom: zoom,
    strokeColor: strokeColor,
    fillColor: fillColor,
    fillOpacity: fillOpacity
  });
};

CreateEllipse.prototype.drag = function drag(dragX, dragY, shiftKey) {
  this.ellipse.updateHandle("end", dragX, dragY, shiftKey);
};

CreateEllipse.prototype.stopDrag = function stopDrag() {
  // Don't create ellipse of zero size (click, without drag)
  var coords = this.ellipse.toJson();
  if (coords.radiusX < 2) {
    this.ellipse.destroy();
    delete this.ellipse;
    return;
  }
  // on the 'new:shape' trigger, this shape will already be selected
  this.ellipse.setSelected(true);
  this.manager.addShape(this.ellipse);
};

export { CreateEllipse, Ellipse };
