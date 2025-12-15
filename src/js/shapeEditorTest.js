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

/* globals ShapeManager: false */
/* globals console: false */

import $ from "jquery";
import ShapeManager from "./shape_editor/shape_manager";
// import { rotatePoint } from "./views/util"
// Get coordinates for point x, y rotated around cx, cy, by rotation degrees
export function rotatePoint(x, y, cx, cy, rotation) {
    let length = Math.sqrt(Math.pow((x - cx), 2) + Math.pow((y - cy), 2));
    let rot = Math.atan2((y - cy), (x - cx));
    rot = rot + (rotation * (Math.PI / 180));  // degrees to rad
    let dx = Math.cos(rot) * length;
    let dy = Math.sin(rot) * length;
    return { x: cx + dx, y: cy + dy };
}


$(function () {
  var WIDTH = 512,
    HEIGHT = 512;

  var options = {};

  var shapesClipboard = [];

  // We can choose to display shapes only - No editing
  // options = {'readOnly': true};

  var shapeManager = new ShapeManager("shapesCanvas", WIDTH, HEIGHT, options);

  var zoomPercent = 100;

  // set state depending on what we want to do,
  // for example to create Rectangle

  $("input[name='state']").click(function () {
    var state = $(this).val();
    shapeManager.setState(state);
  });

  $("input[name='strokeColor']").click(function () {
    var strokeColor = $(this).val();
    shapeManager.setStrokeColor(strokeColor);
  });

  $("input[name='fillColor']").click(function () {
    var fillColor = $(this).val();
    var fillOpacity = $("select[name='fillOpacity']").val();
    shapeManager.setFillColor(fillColor);
    shapeManager.setFillOpacity(fillOpacity);
  });

  $("select[name='strokeWidth']").change(function () {
    var strokeWidth = $(this).val();
    shapeManager.setStrokeWidth(strokeWidth);
  });

  $("select[name='fillOpacity']").change(function () {
    var fillOpacity = $(this).val();
    shapeManager.setFillOpacity(fillOpacity);
  });

  $("select[name='fontSize']").change(function () {
    var fontSize = $(this).val();
    shapeManager.setFontSize(fontSize);
  });

  $("select[name='textPosition']").change(function () {
    var textPosition = $(this).val();
    shapeManager.setTextPosition(textPosition);
  });

  $("input[name='shapeScalingFraction']").on("input change", function () {
    let fraction = parseFloat($(this).val());
    $("#shapeScalingFractionDisplay").text(fraction);
    shapeManager.setShapeScalingFraction(fraction);
  });

  var updateZoom = function updateZoom() {
    $("#zoomDisplay").text(zoomPercent + " %");
    shapeManager.setZoom(zoomPercent);
    var w = (WIDTH * zoomPercent) / 100,
      h = (HEIGHT * zoomPercent) / 100;
    $(".imageWrapper img").css({ width: w, height: h });
  };

  $("button[name='zoomIn']").click(function () {
    zoomPercent += 20;
    updateZoom();
  });
  $("button[name='zoomOut']").click(function () {
    zoomPercent -= 20;
    updateZoom();
  });

  $("button[name='deleteSelected']").click(function () {
    shapeManager.deleteSelectedShapes();
  });

  $("button[name='deleteAll']").click(function () {
    shapeManager.deleteAllShapes();
  });

  $("button[name='selectAll']").click(function () {
    shapeManager.selectAllShapes();
  });

  $("button[name='copyShapes']").click(function () {
    shapesClipboard = shapeManager.getSelectedShapesJson();
  });

  $("button[name='setText']").click(function () {
    shapeManager.setText("A");
  });

  $("button[name='clearText']").click(function () {
    shapeManager.setText("");
  });

  $("button[name='pasteShapes']").click(function () {
    // paste shapes, constraining to the image coords
    var p = shapeManager.pasteShapesJson(shapesClipboard, true);
    if (!p) {
      console.log("Shape could not be pasted: outside view port");
    }
  });

  $("button[name='getShapes']").click(function () {
    var json = shapeManager.getShapesJson();
    console.log(json);
  });

  $("button[name='getBBoxes']").click(function () {
    var shapes = shapeManager.getShapesJson();
    shapes.forEach(function (shape) {
      var bbox = shapeManager.getShapeBoundingBox(shape.id);
      // Add each bbox as a Rectangle to image
      bbox.type = "Rectangle";
      bbox.strokeColor = "#ffffff";
      shapeManager.addShapeJson(bbox);
    });
  });

  $("button[name='selectShape']").click(function () {
    shapeManager.selectShapesById(1234);
  });

  var lastShapeId;
  $("button[name='deleteShapesByIds']").click(function () {
    shapeManager.deleteShapesByIds([lastShapeId]);
  });

  $("button[name='setShapes']").click(function () {
    var shapesJson = [
      {
        type: "Rectangle",
        strokeColor: "#ff00ff",
        strokeWidth: 10,
        x: 100,
        y: 250,
        width: 325,
        height: 250,
      },
      {
        type: "Ellipse",
        x: 300,
        y: 250,
        radiusX: 125,
        radiusY: 250,
        rotation: 100,
      },
    ];
    shapeManager.setShapesJson(shapesJson);
  });

  $("#shapesCanvas").bind("change:selected", function () {
    var strokeColor = shapeManager.getStrokeColor();
    if (strokeColor) {
      $("input[name='strokeColor'][value='" + strokeColor + "']").prop(
        "checked",
        "checked"
      );
    } else {
      $("input[name='strokeColor']").removeProp("checked");
    }
    var fillColor = shapeManager.getFillColor();
    if (fillColor) {
      $("input[name='fillColor'][value='" + fillColor + "']").prop('checked', 'checked');
    } else {
       $("input[name='fillColor']").removeProp('checked');
    }
    var strokeWidth = shapeManager.getStrokeWidth() || 1;
    $("select[name='strokeWidth']").val(strokeWidth);

    var fillOpacity = shapeManager.getFillOpacity() || 0.01;
    fillOpacity = (fillOpacity == 1 ? "1" : fillOpacity + ""); // to match string values in select
    $("select[name='fillOpacity']").val(fillOpacity);

    var text = shapeManager.getText() || "";
    $("input[name='shapeText']").val(text);

    var textAnchor = shapeManager.getTextAnchor();
    if (textAnchor) {
      $("select[name='textAnchor']").val(textAnchor);
    } else {
      $("select[name='textAnchor']").val("start");
    }

    var fontSize = shapeManager.getFontSize() || 12;
    $("select[name='fontSize']").val(fontSize);
    console.log({text: text, fontSize: fontSize, strokeColor, fillColor});
  });

  $("#shapesCanvas").bind("change:shape", function (event, shapes) {
    console.log("changed", shapes);
  });

  $("#shapesCanvas").bind("new:shape", function (event, shape) {
    console.log("new", shape.toJson());
    console.log("selected", shapeManager.getSelectedShapesJson());
  });

  let lastInsetTextIndex = 65;
  $("button[name='createInset']").on("click", function () {
    let textRandomId = parseInt(Math.random() * 1000);
    let rectRandomId = parseInt(Math.random() * 1000);
    // Add Rectangle - WITH Id of Text shape
    let rectSize = WIDTH / 3;
    let x = (WIDTH - rectSize) / 2;
    let y = (HEIGHT - rectSize) / 2;
    shapeManager.addShapeJson({
        type: "Rectangle",
        strokeColor: "#ffffff",
        strokeWidth: 2,
        fillOpacity: 0.01,
        x: x,
        y: y,
        width: rectSize,
        height: rectSize,
        textId: textRandomId,
        id: rectRandomId
    });
    // Add Text
    const MARGIN = 20;
    shapeManager.addShapeJson({
        type: "Text",
        fontSize: 12,
        strokeColor: "#ffffff",
        fillOpacity: 0.01,
        x: x + MARGIN,
        y: y + MARGIN,
        textAnchor: "middle",
        id: textRandomId,
        text: String.fromCharCode(lastInsetTextIndex),
    });
    lastInsetTextIndex += 1;
  });

  $("input[name='shapeText']").on("input change", function () {
    let text = $(this).val();
    shapeManager.setText(text);
  });

  $("select[name='textAnchor']").change(function () {
    let textAnchor = $(this).val();
    shapeManager.setTextAnchor(textAnchor);
  });

  $("input[name='rotateImage']").on("input change", function () {
    let angle = $(this).val();
    $("#shapesCanvas").css({
      "transform-origin": "50% 50%",
      transform: "rotate(" + angle + "deg)"
    });
    shapeManager.setTextRotation(angle);
  });

  $("input[name='rotateInset']").on("input change", function () {
    let angle = $(this).val();
    // We assume that any Rectangle with textId is an "inset" rectangle
    let shapes = shapeManager.getShapes();
    shapes.forEach(function (shape) {
      let json = shape.toJson();
      let prevRotation = shape._rotation || 0;
      if (json.type === "Rectangle" && json.textId > 0) {
        // Rotate the rectangle
        shape._rotation = angle;
        shape.drawShape();

        // Now also rotate any "text" shape - just apply the CHANGE in rotation
        let textShape = shapeManager.getShape(json.textId);
        if (textShape) {
          let txtX = textShape._x;
          let txtY = textShape._y;
          let centerX = json.x + json.width / 2;
          let centerY = json.y + json.height / 2;
          console.log("Rotating text shape around ", centerX, centerY);
          let rotatedPoint = rotatePoint(txtX, txtY, centerX, centerY, angle - prevRotation);
          textShape._x = rotatedPoint.x;
          textShape._y = rotatedPoint.y;
          textShape.drawShape();
        }
      }
    });
  });

  // Add some shapes to display
  // shapeManager.addShapeJson({"type": "Polygon",
  //                            "points": "329,271 295,314 295,365 333,432 413,400 452,350 432,292 385,256",
  //                            "strokeColor": "#ffffff",
  //                            "strokeWidth": 0.5});

  // shapeManager.addShapeJson({"type": "Polyline",
  //                            "points": "29,71 95,14 95,65 33,132 113,100 152,50",
  //                            "strokeColor": "#00ffdd",
  //                            "strokeWidth": 4});

  // shapeManager.addShapeJson({"id": 1234,
  //                            "rotation": 25,
  //                            "type": "Rectangle",
  //                            "strokeColor": "#ff00ff",
  //                            "strokeWidth": 6,
  //                            "x": 200, "y": 150,
  //                            "width": 125, "height": 150});

  // shapeManager.addShapeJson({"type": "Rectangle",
  //                            "strokeColor": "#ffffff",
  //                            "strokeWidth": 3,
  //                            "x": 50, "y": 300,
  //                            "width": 50, "height": 100});

  // shapeManager.addShapeJson({"type": "Ellipse",
  //                            "x": 200, "y": 150,
  //                            "radiusX": 125, "radiusY": 50,
  //                            "rotation": 45});

  // shapeManager.addShapeJson({"type": "Ellipse",
  //                            "strokeColor": "#ffffff",
  //                            "x": 204, "y": 260,
  //                            "radiusX": 95, "radiusY": 55,
  //                            "transform": "matrix(0.82 0.56 -0.56 0.82 183.0 -69.7)"});

  // shapeManager.addShapeJson({"type": "Arrow",
  //                            "strokeColor": "#ffff00",
  //                            "strokeWidth": 4,
  //                            "x1": 25, "y1": 450,
  //                            "x2": 200, "y2": 400});

  // shapeManager.addShapeJson({"type": "Arrow",
  //                            "strokeColor": "#ffff00",
  //                            "strokeWidth": 10,
  //                            "x1": 25, "y1": 250,
  //                            "x2": 200, "y2": 200});

  // shapeManager.addShapeJson({"type": "Ellipse",
  //                           "strokeColor": "#00ff00",
  //                           "radiusY": 31.5,
  //                           "radiusX": 91,
  //                           "transform": "matrix(2.39437435854 -0.644012141633 2.14261951162 0.765696311828 -1006.17788921 153.860479773)",
  //                           "strokeWidth": 2,
  //                           "y": 297.5,
  //                           "x": 258});

  // shapeManager.addShapeJson({"type": "Ellipse",
  //                       "strokeColor": "#ffff00",
  //                       "radiusY": 71.5,
  //                       "radiusX": 41,
  //                       "transform": "matrix(0.839800601976 0.542894970432 -0.542894970432 0.839800601976 111.894472287 -140.195845758)",
  //                       "strokeWidth": 2,
  //                       "y": 260.5,
  //                       "x": 419});

  // shapeManager.addShapeJson({"type": "Point",
  //                       "strokeWidth": 2,
  //                       "y": 30,
  //                       "x": 30});

  // var s = shapeManager.addShapeJson({"type": "Line",
  //                            "strokeColor": "#00ff00",
  //                            "strokeWidth": 2,
  //                            "x1": 400, "y1": 400,
  //                            "x2": 250, "y2": 310});
  // lastShapeId = s.toJson().id;

  shapeManager.addShapeJson({
    type: "Arrow",
    strokeColor: "#ffff00",
    strokeWidth: 10,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
  });

  shapeManager.addShapeJson({
    fontSize: 18,
    hFlip: 1,
    rotation: 0,
    showText: true,
    text: "textAnchor start",
    textAnchor: "start",
    fillColor: "#00ff00",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    textRotation: 0,
    type: "Text",
    vFlip: 1,
    x: 100,
    y: 100,
  });


  shapeManager.addShapeJson({
    type: "Arrow",
    strokeColor: "#ffff00",
    strokeWidth: 10,
    x1: 0,
    y1: 100,
    x2: 100,
    y2: 200,
  });


  var s = shapeManager.addShapeJson({
    fontSize: 18,
    text: "textAnchor middle",
    textAnchor: "middle",
    fillColor: "#ff0000",
    fillOpacity: 0.5,
    strokeColor: "#ffff00",
    textRotation: 0,
    type: "Text",
    x: 100,
    y: 200,
    // If the panel is rotated, we can calculate new x,y (text is NOT rotated)
    rotation: 0,
  });
  lastShapeId = s.toJson().id;

  // We start off in the 'SELECT' mode
  shapeManager.setState("SELECT");
});
