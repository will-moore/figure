/*
// Copyright (C) 2017-2022 University of Dundee & Open Microscopy Environment.
// All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import {CreateText} from "./text";


const TEMP_SHAPE_ID = -1234;

var Polygon = function Polygon(options) {
  var self = this;
  this.manager = options.manager;
  this.paper = options.paper;

  if (options.id) {
    this._id = options.id;
  } else {
    this._id = this.manager.getRandomId();
  }
  this._points = options.points;
  this._bbox = this.getBBox(this._points);
  this._area = Math.abs(
    (this._bbox.x2 - this._bbox.x1) * (this._bbox.y2 - this._bbox.y1)
  );

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
  this.handle_wh = 6;

  this._textId = options.textId || -1;
  if(this._textId == -1 || this._textId == TEMP_SHAPE_ID){
    var textShape = (new CreateText({
      manager: this.manager,
      paper: this.paper,
      id: this._textId,
      zoom: options.zoom,
      text: "",
      x: options.x,
      y: options.y,
      strokeColor: options.strokeColor,
      fontSize: 12,
      textPosition: options.textPosition || "top",
      strokeWidth: this._strokeWidth,
    })).getShape();
    this._textId = textShape._id;
  }
  this._textShape = this.manager.getShape(this._textId)

  this.element = this.paper.path("");
  this.element.attr({ "fill-opacity": this._fillOpacity, fill: this._fillColor, cursor: "pointer" });

  if (this.manager.canEdit) {
    // Drag handling of element
    this.element.drag(
      function (dx, dy) {
        if (self._zoomFraction === 0) {
          return; // just in case
        }
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

  // create handles...
  this.createHandles();
  // and draw the Polygon
  this.drawShape();
};

Polygon.prototype.getBBox = function getBBox(points) {
  var coords = points.split(" ");
  var xCoords = [];
  var yCoords = [];

  coords.forEach(function (s) {
    var point = s.split(",");
    xCoords.push(parseInt(point[0]));
    yCoords.push(parseInt(point[1]));
  });

  return {
    x1: Math.min(...xCoords),
    x2: Math.max(...xCoords),
    y1: Math.min(...yCoords),
    y2: Math.max(...yCoords),
  };
};

Polygon.prototype.toJson = function toJson() {
  var rv = {
    type: "Polygon",
    points: this._points,
    area: this._area,
    strokeWidth: this._strokeWidth,
    strokeColor: this._strokeColor,
    fillColor: this._fillColor,
    fillOpacity:this._fillOpacity,
    textId: this._textId,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

Polygon.prototype.compareCoords = function compareCoords(json) {
  var selfJson = this.toJson(),
    match = true;
  if (json.type !== selfJson.type) {
    return false;
  }
  return json.points === selfJson.points;
};

// Useful for pasting json with an offset
Polygon.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.points = json.points
    .split(" ")
    .map(function (xy) {
      return xy
        .split(",")
        .map(function (c, i) {
          return parseFloat(c, 10) + [dx, dy][i];
        })
        .join(",");
    })
    .join(" ");
  return json;
};

// Shift this shape by dx and dy
Polygon.prototype.offsetShape = function offsetShape(dx, dy) {
  // Offset all coords in points string "229,171 195,214 195,265 233,33"
  var points = this._points
    .split(" ")
    .map(function (xy) {
      return xy
        .split(",")
        .map(function (c, i) {
          return parseFloat(c, 10) + [dx, dy][i];
        })
        .join(",");
    })
    .join(" ");
  this._points = points;
  this.drawShape();
};

// handle start of drag by selecting this shape
// if not already selected
Polygon.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};

Polygon.prototype.setColor = function setColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Polygon.prototype.getStrokeColor = function getStrokeColor() {
  return this._strokeColor;
};

Polygon.prototype.setStrokeColor = function setStrokeColor(strokeColor) {
  this._strokeColor = strokeColor;
  this.drawShape();
};

Polygon.prototype.setStrokeWidth = function setStrokeWidth(strokeWidth) {
  this._strokeWidth = strokeWidth;
  this.drawShape();
};

Polygon.prototype.getStrokeWidth = function getStrokeWidth() {
  return this._strokeWidth;
};

Polygon.prototype.setFillColor = function setFillColor(fillColor) {
  this._fillColor = fillColor;
  this.drawShape();
};

Polygon.prototype.getFillColor = function getFillColor() {
  return this._fillColor;
};

Polygon.prototype.setFillOpacity = function setFillOpacity(fillOpacity) {
  this._fillOpacity = fillOpacity;
  this.drawShape();
};

Polygon.prototype.getFillOpacity = function getFillOpacity() {
  return this._fillOpacity;
};

Polygon.prototype.loadTextShape = function loadTextShape(){
  this._textShape = this.manager.getShape(this._textId);
  return this._textShape;
};

Polygon.prototype.setText = function setText(text) {
  if(this._textShape){
    this._textShape.setText(text)
  }
};

Polygon.prototype.getText = function getText() {
  if(this._textShape){
    return this._textShape.getText()
  }
  return "";
};

Polygon.prototype.setTextPosition = function setTextPosition(textPosition) {
  if(this._textShape){
    this._textShape.setTextPosition(textPosition)
  }
};

Polygon.prototype.getTextPosition = function getTextPosition() {
  if(this._textShape){
    return this._textShape.getTextPosition()
  }
  return "";
};

Polygon.prototype.setFontSize = function setFontSize(fontSize) {
  if(this._textShape){
    this._textShape.setFontSize(fontSize)
  }
};

Polygon.prototype.getFontSize = function getFontSize() {
  if(this._textShape){
    return this._textShape.getFontSize()
  }
  return;
};

Polygon.prototype.getTextId = function getTextId() {
  return this._textId;
};

Polygon.prototype.setTextId = function setTextId(textId) {
  this._textId = textId;
};

Polygon.prototype.destroy = function destroy() {
  if(this._textShape){
    this.manager.deleteShapesByIds([this._textShape._id])
  }
  this.element.remove();
  this.handles.remove();
};

Polygon.prototype.intersectRegion = function intersectRegion(region) {
  // region is {x, y, width, height} - Model coords (not zoomed)
  // Compare with model coords of points...

  // Get bounding box from points...
  var coords = this._points.split(" ").reduce(function (prev, xy) {
    var x = parseInt(xy.split(",")[0], 10);
    var y = parseInt(xy.split(",")[1], 10);
    if (!prev) {
      prev = { min_x: x, min_y: y, max_x: x, max_y: y };
    } else {
      prev.min_x = Math.min(prev.min_x, x);
      prev.min_y = Math.min(prev.min_y, y);
      prev.max_x = Math.max(prev.max_x, x);
      prev.max_y = Math.max(prev.max_y, y);
    }
    return prev;
  }, undefined);

  // check for overlap - NB: this may return True even if no intersection
  // since Polygon doesn't fill it's bounding box
  if (
    coords.min_x > region.x + region.width ||
    coords.min_y > region.y + region.height ||
    coords.max_x < region.x ||
    coords.max_y < region.y
  ) {
    return false;
  }
  return true;
};

Polygon.prototype.getPath = function getPath() {
  // Convert points string "229,171 195,214 195,265 233,33"
  // to Raphael path "M229,171L195,214L195,265L233,33Z"
  // Handles scaling by zoomFraction
  var f = this._zoomFraction;
  var path = this._points
    .split(" ")
    .map(function (xy) {
      return xy
        .split(",")
        .map(function (c) {
          return parseInt(c, 10) * f;
        })
        .join(",");
    })
    .join("L");
  path = "M" + path + "Z";
  return path;
};

Polygon.prototype.isSelected = function isSelected() {
  return this._selected;
};

Polygon.prototype.setZoom = function setZoom(zoom) {
  this._zoomFraction = zoom / 100;
  this.drawShape();
};

Polygon.prototype.updateHandle = function updateHandle(
  handleIndex,
  x,
  y,
  shiftKey
) {
  var coords = this._points.split(" ");
  coords[handleIndex] = x + "," + y;
  this._points = coords.join(" ");

  if (x < this._bbox.x1) {
    this._bbox.x1 = x;
  }
  if (x > this._bbox.x2) {
    this._bbox.x2 = x;
  }
  if (y < this._bbox.y1) {
    this._bbox.y1 = y;
  }
  if (y > this._bbox.y2) {
    this._bbox.y2 = y;
  }
  this._area = Math.abs(
    (this._bbox.x2 - this._bbox.x1) * (this._bbox.y2 - this._bbox.y1)
  );
};

Polygon.prototype.drawShape = function drawShape() {
  var strokeColor = this._strokeColor,
    strokeW = this._strokeWidth,
    fillColor = this._fillColor,
    fillOpacity = this._fillOpacity;

  var f = this._zoomFraction;
  var path = this.getPath();

  this.element.attr({
    path: path,
    stroke: strokeColor,
    "stroke-width": strokeW,
    fill: fillColor,
    'fill-opacity': fillOpacity
  });

  if (this.isSelected()) {
    this.handles.show().toFront();
  } else {
    this.handles.hide();
  }

  // handles have been updated (model coords)
  var hnd, hx, hy;
  this._points.split(" ").forEach(
    function (xy, i) {
      var xy = xy.split(",");
      hx = parseInt(xy[0]) * this._zoomFraction;
      hy = parseInt(xy[1]) * this._zoomFraction;
      hnd = this.handles[i];
      hnd.attr({ x: hx - this.handle_wh / 2, y: hy - this.handle_wh / 2 });
    }.bind(this)
  );

  if(this._textShape || this.loadTextShape()){
    var x = Math.min(this._bbox.x1, this._bbox.x2)
    var y = Math.min(this._bbox.y1, this._bbox.y2)
    var width = Math.abs(this._bbox.x1 - this._bbox.x2)
    var height = Math.abs(this._bbox.y1 - this._bbox.y2)
    this._textShape.setParentShapeCoords({x: x, y: y, width: width, height: height})
  }
};

Polygon.prototype.setSelected = function setSelected(selected) {
  this._selected = !!selected;
  if(this._textShape || this.loadTextShape()){
    this._textShape.setSelected(this._selected)
  }
  this.drawShape();
};

Polygon.prototype.createHandles = function createHandles() {
  // ---- Create Handles -----

  // NB: handleIds are used to calculate coords
  // so handledIds are scaled to MODEL coords, not zoomed.

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
      self.drawShape();
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
  this._points.split(" ").forEach(function (xy, i) {
    var xy = xy.split(",");
    hx = parseInt(xy[0]);
    hy = parseInt(xy[1]);

    handle = self.paper.rect(hx - hsize / 2, hy - hsize / 2, hsize, hsize);
    handle.attr({ cursor: "move" });
    handle.h_id = i;

    if (self.manager.canEdit) {
      handle.drag(_handle_drag(), _handle_drag_start(), _handle_drag_end());
    }
    self.handles.push(handle);
  });

  self.handles.attr(handleAttrs).hide(); // show on selection
};

var Polyline = function Polyline(options) {
  var that = new Polygon(options);

  var toJ = that.toJson;
  that.toJson = function toJson() {
    var shapeJson = toJ.call(that);
    shapeJson.type = "Polyline";
    return shapeJson;
  };

  var getPolygonPath = that.getPath;
  that.getPath = function getPath() {
    var polygonPath = getPolygonPath.call(that);
    return polygonPath.replace("Z", "");
  };

  // since we've over-ridden getPath() after it is called
  // during  new Polygon(options)
  // we need to call it again!
  that.drawShape();
  return that;
};

export { Polygon, Polyline };
