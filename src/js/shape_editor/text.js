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
  this.manager = options.manager;
  this.paper = options.paper;
  this._x = options.x;
  this._y = options.y;
  this._color = options.strokeColor;
  this._fontSize = options.fontSize;
  this._text = options.text;
  this._strokeWidth = options.strokeWidth || 2;
  this._textPosition = options.textPosition;

  this._id = options.id || this.manager.getRandomId();
  this._rotateText = options.rotateText || false;
  this._zoomFraction = options.zoom ? options.zoom / 100 : 1
  this._textAnchor = options.textAnchor || "start"
  this._rotation = options.rotation || 0;
  this._parentShapeCoords = options.parentShapeCoords || {x:0,y:0,width:0,height:0}

  this._selected = false;
  this._area = 0;

  this.element = this.paper.text();
  this.element.attr({"fill-opacity": 0.01, fill: "#fff"});

  this.drawShape();
};

Text.prototype.toJson = function toJson() {
  var rv = {
    type: "Text",
    x: this._x,
    y: this._y,
    fontSize: this._fontSize,
    strokeColor: this._color,
    text: this._text,
    textAnchor: this._textAnchor,
    rotation: this._rotation,
    textPosition: this._textPosition,
    parentShapeCoords: this._parentShapeCoords,
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


// handle start of drag by selecting this shape
// if not already selected
/*Text.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};*/


Text.prototype.setStrokeColor = function setStrokeColor(color) {
  this._color = color;
  this.drawShape();
};

Text.prototype.getStrokeColor = function getStrokeColor() {
  return this._color;
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

Text.prototype.setZoom = function setZoom(zoom) {
    this._zoomFraction = zoom ? zoom / 100 : 1;
   this.drawShape();
};

Text.prototype.setTextRotation = function setTextRotation(rotation) {
  this._rotation = rotation;
  this.drawShape();
};

Text.prototype.setTextRotated = function setTextRotated(rotateText) {
  /* doesn't work properly for now
  if(rotateText){
    this.element.transform("r" + this._rotation);
  }else{
    this.element.transform("r" + (-this._rotation));
  }*/
};

Text.prototype.setParentShapeCoords = function setParentShapeCoords(coords){
  this._parentShapeCoords = coords;
  this.drawShape();
};

Text.prototype.destroy = function destroy() {
  this.element.remove();
};

Text.prototype.isSelected = function isSelected() {
  return this._selected;
};

Text.prototype.setSelected = function setSelected(selected) {
  this._selected = selected;
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
  var color = this._color,
      f = this._zoomFraction,
      fontSize = this._fontSize,
      dx = 0,
      dy = 0,
      textAnchor = "middle",
      textOffsetX = (this._strokeWidth/2 + 6) / f,
      textOffsetY = (this._strokeWidth/2 + (fontSize > 12 ? fontSize/2 : 6) + 4) / f,
      x = this._parentShapeCoords.x,
      y = this._parentShapeCoords.y,
      w = this._parentShapeCoords.width,
      h = this._parentShapeCoords.height;

  switch(this._textPosition){
      case "bottom":
          dx = w/2;
          dy = h + textOffsetY;
          break;
      case "left":
          dx = -textOffsetX;
          dy = h/2;
          textAnchor = "end"
          break;
      case "right":
          dx = w + textOffsetX;
          dy = h/2;
          textAnchor = "start"
          break;
      case "top":
          dx = w/2;
          dy = -textOffsetY;
          break;
      case "topleft":
          dx = textOffsetX;
          dy = textOffsetY;
          textAnchor = "start"
          break;
      case "topright":
          dx = w - textOffsetX;
          dy = textOffsetY;
          textAnchor = "end"
          break;
      case "bottomleft":
          dx = textOffsetX;
          dy = h - textOffsetY;
          textAnchor = "start"
          break;
      case "bottomright":
          dx = w - textOffsetX;
          dy = h - textOffsetY;
          textAnchor = "end"
  }

  var rotatedCoords = this.applyTextRotation(x + w/2, y + h/2, x + dx, y + dy, this._rotation);
  this._x = rotatedCoords.x;
  this._y = rotatedCoords.y;
  this._textAnchor = textAnchor;

  this.element.attr({
    x: this._x * f,
    y: this._y * f,
    stroke: color,
    fill: color,
    "fill-opacity": 1,
    "font-size": this._fontSize,
    "text": this._text,
    "text-anchor": this._textAnchor
  });
  //this.element.transform("r" + this._rotation);
};

Text.prototype.applyTextRotation = function applyTextRotation(cx, cy, x, y, rotation){
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

// Class for creating Text.
var CreateText = function CreateText(options) {
  this.manager = options.manager

  this.text = new Text({
    manager: this.manager,
    paper: options.paper,
    zoom: options.zoom,
    text: options.text,
    x: options.x,
    y: options.y,
    strokeColor: options.strokeColor,
    fontSize: options.fontSize,
    textPosition: options.textPosition,
    strokeWidth: options.strokeWidth,
  //  rotation: options.rotation,
  })
  this.text.setSelected(true);
  this.manager.addShape(this.text);
};

CreateText.prototype.getShape = function getShape() {
  return this.text;
};

export { CreateText, Text };
