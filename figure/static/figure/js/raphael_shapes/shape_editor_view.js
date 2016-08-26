

var ShapeEditorView = Backbone.View.extend({

        el: $("#body"),


        initialize: function(options) {

            // Now set up Raphael paper...
            this.paper = ScaleRaphael("shapeCanvas", 512, 512);


            // var testRect = this.paper.rect(256, 256, 125, 125);
            // testRect.attr({'stroke-width': 2, 'stroke': '#ff0'});

            // this.paper.scaleAll(2);
            // var width = 1024,
            //     height = 1024;
            // $("#shapeCanvas").css({'width': width + "px", 'height': height + "px"});
            // $("svg").css({'width': width + "px", 'height': height + "px"});
            // // this.paper.setSize(width, height);
            // this.paper.canvas.setAttribute("viewBox", "0 0 "+width+" "+height);

            // Add a full-size background to cover existing shapes while
            // we're creating new shapes, to stop them being selected. 
            // Mouse events on this will bubble up to svg and are handled below
            this.newShapeBg = this.paper.rect(0, 0, 512, 512);
            this.newShapeBg.attr({'fill':'#000', 'fill-opacity':0.01, 'cursor': 'crosshair'});

            this.shapeEditor = options.shapeEditor;
            this.listenTo(this.shapeEditor, 'change:state', this.updateState);
            this.listenTo(this.shapeEditor, 'change:zoom', this.updateZoom);

            this.updateState();
            // $(".new_shape_layer", this.el).hide();
        },

        events: {
            "mousedown svg": "mousedown",
            "mousemove svg": "mousemove",
            "mouseup svg": "mouseup"
        },

        keyboardEvents: {
            'backspace': 'deleteSelectedShapes',
            // 'mod+c': 'copy_selected_panels',
            // 'mod+v': 'paste_panels',
            // 'down' : 'nudge_down',
            // 'up' : 'nudge_up',
            // 'left' : 'nudge_left',
            // 'right' : 'nudge_right',
        },

        updateZoom: function() {
            var zoom = this.shapeEditor.get('zoom');

            var $imgWrapper = $(".image_wrapper"),
                currWidth = $imgWrapper.width(),
                currHeight = $imgWrapper.height(),
                currTop = parseInt($imgWrapper.css('top'), 10),
                currLeft = parseInt($imgWrapper.css('left'), 10);

            var width = 512 * zoom / 100,
                height = 512 * zoom / 100;
            $("#shapeCanvas").css({'width': width + "px", 'height': height + "px"});

            // Update the svg and our newShapeBg.
            $("svg").css({'width': width + "px", 'height': height + "px"});
            this.paper.canvas.setAttribute("viewBox", "0 0 "+width+" "+height);
            this.newShapeBg.attr({'width': width, 'height': height});

            // image 
            $(".image_wrapper").css({'width': width + "px", 'height': height + "px"});
            // offset
            var deltaTop = (height - currHeight) / 2,
                deltaLeft = (width - currWidth) / 2;
            $(".image_wrapper").css({'left': (currLeft - deltaLeft) + "px",
                                     'top': (currTop - deltaTop) + "px"});
        },

        deleteSelectedShapes: function() {
            this.shapeEditor.deleteSelectedShapes();
            return false;
        },

        updateState: function() {
            // When creating shapes, cover existing shapes with newShapeBg
            var state = this.shapeEditor.get('state'),
                shapes = ["RECT", "LINE", "ARROW", "ELLIPSE"];
            if (shapes.indexOf(state) > -1) {
                this.newShapeBg.show().toFront();
            } else {
                this.newShapeBg.hide();
            }
        },

        mousedown: function(event) {
            // clear any existing selected shapes
            this.model.clearSelected();
            this.cropModel = undefined;

            // Create a new Rect, and start resizing it...
            this.dragging = true;
            var os = $(event.target).offset();
            var dx = event.clientX - os.left;
            var dy = event.clientY - os.top;
            this.clientX_start = dx;
            this.clientY_start = dy;

            // create a new shape using the current toolbar color
            var color = this.shapeEditor.get('color');
            var state = this.shapeEditor.get('state');
            var lineWidth = this.shapeEditor.get('lineWidth');
            var zoom = this.shapeEditor.get('zoom');
            dx = dx * 100 / zoom;
            dy = dy * 100 / zoom;

            if (state == "RECT") {
                this.cropModel = new Shape({
                    'type': state, 'x':dx, 'y': dy, 'width': 0, 'height': 0,
                    'selected': false, 'color': color, 'lineWidth': lineWidth});
                this.rect = new RectView({'model':this.cropModel, 'paper': this.paper, 'attrs':{'stroke-width':2}});
            } else if (state === "LINE" || state === "ARROW") {
                this.cropModel = new EllipseModel({'type': state, 'zoom': zoom,
                    'x1': dx, 'y1': dy, 'x2': dx, 'y2': dy,
                    'color': color, 'stroke-width': lineWidth});
                if (state === "ARROW") {
                    this.line = new ArrowView({'model': this.cropModel, 'paper': this.paper});
                } else {
                    this.line = new LineView({'model': this.cropModel, 'paper': this.paper});
                }
            } else if (state === "ELLIPSE") {
                this.cropModel = new EllipseModel({'type': state,
                    'cx': dx, 'cy': dy, 'rx': 0, 'ry': 50, 'rotation': 0,
                    'color': color, 'stroke-width': lineWidth});
                this.ellipse = new EllipseView({'model': this.cropModel, 'paper': this.paper});
            }
            // Move this in front of new shape so that drag events don't get lost to the new shape
            this.newShapeBg.toFront();
            return false;
        },

        mouseup: function(event) {
            if (this.dragging) {
                this.dragging = false;
                if (!this.cropModel) return;

                var state = this.shapeEditor.get('state');
                // If shapes are zero-sized, destroy.
                if (state === "RECT") {
                    if (this.cropModel.get('width') === 0 || this.cropModel.get('height') === 0) {
                        this.cropModel.destroy();
                        return false;
                    }
                } else if (state === "LINE" || state === "ARROW") {
                    if(this.cropModel.get('x1') === this.cropModel.get('x2') &&
                        this.cropModel.get('y1') === this.cropModel.get('y2')) {
                        this.cropModel.destroy();
                        return false;
                    }
                } else if (state === "ELLIPSE") {
                    if (this.ellipse.rx === 0) {
                        this.cropModel.destroy();
                        return false;
                    }
                    this.cropModel.set({'cx':this.ellipse.cx,
                                        'cy':this.ellipse.cy,
                                        'rx':this.ellipse.rx,
                                        'ry':this.ellipse.ry,});
                }
                // otherwise add to collection
                this.cropModel.set('selected', true);
                this.model.add(this.cropModel);
                return false;
            }
        },

        mousemove: function(event) {
            if (this.dragging) {
                var os = $(event.target).offset(),
                    absX = event.clientX - os.left,
                    absY = event.clientY - os.top,
                    dx = absX - this.clientX_start,
                    dy = absY - this.clientY_start;

                var zoom = this.shapeEditor.get('zoom');
                absX = absX * 100 / zoom;
                absY = absY * 100 / zoom;

                if (event.shiftKey) {
                    // make region square!
                    if (Math.abs(dx) > Math.abs(dy)) {
                        if (dy > 0) dy = Math.abs(dx);
                        else dy = -1 * Math.abs(dx);
                    } else {
                        if (dx > 0) dx = Math.abs(dy);
                        else dx = -1 * Math.abs(dy);
                    }
                }
                var negX = Math.min(0, dx),
                    negY = Math.min(0, dy);

                var state = this.shapeEditor.get('state');
                if (state === "RECT") {
                    this.cropModel.set({'x': this.clientX_start + negX,
                        'y': this.clientY_start + negY,
                        'width': Math.abs(dx), 'height': Math.abs(dy)});
                } else if (state === "LINE" || state === "ARROW") {
                    this.cropModel.set({'x2': absX, 'y2': absY});
                } else if (state === "ELLIPSE") {
                    this.ellipse.updateHandle('end', absX, absY);
                    // this.cropModel.set({'x2': absX, 'y2': absY});
                }
                return false;
            }
        }
    });
