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



var Text = function Text(options) {
  //var self = this;
  this.manager = options.manager;
  this.paper = options.paper;

  if (options.id) {
    this._id = options.id;
  } else {
    this._id = this.manager.getRandomId();
  }
  this._x = options.x;
  this._y = options.y;
  //this._rotation = options.rotation || 0;

  this._color = options.color;
  this._fontSize = options.fontSize || 10;
  this._text = options.text || "";
  this._textAnchor = "start"

  this._zoomFraction = 1;
  if (options.zoom) {
    this._zoomFraction = options.zoom / 100;
  }
  /*if (options.area) {
    this._area = options.area;
  } else {
    this._area = this._radiusX * this._radiusY * Math.PI;
  }*/

  this.element = this.paper.text();
  this.element.attr({ "fill-opacity": 0.01, fill: "#fff"});
  this.drawShape();

 /* // Drag handling of point
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
  this.drawShape();*/
};

Text.prototype.toJson = function toJson() {
  var rv = {
    type: "Text",
    x: this._x,
    y: this._y,
    fontSize: this._fontSize,
    color: this._color,
    text: this._text,
  };
  if (this._id) {
    rv.id = this._id;
  }
  return rv;
};

/*Text.prototype.compareCoords = function compareCoords(json) {
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
};*/

// Useful for pasting json with an offset
/*Text.prototype.offsetCoords = function offsetCoords(json, dx, dy) {
  json.x = json.x + dx;
  json.y = json.y + dy;
  return json;
};*/


// handle start of drag by selecting this shape
// if not already selected
/*Text.prototype._handleMousedown = function _handleMousedown() {
  if (!this._selected) {
    this.manager.selectShapes([this]);
  }
};*/

Text.prototype.setColor = function setColor(color) {
  this._color = color;
  this.drawShape();
};

Text.prototype.getColor = function getColor() {
  return this._color;
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

Text.prototype.setTextPosition = function setTextPosition(x, y, textAnchor) {
    this._x = x;
    this._y = y;
    this._textAnchor = textAnchor;
    this.drawShape();
};


Text.prototype.setZoom = function setZoom(zoom) {
    this._zoomFraction = zoom / 100;
    this.drawShape();
};

Text.prototype.destroy = function destroy() {
  this.element.remove();
};

/*Text.prototype.intersectRegion = function intersectRegion(region) {
  var path = this.manager.regionToPath(region, this._zoomFraction * 100);
  var f = this._zoomFraction,
    x = parseInt(this._x * f, 10),
    y = parseInt(this._y * f, 10);

  return Raphael.isTextInsidePath(path, x, y);
};

Text.prototype.getPath = function getPath() {
  // Adapted from https://github.com/poilu/raphael-boolean
  var a = this.element.attrs,
    radiusX = a.radiusX,
    radiusY = a.radiusY,
    cornerTexts = [
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
      path.push(["M", cornerTexts[0][0], cornerTexts[0][1] + radiusY]);
    }

    //insert "curveto" (radius factor .446 is taken from Inkscape)
    var c1 = [
      cornerTexts[i][0] + radiusShift[i][0][0] * radiusX * 0.446,
      cornerTexts[i][1] + radiusShift[i][0][1] * radiusY * 0.446,
    ];
    var c2 = [
      cornerTexts[i][0] + radiusShift[i][1][0] * radiusX * 0.446,
      cornerTexts[i][1] + radiusShift[i][1][1] * radiusY * 0.446,
    ];
    var p2 = [
      cornerTexts[i][0] + radiusShift[i][1][0] * radiusX,
      cornerTexts[i][1] + radiusShift[i][1][1] * radiusY,
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

Text.prototype.isSelected = function isSelected() {
  return this._selected;
};*/



/*Text.prototype.updateHandle = function updateHandle(
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

Text.prototype.updateShapeFromHandles = function updateShapeFromHandles(
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
};*/

Text.prototype.drawShape = function drawShape() {
  var color = this._color,
    fontSize = this._fontSize,
    text = this._text,
    textAnchor = this._textAnchor;

  var f = this._zoomFraction,
    x = this._x * f,
    y = this._y * f;

  this.element.attr({
    x: x,
    y: y,
    stroke: color,
    fill: color,
    "fill-opacity": 1,
    "font-size": fontSize,
    "text": text,
    "text-anchor": textAnchor
  });
  //this.element.transform("r" + this._rotation);

 /* if (this.isSelected()) {
    this.handles.show().toFront();
  } else {
    this.handles.hide();
  }*/

  // handles have been updated (model coords)
  /*this._handleIds = this.getHandleCoords();
  var hnd, h_id, hx, hy;
  for (var h = 0, l = this.handles.length; h < l; h++) {
    hnd = this.handles[h];
    h_id = hnd.h_id;
    hx = this._handleIds[h_id].x * this._zoomFraction;
    hy = this._handleIds[h_id].y * this._zoomFraction;
    hnd.attr({ x: hx - this.handle_wh / 2, y: hy - this.handle_wh / 2 });
  }*/
};

/*Text.prototype.setSelected = function setSelected(selected) {
  this._selected = !!selected;
  this.drawShape();
};*/

/*Text.prototype.createHandles = function createHandles() {
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
  // simply to indicate that the Text is selected
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

Text.prototype.getHandleCoords = function getHandleCoords() {
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
};*/

// Class for creating Text.
/*var CreateText = function CreateText(options) {
  this.paper = options.paper;
  this.manager = options.manager;
};

CreateText.prototype.startDrag = function startDrag(startX, startY) {
  var strokeColor = this.manager.getStrokeColor(),
    strokeWidth = this.manager.getStrokeWidth(),
    zoom = this.manager.getZoom();

  this.point = new Text({
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
  });
};

CreateText.prototype.drag = function drag(dragX, dragY, shiftKey) {
  // no drag behaviour on Text creation
};

CreateText.prototype.stopDrag = function stopDrag() {
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
*/
export { Text };
