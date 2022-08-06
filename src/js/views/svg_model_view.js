
    // -------------- Selection Overlay Views ----------------------

    import Backbone from "backbone";
    import $ from "jquery";
    import Raphael from "raphael";

    // SvgView uses ProxyRectModel to manage Svg Rects (raphael)
    // This converts between zoomed coordiantes of the html DOM panels
    // and the unzoomed SVG overlay.
    // Attributes of this model apply to the SVG canvas and are updated from
    // the PanelModel.
    // The SVG RectView (Raphael) notifies this Model via trigger 'drag' & 'dragStop'
    // and this is delegated to the PanelModel via trigger or set respectively.

    // Used by a couple of different models below
    var getModelCoords = function(coords) {
        var zoom = this.figureModel.get('curr_zoom') * 0.01,
            size = this.figureModel.getFigureSize(),
            paper_top = (this.figureModel.get('canvas_height') - size.h)/2,
            paper_left = (this.figureModel.get('canvas_width') - size.w)/2,
            x = (coords.x/zoom) - paper_left - 1,
            y = (coords.y/zoom) - paper_top - 1,
            w = coords.width/zoom,
            h = coords.height/zoom;
        return {'x':x>>0, 'y':y>>0, 'width':w>>0, 'height':h>>0};
    };

    var ProxyRectModel = Backbone.Model.extend({

        initialize: function(opts) {
            this.panelModel = opts.panel;    // ref to the genuine PanelModel
            this.figureModel = opts.figure;

            this.renderFromModel();

            // Refresh c
            this.listenTo(this.figureModel, 'change:curr_zoom change:paper_width change:paper_height change:page_count', this.renderFromModel);
            this.listenTo(this.panelModel, 'change:x change:y change:width change:height', this.renderFromModel);
            // when PanelModel is being dragged, but NOT by this ProxyRectModel...
            this.listenTo(this.panelModel, 'drag_resize', this.renderFromTrigger);
            this.listenTo(this.panelModel, 'change:selected', this.renderSelection);
            this.panelModel.on('destroy', this.clear, this);
            // listen to a trigger on this Model (triggered from Rect)
            this.listenTo(this, 'drag_xy', this.drag_xy);
            this.listenTo(this, 'drag_xy_stop', this.drag_xy_stop);
            this.listenTo(this, 'drag_resize', this.drag_resize);
            // listen to change to this model - update PanelModel
            this.listenTo(this, 'drag_resize_stop', this.drag_resize_stop);

            // reduce coupling between this and rect by using triggers to handle click.
            this.bind('clicked', function(args) {
                this.handleClick(args[0]);
            });
        },

        // return the SVG x, y, w, h (converting from figureModel)
        getSvgCoords: function(coords) {
            var zoom = this.figureModel.get('curr_zoom') * 0.01,
                size = this.figureModel.getFigureSize(),
                paper_top = (this.figureModel.get('canvas_height') - size.h)/2,
                paper_left = (this.figureModel.get('canvas_width') - size.w)/2,
                rect_x = (paper_left + 1 + coords.x) * zoom,
                rect_y = (paper_top + 1 + coords.y) * zoom,
                rect_w = coords.width * zoom,
                rect_h = coords.height * zoom;
            return {'x':rect_x, 'y':rect_y, 'width':rect_w, 'height':rect_h};
        },

        // return the Model x, y, w, h (converting from SVG coords)
        getModelCoords: getModelCoords,

        // called on trigger from the RectView, on drag of the whole rect OR handle for resize.
        // we simply convert coordinates and delegate to figureModel
        drag_xy: function(xy, save) {
            var zoom = this.figureModel.get('curr_zoom') * 0.01,
                dx = xy[0]/zoom,
                dy = xy[1]/zoom;

            this.figureModel.drag_xy(dx, dy, save);
        },

        // As above, but this time we're saving the changes to the Model
        drag_xy_stop: function(xy) {
            this.drag_xy(xy, true);
        },

        // Called on trigger from the RectView on resize. 
        // Need to convert from Svg coords to Model and notify the PanelModel without saving.
        drag_resize: function(xywh) {
            var coords = this.getModelCoords({'x':xywh[0], 'y':xywh[1], 'width':xywh[2], 'height':xywh[3]});
            this.panelModel.drag_resize(coords.x, coords.y, coords.width, coords.height);
        },

        // As above, but need to update the Model on changes to Rect (drag stop etc)
        drag_resize_stop: function(xywh) {
            var coords = this.getModelCoords({'x':xywh[0], 'y':xywh[1], 'width':xywh[2], 'height':xywh[3]});
            this.panelModel.save(coords);
        },

        // Called when the FigureModel zooms or the PanelModel changes coords.
        // Refreshes the RectView since that listens to changes in this ProxyModel
        renderFromModel: function() {
            this.set( this.getSvgCoords({
                'x': this.panelModel.get('x'),
                'y': this.panelModel.get('y'),
                'width': this.panelModel.get('width'),
                'height': this.panelModel.get('height')
            }) );
        },

        // While the Panel is being dragged (by the multi-select Rect), we need to keep updating
        // from the 'multiselectDrag' trigger on the model. RectView renders on change
        renderFromTrigger:function(xywh) {
            var c = this.getSvgCoords({
                'x': xywh[0],
                'y': xywh[1],
                'width': xywh[2],
                'height': xywh[3]
            });
            this.set( this.getSvgCoords({
                'x': xywh[0],
                'y': xywh[1],
                'width': xywh[2],
                'height': xywh[3]
            }) );
        },

        // When PanelModel changes selection - update and RectView will render change
        renderSelection: function() {
            this.set('selected', this.panelModel.get('selected'));
        },

        // Handle click (mousedown) on the RectView - changing selection.
        handleClick: function(event) {
            if (event.shiftKey) {
                this.figureModel.addSelected(this.panelModel);
            } else {
                this.figureModel.setSelected(this.panelModel);
            }
        },

        clear: function() {
            this.destroy();
        }

    });


    // This model underlies the Rect that is drawn around multi-selected panels
    // (only shown if 2 or more panels selected)
    // On drag or resize, we calculate how to move or resize the seleted panels.
    var MultiSelectRectModel = ProxyRectModel.extend({

        defaults: {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        },

        initialize: function(opts) {
            this.figureModel = opts.figureModel;

            // listen to a trigger on this Model (triggered from Rect)
            this.listenTo(this, 'drag_xy', this.drag_xy);
            this.listenTo(this, 'drag_xy_stop', this.drag_xy_stop);
            this.listenTo(this, 'drag_resize', this.drag_resize);
            this.listenTo(this, 'drag_resize_stop', this.drag_resize_stop);
            this.listenTo(this.figureModel, 'change:selection', this.updateSelection);
            this.listenTo(this.figureModel, 'change:curr_zoom change:paper_height change:paper_width',
                    this.updateSelection);

            // also listen for drag_xy coming from a selected panel
            this.listenTo(this.figureModel, 'drag_xy', this.update_xy);
        },


        // Need to re-draw on selection AND zoom changes
        updateSelection: function() {

            var selected = this.figureModel.getSelected();
            if (selected.length < 1){

                this.set({
                    'x': 0,
                    'y': 0,
                    'width': 0,
                    'height': 0,
                    'selected': false
                });
                return;
            }

            var max_x = 0,
                max_y = 0;

            selected.forEach(function(panel){
                var x = panel.get('x'),
                    y = panel.get('y'),
                    w = panel.get('width'),
                    h = panel.get('height');
                max_x = Math.max(max_x, x+w);
                max_y = Math.max(max_y, y+h);
            });

            min_x = selected.getMin('x');
            min_y = selected.getMin('y');



            this.set( this.getSvgCoords({
                'x': min_x,
                'y': min_y,
                'width': max_x - min_x,
                'height': max_y - min_y
            }) );

            // Rect SVG will be notified and re-render
            this.set('selected', true);
        },


        // Called when we are notified of drag_xy on one of the Panels
        update_xy: function(dxdy) {
            if (! this.get('selected')) return;     // if we're not visible, ignore

            var svgCoords = this.getSvgCoords({
                'x': dxdy[0],
                'y': dxdy[1],
                'width': 0,
                'height': 0,
            });
            this.set({'x':svgCoords.x, 'y':svgCoords.y});
        },

        // RectView drag is delegated to Panels to update coords (don't save)
        drag_xy: function(dxdy, save) {
            // we just get [x,y] but we need [x,y,w,h]...
            var x = dxdy[0] + this.get('x'),
                y = dxdy[1] + this.get('y');
            var xywh = [x, y, this.get('width'), this.get('height')];
            this.notifyModelofDrag(xywh, save);
        },

        // As above, but Save is true since we're done dragging
        drag_xy_stop: function(dxdy, save) {
            this.drag_xy(dxdy, true);
            // Have to keep our proxy model in sync
            this.set({
                'x': dxdy[0] + this.get('x'),
                'y': dxdy[1] + this.get('y')
            });
        },

        // While the multi-select RectView is being dragged, we need to calculate the new coords
        // of all selected Panels, based on the start-coords and the current coords of
        // the multi-select Rect.
        drag_resize: function(xywh, save) {
            this.notifyModelofDrag(xywh, save);
        },

        // RectView dragStop is delegated to Panels to update coords (with save 'true')
        drag_resize_stop: function(xywh) {
            this.notifyModelofDrag(xywh, true);

            this.set({
                'x': xywh[0],
                'y': xywh[1],
                'width': xywh[2],
                'height': xywh[3]
            });
        },

        // While the multi-select RectView is being dragged, we need to calculate the new coords
        // of all selected Panels, based on the start-coords and the current coords of
        // the multi-select Rect.
        notifyModelofDrag: function(xywh, save) {
            var startCoords = this.getModelCoords({
                'x': this.get('x'),
                'y': this.get('y'),
                'width': this.get('width'),
                'height': this.get('height')
            });
            var dragCoords = this.getModelCoords({
                'x': xywh[0],
                'y': xywh[1],
                'width': xywh[2],
                'height': xywh[3]
            });

            // var selected = this.figureModel.getSelected();
            // for (var i=0; i<selected.length; i++) {
            //     selected[i].multiselectdrag(startCoords.x, startCoords.y, startCoords.width, startCoords.height,
            //         dragCoords.x, dragCoords.y, dragCoords.width, dragCoords.height, save);
            this.figureModel.multiselectdrag(startCoords.x, startCoords.y, startCoords.width, startCoords.height,
                    dragCoords.x, dragCoords.y, dragCoords.width, dragCoords.height, save);
            // };
        },

        // Ignore mousedown
        handleClick: function(event) {

        }
    });

    // var ProxyRectModelList = Backbone.Collection.extend({
    //     model: ProxyRectModel
    // });

    var SvgView = Backbone.View.extend({

        initialize: function(opts) {

            var self = this,
                canvas_width = this.model.get('canvas_width'),
                canvas_height = this.model.get('canvas_height');
            this.figureModel = this.model;  // since getModelCoords() expects this.figureModel

            // Create <svg> canvas
            this.raphael_paper = Raphael("canvas_wrapper", canvas_width, canvas_height);

            // this.panelRects = new ProxyRectModelList();
            self.$dragOutline = $("<div style='border: dotted #0a0a0a 1px; position:absolute; z-index:1'></div>")
                .appendTo("#canvas_wrapper");
            self.outlineStyle = self.$dragOutline.get(0).style;


            // Add global mouse event handlers
            self.dragging = false;
            self.drag_start_x = 0;
            self.drag_start_y = 0;
            $("#canvas_wrapper>svg")
                .mousedown(function(event){
                    self.dragging = true;
                    var parentOffset = $(this).parent().offset();
                    //or $(this).offset(); if you really just want the current element's offset
                    self.left = self.drag_start_x = event.pageX - parentOffset.left;
                    self.top = self.drag_start_y = event.pageY - parentOffset.top;
                    self.dx = 0;
                    self.dy = 0;
                    self.$dragOutline.css({
                            'left': self.drag_start_x,
                            'top': self.drag_start_y,
                            'width': 0,
                            'height': 0
                        }).show();
                    // return false;
            })
                .mousemove(function(event){
                    if (self.dragging) {
                        var parentOffset = $(this).parent().offset();
                        //or $(this).offset(); if you really just want the current element's offset
                        self.left = self.drag_start_x;
                        self.top = self.drag_start_y;
                        self.dx = event.pageX - parentOffset.left - self.drag_start_x;
                        self.dy = event.pageY - parentOffset.top - self.drag_start_y;
                        if (self.dx < 0) {
                            self.left = self.left + self.dx;
                            self.dx = Math.abs(self.dx);
                        }
                        if (self.dy < 0) {
                            self.top = self.top + self.dy;
                            self.dy = Math.abs(self.dy);
                        }
                        self.$dragOutline.css({
                            'left': self.left,
                            'top': self.top,
                            'width': self.dx,
                            'height': self.dy
                        });
                        // .show();
                        // self.outlineStyle.left = left + 'px';
                        // self.outlineStyle.top = top + 'px';
                        // self.outlineStyle.width = dx + 'px';
                        // self.outlineStyle.height = dy + 'px';
                    }
                    // return false;
            })
                .mouseup(function(event){
                    if (self.dragging) {
                        self.handleClick(event);
                        self.$dragOutline.hide();
                    }
                    self.dragging = false;
                    // return false;
            });

            // If a panel is added...
            this.model.panels.on("add", this.addOne, this);
            this.listenTo(this.model, 'change:curr_zoom', this.renderZoom);

            var multiSelectRect = new MultiSelectRectModel({figureModel: this.model}),
                rv = new RectView({'model':multiSelectRect, 'paper':this.raphael_paper,
                        'handle_wh':7, 'handles_toFront': true, 'fixed_ratio': true});
            rv.selected_line_attrs = {'stroke-width': 1, 'stroke':'#4b80f9'};

            // set svg size for current window and zoom
            this.renderZoom();
        },

        // A panel has been added - We add a corresponding Raphael Rect 
        addOne: function(m) {

            var rectModel = new ProxyRectModel({panel: m, figure:this.model});
            new RectView({'model':rectModel, 'paper':this.raphael_paper,
                    'handle_wh':5, 'disable_handles': true, 'fixed_ratio': true});
        },

        // TODO
        remove: function() {
            // TODO: remove from svg, remove event handlers etc.
        },

        // We simply re-size the Raphael svg itself - Shapes have their own zoom listeners
        renderZoom: function() {
            var zoom = this.model.get('curr_zoom') * 0.01,
                newWidth = this.model.get('canvas_width') * zoom,
                newHeight = this.model.get('canvas_height') * zoom;

            this.raphael_paper.setSize(newWidth, newHeight);
        },

        getModelCoords: getModelCoords,

        // Any mouse click (mouseup) or dragStop that isn't captured by Panel Rect clears selection
        handleClick: function(event) {
            if (!event.shiftKey) {
                this.model.clearSelected();
            }
            // select panels overlapping with drag outline
            if (this.dx > 0 || this.dy > 0) {
                var coords = this.getModelCoords({x: this.left, y: this.top, width:this.dx, height:this.dy});
                this.model.selectByRegion(coords);
            }
        }
    });

    export default SvgView
