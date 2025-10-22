/*
// Copyright (C) 2015-2024 University of Dundee & Open Microscopy Environment.
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

const POINT_RADIUS = 5;
var Point = function Point(options) {
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
  this._radiusX = POINT_RADIUS;
  this._radiusY = POINT_RADIUS;
  this._rotation = options.rotation || 0;

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

  this._textId = options.textId || -1;
  this._textShape = this.manager.getShape(this._textId)

  this.element = this.paper.ellipse();
  this.element.attr({ "fill-opacity": this._fillOpacity, fill: this._fillColor, cursor: "pointer" });

  // Drag handling of point
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

Point.prototype.toJson = function toJson() {
  var rv = {
    type: "Point",
    x: this._x,
    y: this._y,
    strokeWidth: this._strokeWidth,
    strokeColor: this._strokeColor,
    fillColor: this._fillColor,
    fillOpacity: this._fillOpacity,
    textId: this._textId,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

Point.prototype.compareCoords = function compareCoords(json) {
  var selfJson = this.toJson(),
    match = true;
  if (json.type !== selfJson.type) {
    return false;
  }
  ["x", "y"].forEach(function (c) {
    if (Math.round(json[c]) !== Math.round(selfJson[c])) {
      match = false;
    }
  });
  return match;
};

// Useful for pasting json with an offset
Point.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x = json.x + dx;
  json.y = json.y + dy;
  return json;
};

// Shift this shape by dx and dy
Point.prototype.offsetShape = function offsetShape(dx, dy) {
  this._x = this._x + dx;
  this._y = this._y + dy;
  this.drawShape();
};

// handle start of drag by selecting this shape
// if not already selected
Point.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Point.prototype.setColor = function setColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Point.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

Point.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Point.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  this._strokeWidth = strokeWidth;
  this.drawShape();
};

Point.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Point.prototype.getFillColor = function getFillColor() {
  return this._fillColor;
};


Point.prototype.setFillColor = function setFillColor(fillColor) {
  this._fillColor = fillColor;
  this.drawShape();
};

Point.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  this._fillOpacity = fillOpacity;
  this.drawShape();
};

Point.prototype.getFillOpacity = function getFillOpacity() {
  return this._fillOpacity;
};

Point.prototype.loadTextShape = function loadTextShape(){
  this._textShape = this.manager.getShape(this._textId);
  return this._textShape;
};

Point.prototype.setText = function setText(text) {
  if(this._textShape){
    this._textShape.setText(text)
  }
};

Point.prototype.getText = function getText() {
  if(this._textShape){
    return this._textShape.getText()
  }
  return "";
};

Point.prototype.setShowText = function setShowText(showText) {
  if(this._textShape){
    this._textShape.setShowText(showText)
  }
};

Point.prototype.getShowText = function getShowText() {
   if(this._textShape){
    return this._textShape.getShowText()
  }
  return "";
};

Point.prototype.setTextPosition = function setTextPosition(textPosition) {
  if(this._textShape){
    this._textShape.setTextPosition(textPosition)
  }
};

Point.prototype.getTextPosition = function getTextPosition() {
  if(this._textShape){
    return this._textShape.getTextPosition()
  }
  return "";
};

Point.prototype.setFontSize = function setFontSize(fontSize) {
  if(this._textShape){
    this._textShape.setFontSize(fontSize)
  }
};

Point.prototype.getFontSize = function getFontSize() {
  if(this._textShape){
    return this._textShape.getFontSize()
  }
  return;
};

Point.prototype.getTextId = function getTextId() {
  return this._textId;
};

Point.prototype.setTextId = function setTextId(textId) {
  this._textId = textId;
};

Point.prototype.setInModalView = function setInModalView(inModalView) {
  if(this._textShape){
    this._textShape.setInModalView(inModalView)
  }
};

Point.prototype.setTextRotation = function setTextRotation(textRotation) {
  if(this._textShape){
    this._textShape.setTextRotation(textRotation)
  }
};

Point.prototype.setTextBackgroundOpacity = function setTextBackgroundOpacity(textBackgroundOpacity) {
  if(this._textShape){
    this._textShape.setTextBackgroundOpacity(textBackgroundOpacity)
  }
};

Point.prototype.getTextBackgroundOpacity = function getTextBackgroundOpacity() {
  if(this._textShape){
    return this._textShape.getTextBackgroundOpacity()
  }
  return;
};

Point.prototype.setTextBackgroundColor = function setTextBackgroundColor(textBackgroundColor) {
  if(this._textShape){
    this._textShape.setTextBackgroundColor(textBackgroundColor)
  }
};

Point.prototype.getTextBackgroundColor = function getTextBackgroundColor() {
  if(this._textShape){
    return this._textShape.getTextBackgroundColor()
  }
  return;
};

Point.prototype.setTextColor = function setTextColor(textColor) {
  if(this._textShape){
    this._textShape.setTextColor(textColor)
  }
};

Point.prototype.getTextColor = function getTextColor() {
  if(this._textShape){
    return this._textShape.getTextColor()
  }
  return;
};

Point.prototype.setVerticalFlip = function setVerticalFlip(vFlip) {
  if(this._textShape){
    this._textShape.setVerticalFlip(vFlip)
  }
};

Point.prototype.setHorizontalFlip = function setHorizontalFlip(hFlip) {
  if(this._textShape){
    this._textShape.setHorizontalFlip(hFlip)
  }
};

Point.prototype.destroy = function destroy() {
  if(this._textShape){
    this.manager.deleteShapesByIds([this._textShape._id])
    this.destroyTextShape()
  }
  this.element.remove();
  this.handles.remove();
};

Point.prototype.destroyTextShape = function destroyTextShape() {
  this._textId = -1
  this._textShape = undefined;
}

Point.prototype.intersectRegion = function intersectRegion(region) {
  var path = this.manager.regionToPath(region, this._zoomFraction * 100);
  var f = this._zoomFraction,
    x = parseInt(this._x * f, 10),
    y = parseInt(this._y * f, 10);

  return Raphael.isPointInsidePath(path, x, y);
};

Point.prototype.getPath = function getPath() {
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

Point.prototype.isSelected = function isSelected() {
  return this._selected;
};

Point.prototype.setZoom = function setZoom(zoom) {
  this._zoomFraction = zoom / 100;
  this.drawShape();
};

Point.prototype.updateHandle = function updateHandle(
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

Point.prototype.updateShapeFromHandles = function updateShapeFromHandles(
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

Point.prototype.createShapeText = function createShapeText(){
  if(!this._textShape){
    var textPosition = this.manager.getTextPosition(),
        fontSize = this.manager.getTextFontSize(),
        inModalView = this.manager.getInModalView(),
        vFlip = this.manager.getVerticalFlip(),
        hFlip = this.manager.getHorizontalFlip(),
        textColor = this.manager.getTextColor(),
        shapeScalingFactor = this.manager.getShapeScalingFactor(),
        textBackgroundOpacity = this.manager.getTextBackgroundOpacity(),
        textBackgroundColor = this.manager.getTextBackgroundColor(),
        textRotation = this.manager.getTextRotation();

    if(textPosition == "freehand"){
      textPosition = "top"
      this.manager.setTextPosition(textPosition)
    }

    var textShape = new Text({
        manager: this.manager,
        paper: this.paper,
        inModalView: inModalView,
        textRotation: textRotation,
        vFlip: vFlip,
        hFlip: hFlip,
        linkedShapeId: this._id,
        zoom: this._zoomFraction * 100,
        text: "text",
        showText: true,
        x: this._x,
        y: this._y,
        shapeScalingFactor: shapeScalingFactor,
        textBackgroundOpacity: textBackgroundOpacity,
        textBackgroundColor: textBackgroundColor,
        textColor: textColor,
        fontSize: fontSize,
        textPosition: textPosition,
        strokeWidth: this._strokeWidth,
        parentShapeCoords: {x: this._x - this._radiusX, y: this._y - this._radiusY, width: 2*this._radiusX, height: 2*this._radiusY}
      })

      this.manager.addShape(textShape);
      this._textId = textShape._id;
      this._textShape = textShape;
  }
}

Point.prototype.drawShape = function drawShape() {
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
    "stroke-width": strokeW,
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

  if(this._textShape || this.loadTextShape()){
    this._textShape.setParentShapeCoords({x: this._x - this._radiusX, y: this._y - this._radiusY, width: 2*this._radiusX, height: 2*this._radiusY})
  }
};

Point.prototype.setSelected = function setSelected(selected) {
  if((selected && this._selected) || (!selected && !this._selected)){
    return
  }
  this._selected = !!selected;
  if(this._textShape || this.loadTextShape()){
    this._textShape.setSelected(this._selected)
  }
  this.drawShape();
};

Point.prototype.createHandles = function createHandles() {
  // ---- Create Handles -----

  // NB: handleIds are used to calculate ellipse coords
  // so handledIds are scaled to MODEL coords, not zoomed.
  this._handleIds = this.getHandleCoords();

  var self = this,
    // map of centre-points for each handle
    handleAttrs = {
      stroke: "#4b80f9",
      fill: "#fff",
      cursor: "default",
      "fill-opacity": 1.0,
    };

  // draw handles - Can't drag handles to resize, but they are useful
  // simply to indicate that the Point is selected
  self.handles = this.paper.set();

  var hsize = this.handle_wh,
    hx,
    hy,
    handle;
  for (var key in this._handleIds) {
    hx = this._handleIds[key].x;
    hy = this._handleIds[key].y;
    handle = this.paper.rect(hx - hsize / 2, hy - hsize / 2, hsize, hsize);
    handle.attr({ cursor: "move" });
    handle.h_id = key;
    handle.line = self;
    self.handles.push(handle);
  }

  self.handles.attr(handleAttrs).hide(); // show on selection
};

Point.prototype.getHandleCoords = function getHandleCoords() {
  // Returns MODEL coordinates (not zoom coordinates)
  let margin = 2;

  var rot = Raphael.rad(this._rotation),
    x = this._x,
    y = this._y,
    radiusX = this._radiusX + margin,
    radiusY = this._radiusY + margin,
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

// Class for creating Point.
var CreatePoint = function CreatePoint(options) {
  this.paper = options.paper;
  this.manager = options.manager;
};

CreatePoint.prototype.startDrag = function startDrag(startX, startY) {
  // reset the text in the manager
  this.manager.setText("")
  this.manager.setShowText(false)

  var strokeColor = this.manager.getStrokeColor(),
    strokeWidth = this.manager.getStrokeWidth(),
    fillColor = this.manager.getFillColor(),
    fillOpacity = this.manager.getFillOpacity(),
    zoom = this.manager.getZoom();

  this.point = new Point({
    manager: this.manager,
    paper: this.paper,
    x: startX,
    y: startY,
    radiusX: POINT_RADIUS,
    radiusY: POINT_RADIUS,
    area: 0,
    rotation: 0,
    strokeWidth: strokeWidth,
    zoom: zoom,
    strokeColor: strokeColor,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    textId: -1
  });
};

CreatePoint.prototype.drag = function drag(dragX, dragY, shiftKey) {
  // no drag behaviour on Point creation
};

CreatePoint.prototype.stopDrag = function stopDrag() {
  // Don't create ellipse of zero size (click, without drag)
  var coords = this.point.toJson();
  if (coords.radiusX < 2) {
    this.point.destroy();
    delete this.ellipse;
    return;
  }
  // on the 'new:shape' trigger, this shape will already be selected
  this.point.setSelected(true);
  this.manager.addShape(this.point);
};

export { CreatePoint, Point };
