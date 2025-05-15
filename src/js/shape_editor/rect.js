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


var Rect = function Rect(options) {
  var self = this;
  this.paper = options.paper;
  this.manager = options.manager;

  if (options.id) {
    this._id = options.id;
  } else {
    this._id = this.manager.getRandomId();
  }
  this._x = options.x;
  this._y = options.y;
  this._width = options.width;
  this._height = options.height;
  if (options.area) {
    this._area = options.area;
  } else {
    this._area = this._width * this._height;
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
  this._rotation = options.rotation || 0;

  this._textId = options.textId || -1;
  this._textShape = this.manager.getShape(this._textId)

  this.handle_wh = 6;

  this.element = this.paper.rect();
  this.element.attr({ "fill-opacity": this._fillOpacity, fill: this._fillColor, cursor: "pointer" });

  if (this.manager.canEdit) {
    // Drag handling of element
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
      },
      function () {
        self._handleMousedown();
        this.prevX = 0;
        this.prevY = 0;
        return false;
      },
      function () {
        // STOP
        // notify manager if rectangle has moved
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

Rect.prototype.toJson = function toJson() {
  var rv = {
    type: "Rectangle",
    x: this._x,
    y: this._y,
    width: this._width,
    height: this._height,
    'area': this._width * this._height,
    strokeWidth: this._strokeWidth,
    strokeColor: this._strokeColor,
    rotation: this._rotation,
    fillColor: this._fillColor,
    fillOpacity: this._fillOpacity,
    textId: this._textId,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

// Does this intersect a 'region' as defined by MODEL coords (not zoom dependent)
Rect.prototype.intersectRegion = function intersectRegion(region) {
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

// Useful for testing intersection of paths
Rect.prototype.getPath = function getPath() {
  var f = this._zoomFraction,
    x = parseInt(this._x * f, 10),
    y = parseInt(this._y * f, 10),
    width = parseInt(this._width * f, 10),
    height = parseInt(this._height * f, 10);

  var cornerPoints = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
  var path = [];
  for (var i = 0; i <= 3; i++) {
    if (i === 0) {
      path.push("M" + cornerPoints[0].join(","));
    }
    if (i < 3) {
      path.push("L" + cornerPoints[i + 1].join(","));
    } else {
      path.push("Z");
    }
  }
  return path.join(",");
};

Rect.prototype.compareCoords = function compareCoords(json) {
  if (json.type !== "Rectangle") {
    return false;
  }
  var selfJson = this.toJson(),
    match = true;
  ["x", "y", "width", "height"].forEach(function (c) {
    if (json[c] !== selfJson[c]) {
      match = false;
    }
  });
  return match;
};

// Useful for pasting json with an offset
Rect.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x = json.x + dx;
  json.y = json.y + dy;
  return json;
};

// Shift this shape by dx and dy
Rect.prototype.offsetShape = function offsetShape(dx, dy) {
  this._x = this._x + dx;
  this._y = this._y + dy;
  this.drawShape();
};

// handle start of drag by selecting this shape
// if not already selected
Rect.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Rect.prototype.setSelected = function setSelected(selected) {
  this._selected = !!selected;
  if(this._textShape || this.loadTextShape()){
    this._textShape.setSelected(this._selected)
  }
  this.drawShape();
};

Rect.prototype.isSelected = function isSelected() {
  return this._selected;
};

Rect.prototype.loadTextShape = function loadTextShape(){
  this._textShape = this.manager.getShape(this._textId);
  return this._textShape;
};

Rect.prototype.setZoom = function setZoom(zoom) {
  this._zoomFraction = zoom / 100;
  this.drawShape();
};

Rect.prototype.setCoords = function setCoords(coords) {
  this._x = coords.x || this._x;
  this._y = coords.y || this._y;
  this._width = coords.width || this._width;
  this._height = coords.height || this._height;
  this.drawShape();
};

Rect.prototype.getCoords = function getCoords() {
  return { x: this._x, y: this._y, width: this._width, height: this._height };
};

Rect.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Rect.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

Rect.prototype.setFillColor = function setFillColor(fillColor) {
  this._fillColor = fillColor;
  this.drawShape();
};

Rect.prototype.getFillColor = function getFillColor() {
  return this._fillColor;
};

Rect.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  this._fillOpacity = fillOpacity;
  this.drawShape();
};

Rect.prototype.getFillOpacity = function getFillOpacity() {
  return this._fillOpacity;
};

Rect.prototype.setText = function setText(text) {
  if(this._textShape){
    this._textShape.setText(text)
  }
};

Rect.prototype.getText = function getText() {
  if(this._textShape){
    return this._textShape.getText()
  }
  return "";
};

Rect.prototype.setTextPosition = function setTextPosition(textPosition) {
  if(this._textShape){
    this._textShape.setTextPosition(textPosition)
  }
};

Rect.prototype.getTextPosition = function getTextPosition() {
  if(this._textShape){
    return this._textShape.getTextPosition()
  }
  return "";
};

Rect.prototype.setFontSize = function setFontSize(fontSize) {
  if(this._textShape){
    this._textShape.setFontSize(fontSize)
  }
};

Rect.prototype.getFontSize = function getFontSize() {
  if(this._textShape){
    return this._textShape.getFontSize()
  }
  return;
};

Rect.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  this._strokeWidth = strokeWidth;
  this.drawShape();
};

Rect.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Rect.prototype.getTextId = function getTextId() {
  return this._textId;
};

Rect.prototype.setTextId = function setTextId(textId) {
  this._textId = textId;
};

Rect.prototype.setInModalView = function setInModalView(inModalView) {
  if(this._textShape){
    this._textShape.setInModalView(inModalView)
  }
};

Rect.prototype.setTextRotation = function setTextRotation(textRotation) {
  if(this._textShape){
    this._textShape.setTextRotation(textRotation)
  }
};

Rect.prototype.setTextBackgroundOpacity = function setTextBackgroundOpacity(textBackgroundOpacity) {
  if(this._textShape){
    this._textShape.setTextBackgroundOpacity(textBackgroundOpacity)
  }
};

Rect.prototype.getTextBackgroundOpacity = function getTextBackgroundOpacity() {
  if(this._textShape){
    this._textShape.getTextBackgroundOpacity()
  }
};

Rect.prototype.setTextBackgroundColor = function setTextBackgroundColor(textBackgroundColor) {
  if(this._textShape){
    this._textShape.setTextBackgroundColor(textBackgroundColor)
  }
};

Rect.prototype.getTextBackgroundColor = function getTextBackgroundColor() {
  if(this._textShape){
    this._textShape.getTextBackgroundColor()
  }
};

Rect.prototype.setTextColor = function setTextColor(textColor) {
  if(this._textShape){
    this._textShape.setTextColor(textColor)
  }
};

Rect.prototype.getTextColor = function getTextColor() {
  if(this._textShape){
    this._textShape.getTextColor()
  }
};

Rect.prototype.setVerticalFlip = function setVerticalFlip(vFlip) {
  if(this._textShape){
    this._textShape.setVerticalFlip(vFlip)
  }
};

Rect.prototype.setHorizontalFlip = function setHorizontalFlip(hFlip) {
  if(this._textShape){
    this._textShape.setHorizontalFlip(hFlip)
  }
};

Rect.prototype.destroy = function destroy() {
  if(this._textShape){
    this.manager.deleteShapesByIds([this._textShape._id])
    this.destroyTextShape()
  }
  this.element.remove();
  this.handles.remove();
};

Rect.prototype.destroyTextShape = function destroyTextShape() {
  this._textId = -1
  this._textShape = undefined;
}

Rect.prototype.createShapeText = function createShapeText(){
  if(!this._textShape){
    var textPosition = this.manager.getTextPosition(),
          fontSize = this.manager.getTextFontSize(),
          inModalView = this.manager.getInModalView(),
          vFlip = this.manager.getVerticalFlip(),
          hFlip = this.manager.getHorizontalFlip(),
          textColor = this.manager.getTextColor(),
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
          vFlip: vFlip,
          hFlip: hFlip,
          textRotation: textRotation,
          linkedShapeId: this._id,
          zoom: this._zoomFraction * 100,
          text: "text",
          x: this._x,
          y: this._y,
          textBackgroundOpacity: textBackgroundOpacity,
          textBackgroundColor: textBackgroundColor,
          textColor: textColor,
          fontSize: fontSize,
          textPosition: textPosition,
          strokeWidth: this._strokeWidth,
          parentShapeCoords: {x:this._x, y:this._y, width:this._width, height:this._height}
      })

      this.manager.addShape(textShape);
      this._textId = textShape._id;
      this._textShape = textShape;
  }
}

Rect.prototype.drawShape = function drawShape() {
  var strokeColor = this._strokeColor,
    lineW = this._strokeWidth,
    fillColor = this._fillColor,
    fillOpacity = this._fillOpacity;

  var f = this._zoomFraction,
    x = this._x * f,
    y = this._y * f,
    w = this._width * f,
    h = this._height * f;

  this.element.attr({
    x: x,
    y: y,
    width: w,
    height: h,
    stroke: strokeColor,
    "stroke-width": lineW,
    fill: fillColor,
    "fill-opacity": fillOpacity
  });

  this.element.transform("r" + this._rotation + "," + (x + (w/2)) + "," + (y + (h/2)));

  if (this.isSelected()) {
    this.handles.show().toFront();
  } else {
    this.handles.hide();
  }

  // update Handles
  var handleIds = this.getHandleCoords();
  var hnd, h_id, hx, hy;
  for (var i = 0, l = this.handles.length; i < l; i++) {
    hnd = this.handles[i];
    h_id = hnd.h_id;
    hx = handleIds[h_id][0];
    hy = handleIds[h_id][1];
    hnd.attr({ x: hx - this.handle_wh / 2, y: hy - this.handle_wh / 2 });
    hnd.transform("r" + this._rotation + "," + (x + (w/2)) + "," + (y + (h/2)));
  }

  if(this._textShape || this.loadTextShape()){
    this._textShape.setParentShapeCoords({x: this._x, y: this._y, width: this._width, height: this._height})
  }
};

Rect.prototype.getHandleCoords = function getHandleCoords() {
  var f = this._zoomFraction,
    x = this._x * f,
    y = this._y * f,
    w = this._width * f,
    h = this._height * f;

  var handleIds = {
    nw: [x, y],
    n: [x + w / 2, y],
    ne: [x + w, y],
    w: [x, y + h / 2],
    e: [x + w, y + h / 2],
    sw: [x, y + h],
    s: [x + w / 2, y + h],
    se: [x + w, y + h],
  };
  return handleIds;
};

function correct_rotation(dx, dy, rotation) {
  if (dx === 0 && dy === 0) {
      return {x: dx, y: dy};
  }
  var length = Math.sqrt(dx * dx + dy * dy),
      ang1 = Math.atan(dy/dx);
  if (dx < 0) {
      ang1 = Math.PI + ang1;
  }
  var angr = rotation * (Math.PI/180),  // deg -> rad
      ang2 = ang1 - angr;
  dx = Math.cos(ang2) * length;
  dy = Math.sin(ang2) * length;
  return {x: dx, y: dy};
}

// ---- Create Handles -----
Rect.prototype.createHandles = function createHandles() {
  var self = this,
    handle_attrs = {
      stroke: "#4b80f9",
      fill: "#fff",
      cursor: "default",
      "fill-opacity": 1.0,
    };

  // map of centre-points for each handle
  var handleIds = this.getHandleCoords();

  // draw handles
  self.handles = this.paper.set();
  var _handle_drag = function () {
    return function (dx, dy, mouseX, mouseY, event) {
      dx = dx / self._zoomFraction;
      dy = dy / self._zoomFraction;
      // need to handle rotation...
      if (self._rotation != 0) {
        let xy = correct_rotation(dx, dy, self._rotation);
        dx = xy.x;
        dy = xy.y;
      }

      // If drag on corner handle, retain aspect ratio. dx/dy = aspect
      var keep_ratio = self.fixed_ratio || event.shiftKey;
      if (keep_ratio && this.h_id.length === 2) {
        // E.g. handle is corner 'ne' etc
        if (this.h_id === "se" || this.h_id === "nw") {
          if (Math.abs(dx / dy) > this.aspect) {
            dy = dx / this.aspect;
          } else {
            dx = dy * this.aspect;
          }
        } else {
          if (Math.abs(dx / dy) > this.aspect) {
            dy = -dx / this.aspect;
          } else {
            dx = -dy * this.aspect;
          }
        }
      }
      // Use dx & dy to update the location of the handle and the corresponding point of the parent
      var new_x = this.ox + dx;
      var new_y = this.oy + dy;
      var newRect = {
        x: self._x,
        y: self._y,
        width: self._width,
        height: self._height,
      };
      if (this.h_id.indexOf("e") > -1) {
        // if we're dragging an 'EAST' handle, update width
        newRect.width = new_x - self._x + self.handle_wh / 2;
      }
      if (this.h_id.indexOf("s") > -1) {
        // if we're dragging an 'SOUTH' handle, update height
        newRect.height = new_y - self._y + self.handle_wh / 2;
      }
      if (this.h_id.indexOf("n") > -1) {
        // if we're dragging an 'NORTH' handle, update y and height
        newRect.y = new_y + self.handle_wh / 2;
        newRect.height = this.oheight - dy;
      }
      if (this.h_id.indexOf("w") > -1) {
        // if we're dragging an 'WEST' handle, update x and width
        newRect.x = new_x + self.handle_wh / 2;
        newRect.width = this.owidth - dx;
      }
      // Don't allow zero sized rect.
      if (newRect.width < 1 || newRect.height < 1) {
        return false;
      }

      self._x = newRect.x;
      self._y = newRect.y;
      self._width = newRect.width;
      self._height = newRect.height;
      self._area = newRect.width * newRect.height;
      self.drawShape();
      return false;
    };
  };
  var _handle_drag_start = function () {
    return function () {
      // START drag: simply note the location we started
      this.ox = this.attr("x") / self._zoomFraction;
      this.oy = this.attr("y") / self._zoomFraction;
      this.owidth = self._width;
      this.oheight = self._height;
      this.aspect = self._width / self._height;
      return false;
    };
  };
  var _handle_drag_end = function () {
    return function () {
      if (this.owidth !== self._width || this.oheight !== self._height) {
        self.manager.notifyShapesChanged([self]);
      }
      return false;
    };
  };
  // var _stop_event_propagation = function(e) {
  //     e.stopImmediatePropagation();
  // }
  let cx = handleIds['n'][0];
  let cy = handleIds['e'][1];

  for (var key in handleIds) {
    var hx = handleIds[key][0];
    var hy = handleIds[key][1];
    var handle = this.paper
      .rect(
        hx - self.handle_wh / 2,
        hy - self.handle_wh / 2,
        self.handle_wh,
        self.handle_wh
      )
      .attr(handle_attrs)
      .rotate(self._rotation, cx, cy);
    handle.attr({ cursor: key + "-resize" }); // css, E.g. ne-resize
    handle.h_id = key;
    handle.rect = self;

    if (self.manager.canEdit) {
      handle.drag(_handle_drag(), _handle_drag_start(), _handle_drag_end());
    }
    // handle.mousedown(_stop_event_propagation);
    self.handles.push(handle);
  }
  self.handles.hide(); // show on selection
};

// Class for creating Lines.
var CreateRect = function CreateRect(options) {
  this.paper = options.paper;
  this.manager = options.manager;
};

CreateRect.prototype.startDrag = function startDrag(startX, startY) {
  // reset the text in the manager
  this.manager.setText("")

  var strokeColor = this.manager.getStrokeColor(),
    strokeWidth = this.manager.getStrokeWidth(),
    fillColor = this.manager.getFillColor(),
    fillOpacity = this.manager.getFillOpacity(),
    zoom = this.manager.getZoom();

  this.startX = startX;
  this.startY = startY;

  this.rect = new Rect({
    manager: this.manager,
    paper: this.paper,
    x: startX,
    y: startY,
    width: 0,
    height: 0,
    area: 0,
    strokeWidth: strokeWidth,
    zoom: zoom,
    strokeColor: strokeColor,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    textId: -1,
  });
};

CreateRect.prototype.drag = function drag(dragX, dragY, shiftKey) {
  var dx = this.startX - dragX,
    dy = this.startY - dragY;

  // if shiftKey, constrain to a square
  if (shiftKey) {
    if (dx * dy > 0) {
      if (Math.abs(dx / dy) > 1) {
        dy = dx;
      } else {
        dx = dy;
      }
    } else {
      if (Math.abs(dx / dy) > 1) {
        dy = -dx;
      } else {
        dx = -dy;
      }
    }
    dragX = (dx - this.startX) * -1;
    dragY = (dy - this.startY) * -1;
  }

  var newCoords = {
    x: Math.min(dragX, this.startX),
    y: Math.min(dragY, this.startY),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }

  this.rect.setCoords(newCoords);
  this.rect._area = Math.abs(dx) * Math.abs(dy);
};

CreateRect.prototype.stopDrag = function stopDrag() {
  var coords = this.rect.getCoords();
  if (coords.width < 2 || coords.height < 2) {
    this.rect.destroy();
    delete this.rect;
    return;
  }
  // on the 'new:shape' trigger, this shape will already be selected
  this.rect.setSelected(true);
  this.manager.addShape(this.rect);
};

export { CreateRect, Rect };
