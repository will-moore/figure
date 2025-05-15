
import $ from "jquery";
import _ from "underscore";
import Backbone from "backbone";
import {getRandomId} from "./util";
import roi_modal_roi_template from '../../templates/modal_dialogs/roi_modal_roi.template.html?raw';
import roi_modal_shape_template from '../../templates/modal_dialogs/roi_modal_shape.template.html?raw';

var RoiLoaderView = Backbone.View.extend({

    tagName: 'tbody',

    template: _.template(roi_modal_roi_template),
    shapeTemplate: _.template(roi_modal_shape_template),

    initialize: function(options) {
        this.render = _.debounce(this.render);
        this.totalCount = options.totalCount;
        this.panel = options.panel;
        this.listenTo(this.collection, "add", this.render);
    },

    events: {
        "mouseover .roiModalRoiItem": "mouseoverRoiItem",
        "mouseout .roiModalRoiItem": "mouseoutRoiItem",
        "click .roiModalRoiItem": "clickRoiItem",
        "click .addOmeroShape": "addOmeroShape",
    },

    roiIcons: {'Rectangle': 'rect-icon',
               'Ellipse': 'ellipse-icon',
               'Line': 'line-icon',
               'Arrow': 'arrow-icon',
               'Polygon': 'polygon-icon',
               'Point': 'point-icon',
               'Label': 'text-icon',
               'Polyline': 'polyline-icon'},

    addOmeroShape: function(event) {
        var $tr = $(event.target);
        // $tr.parentsUntil(".roiModalRoiItem")  DIDN'T work!
        // Do it manually...
        while (!$tr.hasClass("roiModalRoiItem")) {
            $tr = $tr.parent();
        }
        // If ROI has a single shape, add it
        if ($tr.attr('data-shapeId')) {
            var shapeId = parseInt($tr.attr('data-shapeId'), 10);
            var shape = this.collection.getShape(shapeId);
            var shapeJson = shape.toJSON();
            var shapeList = [shapeJson]
            if(shapeJson.type != "Text" && shapeJson.Text != undefined){
                var textRandomId = getRandomId();
                var rectRandomId = getRandomId();
                shapeJson.id = rectRandomId;
                shapeJson.textId = textRandomId;
                shapeJson.isFromOmero = true;
                var parentShapeCoords = this.getParentShapeCoords(shapeJson)
                var textShape = {
                    text: shapeJson.Text,
                    id: textRandomId,
                    x: shapeJson.x,
                    y: shapeJson.y,
                    type: "Text",
                    parentShapeCoords: parentShapeCoords,
                    linkedShapeId: rectRandomId,
                    textPosition: "top",
                    isFromOmero: true
                }
                shapeList.push(textShape)
            }
            this.collection.trigger('shape_add', shapeList.reverse());
        }
    },


    getParentShapeCoords: function(shape) {
        if(shape.type == "Point" || shape.type == "Ellipse"){
            return {x: shape.x - shape.radiusX, y: s.y - shape.radiusY, width: 2*shape.radiusX, height: 2*shape.radiusY}
        } else if (shape.type == "Rectangle"){
            return  {x:shape.x, y:shape.y, width:shape.width, height:shape.height}
        } else if(shape.type == "Line" || shape.type == "Arrow"){
           return {x:Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2),
          width: Math.abs(shape.x1 - shape.x2), height: Math.abs(shape.y1 - shape.y2)}
        } else if(shape.type == "Polygon"){
            var coords = points.split(" ");
            var xCoords = [];
            var yCoords = [];

            coords.forEach(function (s) {
                var point = s.split(",");
                xCoords.push(parseInt(point[0]));
                yCoords.push(parseInt(point[1]));
            });


            var x1 = Math.min(...xCoords)
            var x2 = Math.max(...xCoords)
            var y1 = Math.min(...yCoords)
            var y2 = Math.max(...yCoords)
            return {x:x1, y:y1,width:Math.abs(bbox.x1 - bbox.x2), height:Math.abs(bbox.y1 - bbox.y2)}
        } else {
            return undefined;
        }
    },

    removeShapes: function(roiId) {
        var roiData = this.collection.get(roiId).toJSON();
        roiData.shapes.forEach(s => {
            $(".roiModalRoiItem[data-shapeId='" + s.id + "']", this.$el).remove();
        });
    },

    renderShapes: function(roiId) {
        var roi = this.collection.get(roiId);
        var shapesJson = roi.shapes.map(function(shapeModel){
            var s = shapeModel.toJSON();
            s.tooltip = this.getTooltip(s);
            s.icon = this.roiIcons[s.type];
            return s;
        }.bind(this));
        var html = this.shapeTemplate({'shapes': shapesJson});
        $(".roiModalRoiItem[data-roiId='" + roiId + "']", this.$el).after(html);
    },

    clickRoiItem: function(event) {
        var $tr = $(event.target);
        // $tr.parentsUntil(".roiModalRoiItem")  DIDN'T work!
        // Do it manually...
        while (!$tr.hasClass("roiModalRoiItem")) {
            $tr = $tr.parent();
        }
        // If ROI has a single shape, add it
        if ($tr.attr('data-shapeId')) {
            var shapeId = parseInt($tr.attr('data-shapeId'), 10);
            var shape = this.collection.getShape(shapeId);
            var shapeJson = shape.toJSON();
            this.collection.trigger('shape_click', [shapeJson]);
        } else {
            // Otherwise toggle ROI (show/hide shapes)
            var roiId = parseInt($tr.attr('data-roiId'), 10);
            var $span = $('.toggleRoi', $tr).toggleClass('rotate90');
            if ($span.hasClass('rotate90')) {
                this.renderShapes(roiId);
            } else {
                this.removeShapes(roiId);
            }
        }
    },

    mouseoverRoiItem: function(event) {
        var $tr = $(event.target);
        while (!$tr.hasClass("roiModalRoiItem")) {
            $tr = $tr.parent();
        }
        var shapeId = parseInt($tr.attr('data-shapeId'), 10);
        this.collection.selectShape(shapeId);
    },

    mouseoutRoiItem: function(event) {
        // Simply select nothing
        this.collection.selectShape();
    },

    getTooltip: function(shape) {
        var coords = [];
        if (shape.type === 'Rectangle') {
            coords = ['x', 'y', 'width', 'height'];
        } else if (shape.type === 'Ellipse') {
            coords = ['x', 'y', 'radiusX', 'radiusY'];
        } else if (shape.type === 'Line' || shape.type == 'Arrow') {
            coords = ['x1', 'y1', 'x2', 'y2'];
        }
        coords = coords.map(function(c){
            return c + ": " + shape[c];
        });
        return 'ID: ' + shape.id + ' ' + coords.join(" ")
    },

    render: function() {

        var roiData = this.collection;  //.toJSON();
        this.newPlaneCount = 0;

        var json = roiData.map(function(roi){
            var roiJson = {id: roi.get('id'),
                           shapes: []},
                minT, maxT = 0,
                minZ, maxZ = 0;
            if (roi.shapes && roi.shapes.length > 0) {
                roiJson.shapes = roi.shapes.map(function(shapeModel){
                    var s = shapeModel.convertOMEROShape();
                    s.icon = this.roiIcons[s.type];
                    if (s.theZ !== undefined) {
                        if (minZ === undefined) {
                            minZ = s.theZ
                        } else {
                            minZ = Math.min(minZ, s.theZ);
                        }
                        maxZ = Math.max(maxZ, s.theZ);
                    }
                    if (s.theT !== undefined) {
                        if (minT === undefined) {
                            minT = s.theT
                        } else {
                            minT = Math.min(minT, s.theT);
                        }
                        maxT = Math.max(maxT, s.theT);
                    }
                    s.tooltip = this.getTooltip(s);
                    return s;
                }.bind(this));
            } else {
                return
            }

            roiJson.type = roiJson.shapes[0].type;
            roiJson.icon = roiJson.shapes[0].icon;
            roiJson.minZ = minZ;
            roiJson.maxZ = maxZ;
            roiJson.minT = minT;
            roiJson.maxT = maxT;

            return roiJson;
        }.bind(this));

        // remove any rois from above with no shapes
        json = json.filter(function(j) {return j});

        var html = this.template({
            rois: json,
            showLoadMore: this.totalCount > this.collection.length,
            totalCount: this.totalCount,
            count: this.collection.length,
        });
        this.$el.html(html);

        return this;
    }
});

export default RoiLoaderView
