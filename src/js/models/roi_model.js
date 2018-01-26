
var ShapeModel = Backbone.Model.extend({

    parse: function(shape) {
        var lowerFirst = function(text) {
            return text[0].toLowerCase() + text.slice(1);
        }
        var rgbint_to_css = function(signed_integer) {
            if (signed_integer < 0) signed_integer = signed_integer >>> 0;
            var intAsHex = signed_integer.toString(16);
            intAsHex = ("00000000" + intAsHex).slice(-8);
            return '#' + intAsHex.substring(0,6);
        }
        shape.id = shape['@id'];
        shape.type = shape['@type'].split('#')[1];
        delete shape['@id']
        delete shape['@type']
        // StrokeWidth - unwrap 'pixel' unit
        if (shape.StrokeWidth) {
            shape.strokeWidth = shape.StrokeWidth.Value;
            delete shape['StrokeWidth'];
        }
        // handle colors:
        _.each(["StrokeColor", "FillColor", ], function(attr) {
            if (shape[attr] !== undefined) {
                shape[lowerFirst(attr)] = rgbint_to_css(shape[attr]);
                delete shape[attr];
            }
        });
        // Convert other attributes
        _.each(["MarkerEnd", "MarkerStart", "X", "Y", "RadiusX", "RadiusY", "X1", "Y1", "X2", "Y2", "Width", "Height", "TheZ", "TheT"], function(attr) {
            if (shape[attr] !== undefined) {
                shape[lowerFirst(attr)] = shape[attr];
                delete shape[attr];
            }
        });
        // Handle Arrows...
        if (shape.markerEnd === 'Arrow' || shape.markerStart === 'Arrow') {
            shape.type = 'Arrow';
            if (shape.markerEnd !== 'Arrow') {
                // Only marker start is arrow - reverse direction!
                var tmp = {'x1': shape.x1, 'y1': shape.y1, 'x2': shape.x2, 'y2': shape.y2};
                shape.x1 = tmp.x2;
                shape.y1 = tmp.y2;
                shape.x2 = tmp.x1;
                shape.y2 = tmp.y1;
            }
        }
        return shape;
    },

    convertOMEROShape: function() {
        // Converts a shape json from OMERO into format taken by Shape-editor
        // if shape has Arrow head, shape.type = Arrow
        var s = this.toJSON();
        if (s.markerEnd === 'Arrow' || s.markerStart === 'Arrow') {
            s.type = 'Arrow';
            if (s.markerEnd !== 'Arrow') {
                // Only marker start is arrow - reverse direction!
                var tmp = {'x1': s.x1, 'y1': s.y1, 'x2': s.x2, 'y2': s.y2};
                s.x1 = tmp.x2;
                s.y1 = tmp.y2;
                s.x2 = tmp.x1;
                s.y2 = tmp.y1;
            }
        }
        if (s.type === 'Ellipse') {
            // If we have < OMERO 5.3, Ellipse has cx, cy, rx, ry
            if (s.rx !== undefined) {
                s.x = s.cx;
                s.y = s.cy;
                s.radiusX = s.rx;
                s.radiusY = s.ry;
            }
        }
        return s;
    },
});

var ShapeList = Backbone.Collection.extend({
    model: ShapeModel
});

var RoiModel = Backbone.Model.extend({

    initialize: function(data) {
        this.set('id', data['@id']);
        this.shapes = new ShapeList(data.shapes, {'parse': true});
    }
});

var RoiList = Backbone.Collection.extend({
    // url: ROIS_JSON_URL + iid + "/",
    model: RoiModel,

    deselectShapes: function(){
        this.forEach(function(roi){
            roi.shapes.forEach(function(s){
                if (s.get('selected')) {
                    s.set('selected', false)
                }
            });
        });
    },

    selectShape: function(shapeId){
        var shape,
            shapeJson;
        this.forEach(function(roi){
            roi.shapes.forEach(function(s){
                if (s.get('id') === shapeId) {
                    s.set('selected');
                }
            });
        });
        shape = this.getShape(shapeId);
        if (shape) {
            shapeJson = shape.toJSON();
        }
        this.trigger('change:selection', [shapeJson]);
    },

    getShape: function(shapeId){
        var shape;
        this.forEach(function(roi){
            var s = roi.shapes.get(shapeId);
            if (s) {
                shape = s;
            }
        });
        return shape;
    }
});