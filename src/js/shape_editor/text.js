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

var Text = function Text(options) {
  var self = this;
  this.manager = options.manager;
  this.paper = options.paper;
  this._x = options.x;
  this._y = options.y;
  this._textColor = options.textColor;
  this._fontSize = options.fontSize;
  this._text = options.text;
  this._parentShapeCoords = options.parentShapeCoords;
  this._strokeWidth = options.strokeWidth || 2;
  this._textPosition = options.textPosition;
  this._linkedShapeId = options.linkedShapeId || -1;
  this._inModalView = options.inModalView || false;
  this._textBackgroundOpacity = options.textBackgroundOpacity || 0.01;
  this._textBackgroundColor = options.textBackgroundColor || "#fff";

  this._id = options.id || this.manager.getRandomId();
  if(this._id == -1){
    this._id = this.manager.getRandomId();
  }
  this._zoomFraction = options.zoom ? options.zoom / 100 : 1
  this._textAnchor = options.textAnchor || "start"
  this._rotation = options.rotation || 0;
  this._textRotation = options.textRotation || 0;
  this._vFlip = options.vFlip || 1;
  this._hFlip = options.hFlip || 1;

  this._selected = false;
  this._area = 0;
  this.handle_wh = 6;

  this.bkgdRect = this.paper.rect();
  this.bkgdRect.attr({"fill-opacity": this._textBackgroundOpacity, fill: this._textBackgroundColor});

  this.element = this.paper.text();
  this.element.attr({"fill-opacity": 0.01, fill: "#fff"});

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

        self._textPosition = "freehand"

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

Text.prototype.toJson = function toJson() {
  var rv = {
    type: "Text",
    x: this._x,
    y: this._y,
    area: this._area,
    fontSize: this._fontSize,
    textBackgroundOpacity: this._textBackgroundOpacity,
    textBackgroundColor: this._textBackgroundColor,
    textColor: this._textColor,
    text: this._text,
    textAnchor: this._textAnchor,
    rotation: this._rotation,
    textRotation: this._textRotation,
    hFlip: this._hFlip,
    vFlip: this._vFlip,
    textPosition: this._textPosition,
    parentShapeCoords: this._parentShapeCoords,
    linkedShapeId: this._linkedShapeId,
    strokeWidth: this._strokeWidth,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

Text.prototype.intersectRegion = function intersectRegion(region) {
  return;
}

Text.prototype.offsetShape = function offsetShape(dx, dy) {
  this._x = this._x + dx;
  this._y = this._y + dy;
  this.drawShape();
};

Text.prototype.compareCoords = function compareCoords(json) {
  if (json.type !== "Text") {
    return false;
  }
  var selfJson = this.toJson(),
    match = true;
  ["x", "y", "text"].forEach(function (c) {
    if (json[c] !== selfJson[c]) {
      match = false;
    }
  });
  return match;
};

// Useful for pasting json with an offset
Text.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x = json.x + dx;
  json.y = json.y + dy;
  return json;
};

Text.prototype.setStrokeColor = function setStrokeColor(color) {
  return;
};

Text.prototype.getStrokeColor = function getStrokeColor() {
  return;// this.getTextColor();
};

Text.prototype.setTextColor = function setTextColor(color) {
  this._textColor = color;
  this.drawShape();
};

Text.prototype.getTextColor = function getTextColor() {
  return this._textColor;
};

Text.prototype.setStrokeWidth = function setStrokeWidth(width) {
  this._strokeWidth = width;
  this.drawShape();
};

Text.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Text.prototype.setFontSize = function setFontSize(fontSize) {
  this._fontSize = fontSize;
  this.drawShape();
};

Text.prototype.getFontSize = function getFontSize() {
  return this._fontSize;
};

Text.prototype.setText = function setText(text) {
  this._text = text;
  this.drawShape();
};

Text.prototype.getText = function getText() {
  return this._text;
};

Text.prototype.setTextPosition = function setTextPosition(textPosition) {
    this._textPosition = textPosition;
    this.drawShape();
};

Text.prototype.getTextPosition = function getTextPosition() {
  return this._textPosition;
};

Text.prototype.setFillColor = function setFillColor(fillColor) {
  return;
};

Text.prototype.getFillColor = function getFillColor() {
  return;// this.getTextColor();
};

Text.prototype.setTextBackgroundColor = function setTextBackgroundColor(textBackgroundColor) {
  this._textBackgroundColor = textBackgroundColor;
  this.drawShape();
};

Text.prototype.getTextBackgroundColor = function getTextBackgroundColor() {
  return this._textBackgroundColor;
};

Text.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  return;
};

Text.prototype.getFillOpacity = function getFillOpacity() {
  return 0;
};

Text.prototype.setTextBackgroundOpacity = function setTextBackgroundOpacity(textBackgroundOpacity) {
  this._textBackgroundOpacity = textBackgroundOpacity;
  this.drawShape();
};

Text.prototype.getTextBackgroundOpacity = function getTextBackgroundOpacity() {
  return this._textBackgroundOpacity;
};

Text.prototype.setZoom = function setZoom(zoom) {
   this._zoomFraction = zoom ? zoom / 100 : 1;
   this.drawShape();
};

Text.prototype.setRotation = function setRotation(rotation) {
  this._rotation = rotation;
  this.drawShape();
};

Text.prototype.setTextRotation = function setTextRotation(textRotation) {
  this._textRotation = textRotation;
  this.drawShape();
};

Text.prototype.setVerticalFlip = function setVerticalFlip(vFlip) {
  this._vFlip = vFlip;
  this.drawShape();
};

Text.prototype.setHorizontalFlip = function setHorizontalFlip(hFlip) {
  this._hFlip = hFlip;
  this.drawShape();
};

Text.prototype.setInModalView = function setInModalView(inModalView) {
  this._inModalView = inModalView
  this.drawShape();
};

Text.prototype.setParentShapeCoords = function setParentShapeCoords(coords){
  this._parentShapeCoords = coords;
  this.drawShape();
};

Text.prototype.createShapeText = function createShapeText(){
  return;
}

Text.prototype.destroy = function destroy() {
  this.element.remove();
  this.handles.remove();
  this.bkgdRect.remove();
  if(this._linkedShapeId != -1){
    var parentShape = this.manager.getShape(this._linkedShapeId);
    if(parentShape){
      parentShape.destroyTextShape()
    }
  }
};

// handle start of drag by selecting this shape
// if not already selected
Text.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Text.prototype.isSelected = function isSelected() {
  return this._selected;
};

Text.prototype.setSelected = function setSelected(selected) {
  this._selected = selected;
  this.drawShape();
};

Text.prototype.intersectRegion = function intersectRegion(region) {
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

Text.prototype.getPath = function getPath() {
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


Text.prototype.drawShape = function drawShape() {
  var color = this._textColor,
      f = this._zoomFraction,
      fontSize = this._fontSize,
      textAnchor = "middle",
      textOffsetX = (this._strokeWidth/2 + 6) / f,
      textOffsetY = (this._strokeWidth/2 + (fontSize > 12 ? fontSize/2 : 6) + 4) / f,
      px = this._parentShapeCoords.x,
      py = this._parentShapeCoords.y,
      pw = this._parentShapeCoords.width,
      ph = this._parentShapeCoords.height,
      x = px,
      y = py,
      dx = 0,
      dy = 0,
      final_x = undefined,
      final_y = undefined,
      outPositions = ["top", "left", "bottom","right"],
      inPositions = ["topleft", "bottomleft", "bottomright", "topright"],
      outAnchors = ["middle", "end", "middle", "start"],
      inAnchors = ["start", "start", "end", "end"],
      rotationIndex = Math.floor(((360 - this._rotation + 45) / 90)) % 4,
      finalIndex

  switch(this._textPosition){
    case "bottom":
    case "left":
    case "right":
    case "top":
        var posIndex = outPositions.indexOf(this._textPosition)
        finalIndex = (posIndex + rotationIndex) % 4
        break;
    case "topleft":
    case "topright":
    case "bottomleft":
    case "bottomright":
        var posIndex = inPositions.indexOf(this._textPosition)
        finalIndex = (posIndex + rotationIndex) % 4
        break;
  }

  switch(this._textPosition){
    case "bottom":
      dx = pw/2;
      dy = ph + textOffsetY;
      if(this._linkedShapeId == -1){
        dy = ph - textOffsetY;
        textAnchor = outAnchors[(finalIndex + 2) % 4]
      }
      textAnchor = outAnchors[finalIndex]
      break;
  case "left":
      dx = -textOffsetX;
      dy = ph/2;
      textAnchor = outAnchors[finalIndex]
      if(this._linkedShapeId == -1){
        dx = textOffsetX;
        textAnchor = outAnchors[(finalIndex + 2) % 4]
      }
      break;
  case "right":
      dx = pw + textOffsetX;
      dy = ph/2;
      textAnchor = outAnchors[finalIndex]
      if(this._linkedShapeId == -1){
        dx = pw - textOffsetX;
        textAnchor = outAnchors[(finalIndex + 2) % 4]
      }
      break;
  case "top":
      dx = pw/2;
      dy = -textOffsetY;
      if(this._linkedShapeId == -1){
        dy = + textOffsetY;
        textAnchor = outAnchors[(finalIndex + 2) % 4]
      }
      textAnchor = outAnchors[finalIndex]
      break;
  case "topleft":
      dx = textOffsetX;
      dy = textOffsetY;
      textAnchor = inAnchors[finalIndex]
      break;
  case "topright":
      dx = pw - textOffsetX;
      dy = textOffsetY;
      textAnchor = inAnchors[finalIndex]
      break;
  case "bottomleft":
      dx = textOffsetX;
      dy = ph - textOffsetY;
      textAnchor = inAnchors[finalIndex]
      break;
  case "bottomright":
      dx = pw - textOffsetX;
      dy = ph - textOffsetY;
      textAnchor = inAnchors[finalIndex]
      break;
  case "center":
      dx = pw/2;
      dy = ph/2;
      textAnchor = "middle";
      break;
  case "freehand":
      x = this._x;
      y = this._y;
      final_x = x;
      final_y = y;
      textAnchor = this._textAnchor
      break;
  }

  var rotatedCoords = this.applyShapeRotation(px + pw/2, py + ph/2, x + dx, y + dy, this._rotation);
  if(final_x == undefined || final_y == undefined){
    final_x = rotatedCoords.x
    final_y = rotatedCoords.y
  }
  this._textAnchor = textAnchor;
  this._x = final_x;
  this._y = final_y;

  this.element.attr({
    x: final_x * f,
    y: final_y * f,
    fill: color,
    "fill-opacity": 1,
    "font-size": this._fontSize,
    "text": this._text,
    "text-anchor": this._textAnchor
  });

  var bbox = this.element.getBBox();

  this.bkgdRect.attr({
    x: bbox.x - 3,
    y: bbox.y - 3,
    width: bbox.width + 6,
    height: bbox.height + 6,
    fill: this._textBackgroundColor,
    "fill-opacity": this._textBackgroundOpacity
  })

  this.element.toFront()

  if(!this._inModalView){
    this.element.transform("r" + (-this._textRotation) + ", s"+(this._hFlip)+", "+(this._vFlip));
    this.bkgdRect.transform("r" + (-this._textRotation) + ", s"+(this._hFlip)+", "+(this._vFlip));
  }else{
    this.element.transform("r" + 0);
    this.bkgdRect.transform("r" + 0);
  }

  this._area = bbox.width * bbox.height;

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
  }

};

Text.prototype.applyShapeRotation = function applyShapeRotation(cx, cy, x, y, rotation){
  var dx = cx - x
  var dy = cy - y
  // distance of point from centre of rotation
  var h = Math.sqrt(dx * dx + dy * dy)
  // and the angle
  var angle1 = Math.atan2(dx, dy)

  // Add the rotation to the angle and calculate new
  // opposite and adjacent lengths from centre of rotation
  var angle2 = angle1 - rotation * Math.PI / 180
  var newo = Math.sin(angle2) * h
  var newa = Math.cos(angle2) * h
  // to give correct x and y within cropped panel
  x = cx - newo
  y = cy - newa
  return {x, y}
};

Text.prototype.getHandleCoords = function getHandleCoords() {
  var bbox = this.element.getBBox();
  var x = bbox.x,
    y = bbox.y,
    w = bbox.width,
    h = bbox.height;

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
Text.prototype.createHandles = function createHandles() {
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

      // Use dx & dy to update the location of the handle and the corresponding point of the parent
      var new_x = this.ox + dx;
      var new_y = this.oy + dy;

      self._x = new_x;
      self._y = new_y;

      self.drawShape();
      return false;
    };
  };
  var _handle_drag_start = function () {
    return function () {
      // START drag: simply note the location we started
      this.ox = this.attr("x") / self._zoomFraction;
      this.oy = this.attr("y") / self._zoomFraction;
      return false;
    };
  };
  var _handle_drag_end = function () {
    return function () {
      return false;
    };
  };

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
   //   .rotate(self._rotation, cx, cy);
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

// Class for creating Text.
var CreateText = function CreateText(options) {
  this.paper = options.paper;
  this.manager = options.manager;
}

CreateText.prototype.startDrag = function startDrag(startX, startY) {
  var textColor = this.manager.getTextColor(),
      strokeWidth = this.manager.getStrokeWidth(),
      fontSize = this.manager.getTextFontSize(),
      zoom = this.manager.getZoom(),
      inModalView = this.manager.getInModalView(),
      vFlip = this.manager.getVerticalFlip(),
      hFlip = this.manager.getHorizontalFlip(),
      textRotation = this.manager.getTextRotation(),
      textBackgroundOpacity = this.manager.getTextBackgroundOpacity(),
      textBackgroundColor = this.manager.getTextBackgroundColor(),
      originalImageShape = this.manager.getOriginalShape();

  this.manager.setText("Text")
  this.manager.setTextPosition("freehand")

  this.startX = startX;
  this.startY = startY;

  this.text = new Text({
    manager: this.manager,
    paper: this.paper,
    zoom: zoom,
    text: "Text",
    inModalView: inModalView,
    textRotation: textRotation,
    vFlip: vFlip,
    hFlip: hFlip,
    textBackgroundOpacity: textBackgroundOpacity,
    textBackgroundColor: textBackgroundColor,
    textColor: textColor,
    linkedShapeId: -1,
    x: startX,
    y: startY,
    fontSize: fontSize,
    textPosition: "freehand",
    strokeWidth: strokeWidth,
    parentShapeCoords: originalImageShape,
  })

};

CreateText.prototype.drag = function drag(dragX, dragY, shiftKey) {

};

CreateText.prototype.stopDrag = function stopDrag() {
  // on the 'new:shape' trigger, this shape will already be selected
  this.text.setSelected(true);
  this.manager.addShape(this.text);
};

CreateText.prototype.getShape = function getShape() {
  return this.text;
};

export { CreateText, Text };
