
var RoiLoaderView = Backbone.View.extend({

    tagName: 'tbody',

    template: JST["src/templates/modal_dialogs/roi_modal_roi.html"],
    shapeTemplate: JST["src/templates/modal_dialogs/roi_modal_shape.html"],

    initialize: function(options) {
        this.panel = options.panel;
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
               'Arrow': 'arrow-icon'},

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
            this.collection.trigger('shape_add', [shapeJson]);
        }
    },

    removeShapes: function(roiId) {
        var roiData = this.collection.get(roiId).toJSON();
        roiData.shapes.forEach(function(s){
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
        return coords.map(function(c){
            return c + ": " + shape[c];
        }).join(" ");
    },

    render: function() {

        var roiData = this.collection;  //.toJSON();
        this.newPlaneCount = 0;

        var json = roiData.map(function(roi){
            var roiJson = {id: roi.get('id'),
                           shapes: []},
                minT, maxT = 0,
                minZ, maxZ = 0;
            if (roi.shapes) {
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
            }

            roiJson.type = roiJson.shapes[0].type;
            roiJson.icon = roiJson.shapes[0].icon;
            roiJson.minZ = minZ;
            roiJson.maxZ = maxZ;
            roiJson.minT = minT;
            roiJson.maxT = maxT;

            return roiJson;
        }.bind(this));

        var html = this.template({'rois': json});
        this.$el.html(html);

        return this;
    }
});