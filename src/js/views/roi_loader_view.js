
var RoiLoaderView = Backbone.View.extend({

    tagName: 'tbody',

    // We limit the number of planes you can load at once.
    // Otherwise, with shapes on every plane of image, could request many planes at once.
    NEW_PLANE_LIMIT: 10,
    newPlaneCount: 0,

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
            s.icon = this.roiIcons[s.type];
            return s;
        }.bind(this));
        var html = this.shapeTemplate({'shapes': shapesJson});
        $(".roiModalRoiItem[data-roiId='" + roiId + "']", this.$el).after(html);

        this.newPlaneCount = 0;
        shapesJson.forEach(function(s){
            var $td = $(".roiModalRoiItem[data-shapeId='" + s.id + "'] td.roiViewport", this.$el);
            if (s.icon && this.newPlaneCount < this.NEW_PLANE_LIMIT) {
                this.appendShape($td, s);
            }
            this.newPlaneCount++;
        }.bind(this));
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
            // If we haven't already rendered an image panel for this shape...
            var $element = $(".roiViewport", $tr);
            var supportedShape = this.roiIcons[shapeJson.type];
            if (supportedShape && $('.imagePanel', $element).length === 0) {
                this.appendShape($element, shapeJson);
            }
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

    // We display a shape on an image Panel using the Panel model and PanelView.
    appendShape: function($element, shape) {

        var panelJson = this.panel.toJSON();
        panelJson.width = 50;
        panelJson.height = 50;
        panelJson.x = 0;
        panelJson.y = 0;
        panelJson.shapes = [shape];
        var panelModel = new Panel(panelJson);
        if (shape.theT !== undefined) {
            panelModel.set('theT', shape.theT);
        }
        if (shape.theZ !== undefined) {
            panelModel.set('theZ', shape.theZ);
        }
        // panelModel.cropToRoi(shape);
        var view = new PanelView({model:panelModel});
        var el = view.render().el;
        $element.append(el);
        // This is kinda painful but...
        // We can't crop_to_shape_bbox until we have the view.shapeManager
        // created and populated, since we need Raphael to give us the
        // bounding box. BUT render_shapes() which creates the shapeManager
        // is called after a setTimeout of 10 millisecs, because it needs
        // DOM layout to work. So, we have to crop AFTER that (need a longer timeout!)
        setTimeout(function(){
            view.crop_to_shape_bbox();
        }, 50);
    },

    render: function() {

        var roiData = this.collection;  //.toJSON();
        this.newPlaneCount = 0;

        roiData.forEach(function(roi){
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
                    return s;
                }.bind(this));
            }

            roiJson.type = roiJson.shapes[0].type;
            roiJson.icon = roiJson.shapes[0].icon;
            roiJson.minZ = minZ;
            roiJson.maxZ = maxZ;
            roiJson.minT = minT;
            roiJson.maxT = maxT;

            // return r;
            var html = this.template({'roi': roiJson});

            this.$el.append(html);

            var $element = $("#roiModalRoiList .roiViewport").last();
            if (roiJson.shapes[0].icon && this.newPlaneCount < this.NEW_PLANE_LIMIT) {
                // Only show shape if supported type
                this.appendShape($element, roiJson.shapes[0]);
            }
            this.newPlaneCount++;

        }.bind(this));

        return this;
    }
});