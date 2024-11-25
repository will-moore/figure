/*
// Copyright (C) 2015 University of Dundee & Open Microscopy Environment.
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
import $ from "jquery";

import { CreateRect, Rect } from "./rect";
import { CreateLine, Line, CreateArrow, Arrow } from "./line";
import { CreateEllipse, Ellipse } from "./ellipse";
import { CreatePoint, Point } from "./point";
import { Polygon, Polyline } from "./polygon";
import { Text } from "./text";
var ShapeManager = function ShapeManager(elementId, width, height, options) {
  var self = this;
  options = options || {};

  // Keep track of state, strokeColor etc
  this.STATES = ["SELECT", "RECT", "LINE", "ARROW", "ELLIPSE", "POLYGON", "POINT"];
  this._state = "SELECT";
  this._strokeColor = "#ff0000";
  this._strokeWidth = 2;
  this._text = "";
  this._textFontSize = 12;
  this._textPosition = "top";
  this._rotateText = false;
  this._orig_width = width;
  this._orig_height = height;
  this._zoom = 100;
  // Don't allow editing of shapes - no drag/click events
  this.canEdit = !options.readOnly;

  // Set up Raphael paper...
  this.paper = Raphael(elementId, width, height);

  // jQuery element used for .offset() etc.
  this.$el = $("#" + elementId);

  // Store all the shapes we create
  this._shapes = [];

  // Add a full-size background to cover existing shapes while
  // we're creating new shapes, to stop them being selected.
  // Mouse events on this will bubble up to svg and are handled below
  this.newShapeBg = this.paper.rect(0, 0, width, height);
  this.newShapeBg.attr({
    fill: "#000",
    "fill-opacity": 0.01,
    "stroke-width": 0,
    cursor: "default",
  });
  this.selectRegion = this.paper.rect(0, 0, width, height);
  this.selectRegion
    .hide()
    .attr({ stroke: "#ddd", "stroke-width": 0, "stroke-dasharray": "- " });
  if (this.canEdit) {
    this.newShapeBg.drag(
      function () {
        self.drag.apply(self, arguments);
      },
      function () {
        self.startDrag.apply(self, arguments);
      },
      function () {
        self.stopDrag.apply(self, arguments);
      }
    );

    this.shapeFactories = {
      RECT: new CreateRect({ manager: this, paper: this.paper }),
      ELLIPSE: new CreateEllipse({ manager: this, paper: this.paper }),
      LINE: new CreateLine({ manager: this, paper: this.paper }),
      ARROW: new CreateArrow({ manager: this, paper: this.paper }),
      POINT: new CreatePoint({ manager: this, paper: this.paper }),
    };

    this.createShape = this.shapeFactories.LINE;
  } else {
    this.shapeFactories = {};
  }
};

ShapeManager.prototype.startDrag = function startDrag(x, y, event) {
  // clear any existing selected shapes
  this.clearSelectedShapes();

  var offset = this.$el.offset(),
    startX = x - offset.left,
    startY = y - offset.top;

  if (this.getState() === "SELECT") {
    this._dragStart = { x: startX, y: startY };

    this.selectRegion.attr({ x: startX, y: startY, width: 0, height: 0 });
    this.selectRegion.toFront().show();
  } else {
    // create a new shape with X and Y
    // createShape helper can get other details itself

    // correct for zoom before passing coordinates to shape
    var zoomFraction = this._zoom / 100;
    startX = startX / zoomFraction;
    startY = startY / zoomFraction;
    this.createShape.startDrag(startX, startY);
  }

  // Move this in front of new shape so that drag events don't get lost to the new shape
  this.newShapeBg.toFront();
};

ShapeManager.prototype.drag = function drag(dx, dy, x, y, event) {
  var offset = this.$el.offset(),
    dragX = x - offset.left,
    dragY = y - offset.top;

  if (this.getState() === "SELECT") {
    (dx = this._dragStart.x - dragX), (dy = this._dragStart.y - dragY);

    this.selectRegion.attr({
      x: Math.min(dragX, this._dragStart.x),
      y: Math.min(dragY, this._dragStart.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    });
  } else {
    // correct for zoom before passing coordinates to shape
    var zoomFraction = this._zoom / 100,
      shiftKey = event.shiftKey;
    dragX = dragX / zoomFraction;
    dragY = dragY / zoomFraction;
    this.createShape.drag(dragX, dragY, shiftKey);
  }
};

ShapeManager.prototype.stopDrag = function stopDrag(x, y, event) {
  if (this.getState() === "SELECT") {
    // need to get MODEL coords (correct for zoom)
    var region = this.selectRegion.attr(),
      f = this._zoom / 100,
      sx = region.x / f,
      sy = region.y / f,
      width = region.width / f,
      height = region.height / f;
    this.selectShapesByRegion({ x: sx, y: sy, width: width, height: height });

    // Hide region and move drag listening element to back again.
    this.selectRegion.hide();
    this.newShapeBg.toBack();
  } else {
    this.createShape.stopDrag();
  }
};

ShapeManager.prototype.setState = function setState(state) {
  if (this.STATES.indexOf(state) === -1) {
    console.log("Invalid state: ", state, "Needs to be in", this.STATES);
    return;
  }
  // When creating shapes, cover existing shapes with newShapeBg
  var shapes = ["RECT", "LINE", "ARROW", "ELLIPSE", "POLYGON", "POINT"];
  if (shapes.indexOf(state) > -1) {
    this.newShapeBg.toFront();
    this.newShapeBg.attr({ cursor: "crosshair" });
    // clear selected shapes
    this.clearSelectedShapes();

    if (this.shapeFactories[state]) {
      this.createShape = this.shapeFactories[state];
    }
  } else if (state === "SELECT") {
    // Used to handle drag-select events
    this.newShapeBg.toBack();
    this.newShapeBg.attr({ cursor: "default" });
  }

  this._state = state;
};

ShapeManager.prototype.getState = function getState() {
  return this._state;
};

ShapeManager.prototype.setZoom = function setZoom(zoomPercent) {
  // var zoom = this.shapeEditor.get('zoom');

  // var $imgWrapper = $(".image_wrapper"),
  //     currWidth = $imgWrapper.width(),
  //     currHeight = $imgWrapper.height(),
  //     currTop = parseInt($imgWrapper.css('top'), 10),
  //     currLeft = parseInt($imgWrapper.css('left'), 10);

  // var width = 512 * zoom / 100,
  //     height = 512 * zoom / 100;
  // $("#shapeCanvas").css({'width': width + "px", 'height': height + "px"});

  this._zoom = zoomPercent;
  // Update the svg and our newShapeBg.
  // $("svg").css({'width': width + "px", 'height': height + "px"});
  var width = (this._orig_width * zoomPercent) / 100,
    height = (this._orig_height * zoomPercent) / 100;
  this.paper.setSize(width, height);
  this.paper.canvas.setAttribute("viewBox", "0 0 " + width + " " + height);
  this.newShapeBg.attr({ width: width, height: height });

  // zoom the shapes
  this._shapes.forEach(function (shape) {
    shape.setZoom(zoomPercent);
  });

  // // image
  // $(".image_wrapper").css({'width': width + "px", 'height': height + "px"});
  // // offset
  // var deltaTop = (height - currHeight) / 2,
  //     deltaLeft = (width - currWidth) / 2;
  // $(".image_wrapper").css({'left': (currLeft - deltaLeft) + "px",
  //                          'top': (currTop - deltaTop) + "px"});
};

ShapeManager.prototype.getZoom = function getZoom(zoomPercent) {
  return this._zoom;
};

ShapeManager.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setStrokeColor(strokeColor);
  }
};

ShapeManager.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

ShapeManager.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  strokeWidth = parseFloat(strokeWidth, 10);
  this._strokeWidth = strokeWidth;
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setStrokeWidth(strokeWidth);
  }
};

ShapeManager.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

ShapeManager.prototype.getText = function getText() {
  return this._text;
};

ShapeManager.prototype.setText = function setText(text) {
  this._text = text;
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setText(text);
  }
};

ShapeManager.prototype.getTextFontSize = function getTextFontSize() {
  return this._textFontSize;
};

ShapeManager.prototype.setTextFontSize = function setTextFontSize(fontSize) {
  fontSize = parseFloat(fontSize, 10);
  this._textFontSize = fontSize;
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setFontSize(fontSize);
  }
};

ShapeManager.prototype.getTextPosition = function getTextPosition() {
  return this._textPosition;
};

ShapeManager.prototype.setTextPosition = function setTextPosition(position) {
  this._textPosition = position;
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setTextPosition(position);
  }
};

ShapeManager.prototype.getTextRotated = function getTextRotated() {
  return this._rotateText;
};

ShapeManager.prototype.setTextRotated = function setTextRotated(rotateText) {
  this._rotateText = rotateText === "true";
  var selected = this.getSelectedShapes();
  for (var s = 0; s < selected.length; s++) {
    selected[s].setTextRotated(rotateText);
  }
};

ShapeManager.prototype.getShapesJson = function getShapesJson() {
  var data = [];
  this.getShapes().forEach(function (s) {
    data.push(s.toJson());
  });
  return data;
};

ShapeManager.prototype.setShapesJson = function setShapesJson(jsonShapes) {
  this.deleteAllShapes();
  var self = this;
  jsonShapes.forEach(function (s) {
    self.addShapeJson(s);
  });
};

ShapeManager.prototype.regionToPath = function regionToPath(region, zoom) {
  var f = zoom ? zoom / 100 : this._zoom / 100,
    x = parseInt(region.x * f, 10),
    y = parseInt(region.y * f, 10),
    width = parseInt(region.width * f, 10),
    height = parseInt(region.height * f, 10);

  return [
    ["M" + x + "," + y],
    ["L" + (x + width) + "," + y],
    ["L" + (x + width) + "," + (y + height)],
    ["L" + x + "," + (y + height) + "Z"],
  ].join(",");
};

ShapeManager.prototype.findShapeAtCoords = function findShapeAtCoords(
  jsonShape
) {
  var thisShapes = this.getShapes();
  for (var i = 0; i < thisShapes.length; i++) {
    if (thisShapes[i].compareCoords(jsonShape)) {
      return thisShapes[i];
    }
  }
  return false;
};

// Add new shapes from json but, IF it matches existing shape - offset a bit
ShapeManager.prototype.pasteShapesJson = function pasteShapesJson(
  jsonShapes,
  constrainRegion
) {
  var self = this,
    newShapes = [],
    allPasted = true;
  // For each shape we want to paste...
  jsonShapes.forEach(function (sh) {
    // Create a shape to resolve any transform matrix -> coords
    var csh = $.extend(true, {}, sh);
    if(csh.type !== "Text"){
      csh.textId = -1
    }
    var temp = self.createShapeJson(csh);
    var s = temp.toJson();
    temp.destroy();
    if(s.type !== "Text"){
      // check if a shape is at the same coordinates...
      var match = self.findShapeAtCoords(s);
      // if so, keep offsetting until we find a spot...
      while (match) {
        s = $.extend({}, s);
        s = match.offsetCoords(s, 20, 10);
        match = self.findShapeAtCoords(s);
      }
      // Create shape and test if it's in the specified region
      var added = self.addShapeJson(s, constrainRegion);
      if (added) {
        newShapes.push(added);
      } else {
        allPasted = false;
      }
    }
  });
  // Select the newly added shapes
  this.selectShapes(newShapes);
  return allPasted;
};

ShapeManager.prototype.addShapesJson = function addShapesJson(
  jsonShapes,
  constrainRegion
) {
  var allAdded = true;
  jsonShapes.forEach(
    function (s) {
      var added = this.addShapeJson(s, constrainRegion);
      if (!added) {
        allAdded = false;
      }
    }.bind(this)
  );
  return allAdded;
};

// Create and add a json shape object
// Use constrainRegion {x, y, width, height} to enforce if it's in the specified region
// constrainRegion = true will use the whole image plane
// Return false if shape didn't get created
ShapeManager.prototype.addShapeJson = function addShapeJson(
  jsonShape,
  constrainRegion
) {
  var newShape = this.createShapeJson(jsonShape);
  if (!newShape) {
    return;
  }
  if (constrainRegion) {
    if (typeof constrainRegion === "boolean") {
      constrainRegion = {
        x: 0,
        y: 0,
        width: this._orig_width,
        height: this._orig_height,
      };
    }
    if (!newShape.intersectRegion(constrainRegion)) {
      newShape.destroy();
      return false;
    }
  }
  this._shapes.push(newShape);
  this.sortShape(this._shapes);
  return newShape;
};

// Create a Shape object from json
ShapeManager.prototype.createShapeJson = function createShapeJson(jsonShape) {
  var s = jsonShape,
    newShape,
    strokeColor = s.strokeColor || this.getStrokeColor(),
    strokeWidth = s.strokeWidth || this.getStrokeWidth(),
    fontSize = s.fontSize || this.getTextFontSize(),
    textPosition = s.textPosition || this.getTextPosition(),
    text = s.text || this.getText(),
    textId = s.textId || -1,
    zoom = this.getZoom(),
    options = {
      manager: this,
      paper: this.paper,
      strokeWidth: strokeWidth,
      zoom: zoom,
      strokeColor: strokeColor,
      textId: textId,
    };
  if (jsonShape.id) {
    options.id = jsonShape.id;
  }

  if (s.type === "Ellipse") {
    options.x = s.x;
    options.y = s.y;
    options.radiusX = s.radiusX;
    options.radiusY = s.radiusY;
    options.rotation = s.rotation || 0;
    options.transform = s.transform;
    options.area = s.radiusX * s.radiusY * Math.PI;
    newShape = new Ellipse(options);
  } else if (s.type === "Point") {
    options.x = s.x;
    options.y = s.y;
    options.area = 0;
    newShape = new Point(options);
  } else if (s.type === "Rectangle") {
    options.x = s.x;
    options.y = s.y;
    options.width = s.width;
    options.height = s.height;
    options.area = s.width * s.height;
    options.rotation = s.rotation;
    newShape = new Rect(options);
  } else if (s.type === "Line") {
    options.x1 = s.x1;
    options.y1 = s.y1;
    options.x2 = s.x2;
    options.y2 = s.y2;
    options.area = Math.abs((s.x2 - s.x1) * (s.y2 - s.y1));
    newShape = new Line(options);
  } else if (s.type === "Arrow") {
    options.x1 = s.x1;
    options.y1 = s.y1;
    options.x2 = s.x2;
    options.y2 = s.y2;
    options.area = Math.abs((s.x2 - s.x1) * (s.y2 - s.y1));
    newShape = new Arrow(options);
  } else if (s.type === "Polygon") {
    options.points = s.points;
    newShape = new Polygon(options);
  } else if (s.type === "Polyline") {
    options.points = s.points;
    newShape = new Polyline(options);
  } else if (s.type === "Text") {
    options.x = s.x || 0,
    options.y = s.y || 0,
    options.fontSize = fontSize,
    options.textPosition = textPosition,
    options.text = text,
    options.textAnchor = s.textAnchor,
    options.parentShapeCoords = s.parentShapeCoords,
    newShape = new Text(options);
  }
  return newShape;
};

// Add a shape object
ShapeManager.prototype.addShape = function addShape(shape) {
  this._shapes.push(shape);
  this.sortShape(this._shapes);
  this.$el.trigger("new:shape", [shape]);
};

ShapeManager.prototype.sortShape = function sortShape(shapes) {
  shapes.sort(function (a, b) {
    var x = a._area;
    var y = b._area;
    if (x == undefined) {
      x = Number.MAX_SAFE_INTEGER;
    }
    if (y == undefined) {
      y = Number.MAX_SAFE_INTEGER;
    }
    return x < y ? -1 : x > y ? 1 : 0;
  });

  shapes.reverse().forEach(function (s) {
    s.element.toFront();
  });
  // If we're in drawing state (not in "SELECT" state) we need to keep
  // the draw layer on top
  if (this.state != "SELECT") {
    this.newShapeBg.toFront();
  }
};

ShapeManager.prototype.getShapes = function getShapes() {
  return this._shapes;
};

ShapeManager.prototype.getShape = function getShape(shapeId) {
  var shapes = this.getShapes();
  for (var i = 0; i < shapes.length; i++) {
    if (shapes[i]._id === shapeId) {
      return shapes[i];
    }
  }
};

ShapeManager.prototype.getSelectedShapes = function getSelectedShapes() {
  var selected = [],
    shapes = this.getShapes();
  for (var i = 0; i < shapes.length; i++) {
    if (shapes[i].isSelected()) {
      selected.push(shapes[i]);
    }
  }
  return selected;
};

ShapeManager.prototype.getSelectedShapesJson = function getShapesJson() {
  var data = [];
  this.getShapes().forEach(function (s) {
    if (s.isSelected()) {
      data.push(s.toJson());
    }
  });
  return data;
};

ShapeManager.prototype.getShapeBoundingBox = function getShapeBoundingBox(
  shapeId
) {
  var shape = this.getShape(shapeId);
  var bbox = shape.element.getBBox();
  var zoomFraction = this.getZoom() / 100;
  return {
    x: bbox.x / zoomFraction,
    y: bbox.y / zoomFraction,
    width: bbox.width / zoomFraction,
    height: bbox.height / zoomFraction,
  };
};

// Shift all selected shapes by x and y
// E.g. while dragging multiple shapes
ShapeManager.prototype.moveSelectedShapes = function moveSelectedShapes(
  dx,
  dy,
  silent
) {
  this.getSelectedShapes().forEach(function (shape) {
    shape.offsetShape(dx, dy);
  });
};

ShapeManager.prototype.deleteAllShapes = function deleteAllShapes() {
  this.getShapes().forEach(function (s) {
    s.destroy();
  });
  this._shapes = [];
  this.$el.trigger("change:selected");
};

ShapeManager.prototype.deleteShapesByIds = function deleteShapesByIds(
  shapeIds
) {
  var notSelected = [];
  this.getShapes().forEach(function (s) {
    if (shapeIds.indexOf(s._id) > -1) {
      s.destroy();
    } else {
      notSelected.push(s);
    }
  });
  this._shapes = notSelected;
  this.$el.trigger("change:selected");
};

ShapeManager.prototype.deleteSelectedShapes = function deleteSelectedShapes() {
  var notSelected = [];
  this.getShapes().forEach(function (s) {
    if (s.isSelected()) {
      s.destroy();
    } else {
      notSelected.push(s);
    }
  });
  this._shapes = notSelected;
  this.$el.trigger("change:selected");
};

ShapeManager.prototype.selectShapesById = function selectShapesById(shapeId) {
  // Clear selected with silent:true, since we notify again below
  this.clearSelectedShapes(true);
  var toSelect = [];
  this.getShapes().forEach(function (shape) {
    if (shape.toJson().id === shapeId) {
      toSelect.push(shape);
    }
  });
  this.selectShapes(toSelect);
};

ShapeManager.prototype.clearSelectedShapes = function clearSelectedShapes(
  silent
) {
  for (var i = 0; i < this._shapes.length; i++) {
    this._shapes[i].setSelected(false);
  }
  if (!silent) {
    this.$el.trigger("change:selected");
  }
};

ShapeManager.prototype.selectShapesByRegion = function selectShapesByRegion(
  region
) {
  // Clear selected with silent:true, since we notify again below
  this.clearSelectedShapes(true);

  var toSelect = [];
  this.getShapes().forEach(function (shape) {
    if (shape.intersectRegion(region)) {
      toSelect.push(shape);
    }
  });
  this.selectShapes(toSelect);
};

ShapeManager.prototype.selectAllShapes = function selectAllShapes(region) {
  this.selectShapes(this.getShapes());
};

// select shapes: 'shape' can be shape object or ID
ShapeManager.prototype.selectShapes = function selectShapes(shapes) {
  var strokeColor, strokeWidth;

  // Clear selected with silent:true, since we notify again below
  this.clearSelectedShapes(true);

  // Each shape, set selected and get color & stroke width...
  shapes.forEach(function (shape, i) {
    if (typeof shape === "number") {
      shape = this.getShape(shape);
    }
    if (shape) {
      // for first shape, pick color
      if (strokeColor === undefined) {
        strokeColor = shape.getStrokeColor();
      } else {
        // for subsequent shapes, if colors don't match - set false
        if (strokeColor !== shape.getStrokeColor()) {
          strokeColor = false;
        }
      }
      // for first shape, pick strokeWidth
      if (strokeWidth === undefined) {
        strokeWidth = shape.getStrokeWidth();
      } else {
        // for subsequent shapes, if colors don't match - set false
        if (strokeWidth !== shape.getStrokeWidth()) {
          strokeWidth = false;
        }
      }
      shape.setSelected(true);
    }
  });
  if (strokeColor) {
    this._strokeColor = strokeColor;
  }
  if (strokeWidth) {
    this._strokeWidth = strokeWidth;
  }
  this.$el.trigger("change:selected");
};

ShapeManager.prototype.notifySelectedShapesChanged =
  function notifySelectedShapesChanged() {
    this.notifyShapesChanged(this.getSelectedShapes());
  };

ShapeManager.prototype.notifyShapesChanged = function notifyShapesChanged(
  shapes
) {
  this.sortShape(this._shapes);
  this.$el.trigger("change:shape", [shapes]);
};

ShapeManager.prototype.getRandomId = function getRandomId() {
  // returns a random integer we can use for id
  // NB - we use negative numbers to distinguish from server-side IDs
  var rndString = Math.random() + ""; // E.g. 0.7158358106389642
  return -parseInt(rndString.slice(2), 10); // -7158358106389642
};

export default ShapeManager;
