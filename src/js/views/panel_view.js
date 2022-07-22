
    // -------------------------Panel View -----------------------------------
    // A Panel is a <div>, added to the #paper by the FigureView below.
    var PanelView = Backbone.View.extend({
        tagName: "div",
        className: "imagePanel",
        template: JST["src/templates/figure_panel_template.html"],
        label_template: JST["src/templates/labels/label_template.html"],
        label_vertical_template: JST["src/templates/labels/label_vertical_template.html"],
        label_table_template: JST["src/templates/labels/label_table_template.html"],
        scalebar_template: JST["src/templates/scalebar_panel_template.html"],


        initialize: function(opts) {
            // we render on Changes in the model OR selected shape etc.
            this.model.on('destroy', this.remove, this);
            this.listenTo(this.model,
                'change:x change:y change:width change:height change:zoom change:dx change:dy change:rotation',
                this.render_layout);
            this.listenTo(this.model, 'change:scalebar change:pixel_size_x', this.render_scalebar);
            this.listenTo(this.model,
                'change:zoom change:dx change:dy change:width change:height change:channels change:theZ change:theT change:z_start change:z_end change:z_projection change:min_export_dpi',
                this.render_image);
            this.listenTo(this.model,
                'change:channels change:zoom change:dx change:dy change:rotation change:labels change:theT change:deltaT change:theZ change:deltaZ change:z_projection change:z_start change:z_end',
                this.render_labels);
            this.listenTo(this.model, 'change:shapes', this.render_shapes);

            // During drag or resize, model isn't updated, but we trigger 'drag'
            this.model.on('drag_resize', this.drag_resize, this);

            // Used for rendering labels against page_color background
            if (opts.page_color) {
                this.page_color = opts.page_color;
            }
            this.render();
        },

        events: {
            // "click .img_panel": "select_panel"
        },

        // During drag, we resize etc
        drag_resize: function(xywh) {
            var x = xywh[0],
                y = xywh[1],
                w = xywh[2],
                h = xywh[3];
            if (w == this.model.get('width') && h == this.model.get('height')) {
                // If we're only dragging - simply update position
                this.$el.css({'top': y +'px', 'left': x +'px'});
            } else {
                this.update_resize(x, y, w, h);
                this.render_shapes();
            }
            this.$el.addClass('dragging');
        },

        render_layout: function() {
            var x = this.model.get('x'),
                y = this.model.get('y'),
                w = this.model.get('width'),
                h = this.model.get('height');

            this.update_resize(x, y, w, h);
            this.$el.removeClass('dragging');
        },

        update_resize: function(x, y, w, h) {

            // update layout of panel on the canvas
            this.$el.css({'top': y +'px',
                        'left': x +'px',
                        'width': w +'px',
                        'height': h +'px'});

            // container needs to be square for rotation to vertical
            $('.left_vlabels', this.$el).css('width', 3 * h + 'px');

            // update the img within the panel
            var zoom = this.model.get('zoom'),
                vp_css = this.model.get_vp_img_css(zoom, w, h),
                svg_css = this.model.get_vp_full_plane_css(zoom, w, h),
                panel_scale = svg_css.width / this.model.get('orig_width');

            // If we're resizing a BIG image, layout can be buggy,
            // so we simply hide while resizing
            if (this.model.is_big_image()) {
                if (w !== this.model.get('width') || h !== this.model.get('height')) {
                    vp_css.width = 0;
                    vp_css.height = 0;
                }
            }

            // These two elements are siblings under imgContainer and must
            // will be exactly on top of each other for non-big images.
            this.$img_panel.css(vp_css);
            this.$panel_canvas.css(svg_css);

            // panel_canvas contains the shapeManager svg, which we zoom:
            if (this.shapeManager) {
                this.shapeManager.setZoom(panel_scale * 100);
            }

            // update length of scalebar
            var sb = this.model.get('scalebar');
            if (sb && sb.show) {
                // this.$scalebar.css('width':);
                var physical_length = sb.length;
                // convert units
                var pixel_unit = this.model.get('pixel_size_x_unit');
                var scalebar_unit = sb.units;
                var convert_factor = LENGTH_UNITS[scalebar_unit].microns / LENGTH_UNITS[pixel_unit].microns;
                var sb_pixels = convert_factor * physical_length / this.model.get('pixel_size_x');
                var sb_width = panel_scale * sb_pixels;
                this.$scalebar.css('width', sb_width);
            }
        },

        render_shapes: function() {
            var shapes = this.model.get('shapes'),
                w = this.model.get('orig_width'),
                h = this.model.get('orig_height');
            if (shapes) {
                // init shapeManager if doesn't exist
                if (!this.shapeManager) {
                    var canvasId = this.$panel_canvas.attr('id');
                    this.$panel_canvas.attr({'width': w + 'px', 'height': h + 'px'});
                    var panel_scale = this.$panel_canvas.width() / w;
                    this.shapeManager = new ShapeManager(canvasId, w, h, {'readOnly': true});
                    this.shapeManager.setZoom(panel_scale * 100);
                }
                this.shapeManager.setShapesJson(shapes);
            } else {
                // delete shapes
                if (this.shapeManager) {
                    this.shapeManager.deleteAllShapes();
                }
            }
        },

        render_image: function() {

            // For big images, layout changes will update src to render a new viewport
            // But we don't want the previous image showing while we wait...
            if (this.model.is_big_image()) {
                this.$img_panel.hide();
                $(".glyphicon-refresh", this.$el).show();
            }
            this.$img_panel.one("load", function(){
                $(".glyphicon-refresh", this.$el).hide();
                this.$img_panel.show();
            }.bind(this));

            var src = this.model.get_img_src();
            this.$img_panel.attr('src', src);

            // if a 'reasonable' dpi is set, we don't pixelate
            if (this.model.get('min_export_dpi') > 100) {
                this.$img_panel.removeClass('pixelated');
            } else {
                this.$img_panel.addClass('pixelated');
            }
        },

        render_labels: function() {

            $('.label_layout', this.$el).remove();  // clear existing labels

            var labels = this.model.get('labels'),
                self = this,
                positions = {
                    'top':[], 'bottom':[], 'left':[], 'right':[],
                    'leftvert':[],
                    'topleft':[], 'topright':[],
                    'bottomleft':[], 'bottomright':[]
                };

            // group labels by position
            _.each(labels, function(l) {
                // check if label is dynamic delta-T
                var ljson = $.extend(true, {}, l);
                // If label is same color as page (and is outside of panel)
                if (ljson.color.toLowerCase() == self.page_color.toLowerCase() &&
                        ["top", "bottom", "left", "right", "leftvert"].indexOf(l.position) > -1 ) {
                    // If black -> white, otherwise -> black
                    if (ljson.color === '000000') {
                        ljson.color = 'ffffff';
                    } else {
                        ljson.color = '000000';
                    }
                }
                const matches = [...ljson.text.matchAll(/\[.+?\]/g)]; // Non greedy regex capturing expressions in []
                if (matches.length>0){ 
                    var new_text = "";
                    var last_idx = 0;
                    for (const match of matches) {// Loops on the match to replace in the ljson.text the expression by their values
                        var new_text = new_text + ljson.text.slice(last_idx, match.index);
                        expr = match[0].slice(1,-1).split(".");
                        var label_value = ""
                        if (['time', 't'].includes(expr[0])) {
                            label_value = self.model.get_time_label_text(expr[1] ? expr[1] : "index");
                        } else if (['image', 'dataset'].includes(expr[0])){
                            label_value = self.model.get_name_label_text(expr[0], expr[1] ? expr[1] : "name");
                            //Escape the underscore for markdown
                            label_value = label_value.replaceAll("_", "\\_");
                        } else if (['x', 'y', 'z', 'width', 'height', 'w', 'h', 'rotation', 'rot'].includes(expr[0])){
                            label_value = self.model.get_view_label_text(expr[0], expr[1] ? expr[1] : "pixel");
                        } else if (['channels', 'c'].includes(expr[0])) {
                            label_value = self.model.get_channels_label_text();
                        }

                        //If label_value hasn't been created (invalid expr[0])
                        //  or is empty (invalid expr[1]), the expr is kept unmodified
                        new_text = new_text + (label_value?label_value:match[0]); 
                        last_idx = match.index + match[0].length;
                    }
                    ljson.text = new_text + ljson.text.slice(last_idx);
                }

                // Markdown also escapes all labels so they are safe
                ljson.text = markdown.toHTML(ljson.text);

                positions[l.position].push(ljson);
            });

            // Render template for each position and append to Panel.$el
            var html = "";
            _.each(positions, function(lbls, p) {
                var json = {'position':p, 'labels':lbls};
                if (lbls.length === 0) return;
                if (p == 'leftvert') {  // vertical
                    html += self.label_vertical_template(json);
                } else if (p == 'left' || p == 'right') {
                    html += self.label_table_template(json);
                } else {
                    html += self.label_template(json);
                }
            });
            self.$el.append(html);

            // need to force update of vertical labels layout
            $('.left_vlabels', self.$el).css('width', 3 * self.$el.height() + 'px');

            return this;
        },

        render_scalebar: function() {

            if (this.$scalebar) {
                this.$scalebar.remove();
            }
            var sb = this.model.get('scalebar');
            if (sb && sb.show) {
                var sb_json = {};
                sb_json.position = sb.position;
                sb_json.color = sb.color;
                sb_json.length = sb.length;
                sb_json.font_size = sb.font_size;
                sb_json.show_label = sb.show_label;
                sb_json.symbol = sb.units;

                // Use global LENGTH_UNITS to get symbol for unit.
                if (window.LENGTH_UNITS && window.LENGTH_UNITS[sb.units]){
                    sb_json.symbol = window.LENGTH_UNITS[sb.units].symbol;
                }

                var sb_html = this.scalebar_template(sb_json);
                this.$el.append(sb_html);
            }
            this.$scalebar = $(".scalebar", this.$el);

            // update scalebar size wrt current sizes
            this.render_layout();
        },

        render: function() {
            // This render() is only called when the panel is first created
            // to set up the elements. It then calls other render methods to
            // set sizes, image src, labels, scalebar etc.
            // All subsequent changes to panel attributes are handled directly
            // by other appropriate render methods.

            var json = {'randomId': 'r' + Math.random()};
            var html = this.template(json);
            this.$el.html(html);

            // cache various elements for later...
            this.$img_panel = $(".img_panel", this.$el);
            this.$imgContainer = $(".imgContainer", this.$el);
            this.$panel_canvas = $(".panel_canvas", this.$el);

            // update src, layout etc.
            this.render_image();
            this.render_labels();
            this.render_scalebar();     // also calls render_layout()

            // At this point, element is not ready for Raphael svg
            // If we wait a short time, works fine
            var self = this;
            setTimeout(function(){
                self.render_shapes();
            }, 10);

            return this;
        }
    });
