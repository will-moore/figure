/*
// Copyright (C) 2015-2022 University of Dundee & Open Microscopy Environment.
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
import {Text} from "./text";


var Line = function Line(options) {
  var self = this;
  this.manager = options.manager;
  this.paper = options.paper;

  if (options.id) {
    this._id = options.id;
  } else {
    this._id = this.manager.getRandomId();
  }
  this._x1 = options.x1;
  this._y1 = options.y1;
  this._x2 = options.x2;
  this._y2 = options.y2;
  this._strokeColor = options.strokeColor;
  this._strokeWidth = options.strokeWidth || 2;
  this._area =
    Math.pow(
      Math.pow(this._x2 - this._x1, 2) + Math.pow(this._y2 - this._y1, 2),
      0.5
    ) * this._strokeWidth;
  this.handle_wh = 6;
  this._selected = false;
  this._zoomFraction = 1;
  if (options.zoom) {
    this._zoomFraction = options.zoom / 100;
  }

  this._textId = options.textId || -1;
  this._textShape = this.manager.getShape(this._textId)

  this.element = this.paper.path();
  this.element.attr({ cursor: "pointer" });

  // Drag handling of line
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
        // START drag: note the location of all points
        self._handleMousedown();
        this.prevX = 0;
        this.prevY = 0;
        return false;
      },
      function () {
        // STOP
        // notify manager if line has moved
        if (this.prevX !== 0 || this.prevY !== 0) {
          self.manager.notifySelectedShapesChanged();
        }
        return false;
      }
    );
  }

  this.createHandles();

  this.drawShape();
};

Line.prototype.toJson = function toJson() {
  var rv = {
    type: "Line",
    x1: this._x1,
    x2: this._x2,
    y1: this._y1,
    y2: this._y2,
    area:
      Math.pow(
        Math.pow(this._x2 - this._x1, 2) + Math.pow(this._y2 - this._y1, 2),
        0.5
      ) * this._strokeWidth,
    strokeWidth: this._strokeWidth,
    strokeColor: this._strokeColor,
    textId: this._textId,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

Line.prototype.compareCoords = function compareCoords(json) {
  var selfJson = this.toJson(),
    match = true;
  if (json.type !== selfJson.type) {
    return false;
  }
  ["x1", "y1", "x2", "y2"].forEach(function (c) {
    if (json[c] !== selfJson[c]) {
      match = false;
    }
  });
  return match;
};

// Useful for pasting json with an offset
Line.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x1 = json.x1 + dx;
  json.y1 = json.y1 + dy;
  json.x2 = json.x2 + dx;
  json.y2 = json.y2 + dy;
  return json;
};

// Shift this shape by dx and dy
Line.prototype.offsetShape = function offsetShape(dx, dy) {
  this._x1 = this._x1 + dx;
  this._y1 = this._y1 + dy;
  this._x2 = this._x2 + dx;
  this._y2 = this._y2 + dy;
  this.drawShape();
};

// handle start of drag by selecting this shape
// if not already selected
Line.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Line.prototype.setCoords = function setCoords(coords) {
  this._x1 = coords.x1 || this._x1;
  this._y1 = coords.y1 || this._y1;
  this._x2 = coords.x2 || this._x2;
  this._y2 = coords.y2 || this._y2;
  this.drawShape();
};

Line.prototype.getCoords = function getCoords() {
  return { x1: this._x1, y1: this._y1, x2: this._x2, y2: this._y2 };
};

Line.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Line.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

Line.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  this._strokeWidth = strokeWidth;
  this._area =
    Math.abs((this._x2 - this._x1) * (this._y2 - this._y1)) * this._strokeWidth;
  this.drawShape();
};

Line.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Line.prototype.getFillColor = function getFillColor() {
  return this._strokeColor;
};

Line.prototype.setFillColor = function setFillColor(fillColor) {
  return;
};

Line.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  return;
};

Line.prototype.getFillOpacity = function getFillOpacity() {
  return 0;
};

Line.prototype.loadTextShape = function loadTextShape(){
  this._textShape = this.manager.getShape(this._textId);
  return this._textShape;
};

Line.prototype.setText = function setText(text) {
  if(!this._textShape){
    this.createTextShape()
  }
  this._textShape.setText(text)
};

Line.prototype.getText = function getText() {
  if(this._textShape){
    return this._textShape.getText()
  }
  return "";
};

Line.prototype.setTextPosition = function setTextPosition(textPosition) {
  if(!this._textShape){
    this.createTextShape()
  }
  this._textShape.setTextPosition(textPosition)
};

Line.prototype.getTextPosition = function getTextPosition() {
  if(this._textShape){
    return this._textShape.getTextPosition()
  }
  return "";
};

Line.prototype.setFontSize = function setFontSize(fontSize) {
  if(!this._textShape){
    this.createTextShape()
  }
  this._textShape.setFontSize(fontSize)
};

Line.prototype.getFontSize = function getFontSize() {
  if(this._textShape){
    return this._textShape.getFontSize()
  }
  return;
};

Line.prototype.getTextId = function getTextId() {
  return this._textId;
};

Line.prototype.setTextId = function setTextId(textId) {
  this._textId = textId;
};

Line.prototype.destroy = function destroy() {
  if(this._textShape){
    this.manager.deleteShapesByIds([this._textShape._id])
  }
  this.element.remove();
  this.handles.remove();
};

Line.prototype.intersectRegion = function intersectRegion(region) {
  var path = this.manager.regionToPath(region, this._zoomFraction * 100);
  var f = this._zoomFraction,
    x = parseInt(this._x1 * f, 10),
    y = parseInt(this._y1 * f, 10);

  if (Raphael.isPointInsidePath(path, x, y)) {
    return true;
  }
  var path2 = this.getPath(),
    i = Raphael.pathIntersection(path, path2);
  return i.length > 0;
};

Line.prototype.getPath = function getPath() {
  var f = this._zoomFraction,
    x1 = this._x1 * f,
    y1 = this._y1 * f,
    x2 = this._x2 * f,
    y2 = this._y2 * f;
  return "M" + x1 + " " + y1 + "L" + x2 + " " + y2;
};

Line.prototype.isSelected = function isSelected() {
  return this._selected;
};

Line.prototype.setZoom = function setZoom(zoom) {
  this._zoomFraction = zoom / 100;
  this.drawShape();
};

Line.prototype._getLineWidth = function _getLineWidth() {
  return this._strokeWidth;
};

Line.prototype.createTextShape = function createTextShape(){

  var textPosition = this.manager.getTextPosition(),
      fontSize = this.manager.getTextFontSize();

  if(textPosition == "freehand"){
    textPosition = "top"
    this.manager.setTextPosition(textPosition)
  }

  var textShape = new Text({
      manager: this.manager,
      paper: this.paper,
   //   linkedShapeId: this._id,
      zoom: this._zoomFraction,
      text: "text",
      x: this._x,
      y: this._y,
      strokeColor: this._strokeColor,
      fontSize: fontSize,
      textPosition: textPosition,
      strokeWidth: this._strokeWidth,
      parentShapeCoords: {x:this._x, y:this._y, width:this._width, height:this._height}
    })

    this.manager.addShape(textShape);
    this._textId = textShape._id;
    this._textShape = textShape;
}

Line.prototype.drawShape = function drawShape() {
  var p = this.getPath(),
    strokeColor = this._strokeColor,
    strokeW = this._getLineWidth();

  this.element.attr({
    path: p,
    stroke: strokeColor,
    fill: strokeColor,
    "stroke-width": strokeW,
  });

  if (this.isSelected()) {
    this.handles.show().toFront();
  } else {
    this.handles.hide();
  }

  // update Handles
  var handleIds = this.getHandleCoords();
  var hnd, h_id, hx, hy;
  for (var h = 0, l = this.handles.length; h < l; h++) {
    hnd = this.handles[h];
    h_id = hnd.h_id;
    hx = handleIds[h_id].x;
    hy = handleIds[h_id].y;
    hnd.attr({ x: hx - this.handle_wh / 2, y: hy - this.handle_wh / 2 });
  }

  if(this._textShape || this.loadTextShape()){
    var x = Math.min(this._x1, this._x2)
    var y = Math.min(this._y1, this._y2)
    var width = Math.abs(this._x1 - this._x2)
    var height = Math.abs(this._y1 - this._y2)
    this._textShape.setParentShapeCoords({x: x, y: y, width: width, height: height})
  }
};

Line.prototype.setSelected = function setSelected(selected) {
  this._selected = !!selected;
  if(this._textShape || this.loadTextShape()){
    this._textShape.setSelected(this._selected)
  }
  this.drawShape();
};

Line.prototype.createHandles = function createHandles() {
  // ---- Create Handles -----

  var self = this,
    // map of centre-points for each handle
    handleIds = this.getHandleCoords(),
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
      var x, y;
      dx = dx / self._zoomFraction;
      dy = dy / self._zoomFraction;

      // on DRAG...
      if (this.h_id === "start" || this.h_id === "middle") {
        self._x1 = this.old.x1 + dx;
        self._y1 = this.old.y1 + dy;
        // if shift, make line horizontal or vertical
        if (event.shiftKey && this.h_id === "start") {
          x = self._x1 - self._x2;
          y = self._y1 - self._y2;
          if (Math.abs(x / y) > 1) {
            self._y1 = this.old.y2;
          } else if (Math.abs(x / y) < 1) {
            self._x1 = this.old.x2;
          }
        }
      }
      if (this.h_id === "end" || this.h_id === "middle") {
        self._x2 = this.old.x2 + dx;
        self._y2 = this.old.y2 + dy;
        // if shift, make line horizontal or vertical
        if (event.shiftKey && this.h_id === "end") {
          x = self._x1 - self._x2;
          y = self._y1 - self._y2;
          if (Math.abs(x / y) > 1) {
            self._y2 = this.old.y1;
          } else if (Math.abs(x / y) < 1) {
            self._x2 = this.old.x1;
          }
        }
      }
      self._area =
        Math.pow(
          Math.pow(self._x2 - self._x1, 2) + Math.pow(self._y2 - self._y1, 2),
          0.5
        ) * self._strokeWidth;
      self.drawShape();
      return false;
    };
  };
  var _handle_drag_start = function () {
    return function () {
      // START drag: cache the starting coords of the line
      this.old = {
        x1: self._x1,
        x2: self._x2,
        y1: self._y1,
        y2: self._y2,
      };
      return false;
    };
  };
  var _handle_drag_end = function () {
    return function () {
      // notify manager if line has moved
      if (
        self._x1 !== this.old.x1 ||
        self._y1 !== this.old.y1 ||
        self._x2 !== this.old.x2 ||
        self._y2 !== this.old.y2
      ) {
        self.manager.notifyShapesChanged([self]);
      }
      return false;
    };
  };

  var hsize = this.handle_wh,
    hx,
    hy,
    handle;
  for (var key in handleIds) {
    hx = handleIds[key].x;
    hy = handleIds[key].y;
    handle = this.paper.rect(hx - hsize / 2, hy - hsize / 2, hsize, hsize);
    handle.attr({ cursor: "move" });
    handle.h_id = key;
    handle.line = self;

    if (this.manager.canEdit) {
      handle.drag(_handle_drag(), _handle_drag_start(), _handle_drag_end());
    }
    self.handles.push(handle);
  }
  self.handles.attr(handleAttrs).hide(); // show on selection
};

Line.prototype.getHandleCoords = function getHandleCoords() {
  var f = this._zoomFraction,
    x1 = this._x1 * f,
    y1 = this._y1 * f,
    x2 = this._x2 * f,
    y2 = this._y2 * f;
  return {
    start: { x: x1, y: y1 },
    middle: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
    end: { x: x2, y: y2 },
  };
};

var Arrow = function Arrow(options) {
  var that = new Line(options);

  var toJ = that.toJson;

  that.toJson = function toJson() {
    var lineJson = toJ.call(that);
    lineJson.type = "Arrow";
    return lineJson;
  };

  // Since we draw arrow by outline, always use thin line
  that._getLineWidth = function _getLineWidth() {
    return 0;
  };

  that.getPath = function getPath() {
    // We want the arrow tip to be precisely at x2, y2, so we
    // can't have a fat line at x2, y2. Instead we need to
    // trace the whole outline of the arrow with a thin line

    var zf = this._zoomFraction,
      x1 = this._x1 * zf,
      y1 = this._y1 * zf,
      x2 = this._x2 * zf,
      y2 = this._y2 * zf,
      w = this._strokeWidth * 0.5;

    var headSize = this._strokeWidth * 4 + 5,
      dx = x2 - x1,
      dy = y2 - y1;

    var lineAngle = Math.atan(dx / dy);
    var f = dy < 0 ? 1 : -1;

    // Angle of arrow head is 0.8 radians (0.4 either side of lineAngle)
    var arrowPoint1x = x2 + f * Math.sin(lineAngle - 0.4) * headSize,
      arrowPoint1y = y2 + f * Math.cos(lineAngle - 0.4) * headSize,
      arrowPoint2x = x2 + f * Math.sin(lineAngle + 0.4) * headSize,
      arrowPoint2y = y2 + f * Math.cos(lineAngle + 0.4) * headSize,
      arrowPointMidx = x2 + f * Math.sin(lineAngle) * headSize * 0.5,
      arrowPointMidy = y2 + f * Math.cos(lineAngle) * headSize * 0.5;

    var lineOffsetX = f * Math.cos(lineAngle) * w,
      lineOffsetY = f * Math.sin(lineAngle) * w,
      startLeftX = x1 - lineOffsetX,
      startLeftY = y1 + lineOffsetY,
      startRightX = x1 + lineOffsetX,
      startRightY = y1 - lineOffsetY,
      endLeftX = arrowPointMidx - lineOffsetX,
      endLeftY = arrowPointMidy + lineOffsetY,
      endRightX = arrowPointMidx + lineOffsetX,
      endRightY = arrowPointMidy - lineOffsetY;

    // Outline goes around the 'line' (starting in middle of arrowhead)
    var linePath =
      "M" + endRightX + " " + endRightY + " L" + endLeftX + " " + endLeftY;
    linePath =
      linePath +
      " L" +
      startLeftX +
      " " +
      startLeftY +
      " L" +
      startRightX +
      " " +
      startRightY;
    linePath = linePath + " L" + endRightX + " " + endRightY;

    // Then goes around the arrow head enough to fill it all in!
    var arrowPath =
      linePath +
      " L" +
      arrowPoint1x +
      " " +
      arrowPoint1y +
      " L" +
      arrowPoint2x +
      " " +
      arrowPoint2y;
    arrowPath =
      arrowPath +
      " L" +
      x2 +
      " " +
      y2 +
      " L" +
      arrowPoint1x +
      " " +
      arrowPoint1y +
      " L" +
      x2 +
      " " +
      y2;
    arrowPath = arrowPath + " L" + arrowPoint1x + " " + arrowPoint1y;
    return arrowPath;
  };

  // since we've over-ridden getPath() after it is called
  // during  new Line(options)
  // we need to call it again!
  that.drawShape();

  return that;
};

// Class for creating Lines.
var CreateLine = function CreateLine(options) {
  this.paper = options.paper;
  this.manager = options.manager;
};

CreateLine.prototype.startDrag = function startDrag(startX, startY) {
  // reset the text in the manager
  this.manager.setText("")

  var strokeColor = this.manager.getStrokeColor(),
    strokeWidth = this.manager.getStrokeWidth(),
    zoom = this.manager.getZoom();

  this.startX = startX;
  this.startY = startY;

  this.line = new Line({
    manager: this.manager,
    paper: this.paper,
    x1: startX,
    y1: startY,
    x2: startX,
    y2: startY,
    area: 0,
    strokeWidth: strokeWidth,
    zoom: zoom,
    strokeColor: strokeColor,
    textId: -1,
  });
};

CreateLine.prototype.drag = function drag(dragX, dragY, shiftKey) {
  // if shiftKey, constrain to horizontal / vertical
  if (shiftKey) {
    var dx = this.startX - dragX,
      dy = this.startY - dragY;

    if (Math.abs(dx / dy) > 1) {
      dy = 0;
    } else {
      dx = 0;
    }
    dragX = (dx - this.startX) * -1;
    dragY = (dy - this.startY) * -1;
  }

  this.line.setCoords({ x2: dragX, y2: dragY });
  this._area =
    Math.pow(
      Math.pow(dragX - this._x1, 2) + Math.pow(dragY - this._y1, 2),
      0.5
    ) * this._strokeWidth;
};

CreateLine.prototype.stopDrag = function stopDrag() {
  var coords = this.line.getCoords();
  if (
    Math.abs(coords.x1 - coords.x2) < 2 &&
    Math.abs(coords.y1 - coords.y2) < 2
  ) {
    this.line.destroy();
    delete this.line;
    return;
  }
  // on the 'new:shape' trigger, this shape will already be selected
  this.line.setSelected(true);
  this.manager.addShape(this.line);
};

var CreateArrow = function CreateArrow(options) {
  var that = new CreateLine(options);

  that.startDrag = function startDrag(startX, startY) {
    // reset the text in the manager
    this.manager.setText("")

    var strokeColor = this.manager.getStrokeColor(),
      strokeWidth = this.manager.getStrokeWidth(),
      zoom = this.manager.getZoom();

    this.startX = startX;
    this.startY = startY;

    this.line = new Arrow({
      manager: this.manager,
      paper: this.paper,
      x1: startX,
      y1: startY,
      x2: startX,
      y2: startY,
      area: 0,
      strokeWidth: strokeWidth,
      zoom: zoom,
      strokeColor: strokeColor,
      textId: -1,
    });
  };

  return that;
};

export { CreateLine, Line, CreateArrow, Arrow };
