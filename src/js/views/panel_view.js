
    import Backbone from "backbone";
    import _ from "underscore";
    import $ from "jquery";
    import * as marked from "marked";
    import DOMPurify from 'dompurify';
    import ShapeManager from "../shape_editor/shape_manager";

    import figure_panel_template from '../../templates/figure_panel.template.html?raw';
    import label_template from '../../templates/labels/label.template.html?raw';
    import label_vertical_template from '../../templates/labels/label_vertical.template.html?raw';
    import label_right_vertical_template from '../../templates/labels/label_right_vertical.template.html?raw';
    import label_table_template from '../../templates/labels/label_table.template.html?raw';
    import scalebar_panel_template from '../../templates/scalebar_panel.template.html?raw';
    import colorbar_panel_template from '../../templates/colorbar.template.html?raw';
    import FigureLutPicker from "../views/lutpicker";

    // -------------------------Panel View -----------------------------------
    // A Panel is a <div>, added to the #paper by the FigureView below.
    var PanelView = Backbone.View.extend({
        tagName: "div",
        className: "imagePanel",
        template: _.template(figure_panel_template),
        label_template: _.template(label_template),
        label_vertical_template: _.template(label_vertical_template),
        label_right_vertical_template: _.template(label_right_vertical_template),
        label_table_template: _.template(label_table_template),
        scalebar_template: _.template(scalebar_panel_template),
        colorbar_template: _.template(colorbar_panel_template),

        initialize: function(opts) {
            // we render on Changes in the model OR selected shape etc.
            this.model.on('destroy', this.remove, this);
            this.listenTo(this.model,
                'change:x change:y change:width change:height change:zoom change:dx change:dy change:rotation change:vertical_flip change:horizontal_flip',
                this.render_layout);
            this.listenTo(this.model, 'change:scalebar change:pixel_size_x', this.render_scalebar);
            this.listenTo(this.model, 'change:colorbar change:channels', this.render_colorbar);
            this.listenTo(this.model,
                'change:zoom change:dx change:dy change:width change:height change:channels change:theZ change:theT change:z_start change:z_end change:z_projection change:min_export_dpi change:pixel_range change:vertical_flip change:horizontal_flip',
                this.render_image);
            this.listenTo(this.model,
                'change:channels change:zoom change:dx change:dy change:width change:height change:rotation change:labels change:theT change:deltaT change:theZ change:deltaZ change:z_projection change:z_start change:z_end',
                this.render_labels);
            this.listenTo(this.model, 'change:shapes change:rotation change:vertical_flip change:horizontal_flip', this.render_shapes);
            this.listenTo(this.model, 'change:border', this.render_layout);
            // During drag or resize, model isn't updated, but we trigger 'drag'
            this.model.on('drag_resize', this.drag_resize, this);

            // Used for rendering labels against page_color background
            if (opts.page_color) {
                this.page_color = opts.page_color;
            }
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
                var border = this.model.get('border');
                if (border?.showBorder) {
                    let sw = border.strokeWidth;
                    x = x - sw
                    y = y - sw
                }
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
            this.render_labels();
            this.$el.removeClass('dragging');
        },

        update_resize: function(x, y, w, h) {

            // If we have a panel border, need to adjust x,y,w,h on the page
            // but NOT the w & h we use for img_css below.
            var border = this.model.get('border');
            var page_w = w;
            var page_h = h;
            if (border?.showBorder) {
                let sw = border.strokeWidth;
                this.$el.css({'border': `solid ${sw}px ${border.color}`})
                x = x - sw;
                y = y - sw;
                page_w = w + (sw * 2);
                page_h = h + (sw * 2);
            } else {
                this.$el.css({'border': ''})
            }

            // update layout of panel on the canvas
            this.$el.css({'top': y +'px',
                        'left': x +'px',
                        'width': page_w +'px',
                        'height': page_h +'px'});

            // container needs to be square for rotation to vertical
            $('.left_vlabels', this.$el).css('width', 3 * page_h + 'px');
            $('.right_vlabels', this.$el).css('width', 3 * page_h + 'px');

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
            var cb = this.model.get('colorbar');
            if (cb && cb.show && (cb.position == "left" || cb.position == "right") && this.$colorbar) {
                this.$colorbar.css('width', h);
                this.$colorbar.css('height', h);
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
                this.shapeManager.setTextRotation(this.model.get('rotation'));
                this.shapeManager.setHorizontalFlip(this.model.get('horizontal_flip') ? -1 : 1);
                this.shapeManager.setVerticalFlip(this.model.get('vertical_flip') ? -1 : 1);
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
                $(".image_panel_spinner", this.$el).show();
            }
            this.$img_panel.one("load", function(){
                $(".image_panel_spinner", this.$el).hide();
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
                    'leftvert':[],'rightvert':[],
                    'topleft':[], 'topright':[],
                    'bottomleft':[], 'bottomright':[]
                };

            // group labels by position
            _.each(labels, function(l) {
                // check if label is dynamic delta-T
                var ljson = $.extend(true, {}, l);
                // If label is same color as page (and is outside of panel)
                if (ljson.color.toLowerCase() == self.page_color.toLowerCase() &&
                        ["top", "bottom", "left", "right", "leftvert", "rightvert"].indexOf(l.position) > -1 ) {
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

                        // Label parsing in three steps:
                        //   - split label type.format from other parameters (;)
                        //   - split label type and format (.)
                        //   - grab other parameters (key=value)
                        var expr = match[0].slice(1,-1).split(";");
                        var prop_nf = expr[0].trim().split(".");
                        var param_dict = {};
                        expr.slice(1).forEach(function(value) {
                            var kv = value.split("=");
                            if (kv.length > 1) {
                                param_dict[kv[0].trim()] = parseInt(kv[1].trim());
                            }
                        });

                        var label_value = "",
                            format, precision;
                        if (['time', 't'].includes(prop_nf[0])) {
                            format = prop_nf[1] ? prop_nf[1] : "index";
                            precision = param_dict["precision"] !== undefined ? param_dict["precision"] : 0; // decimal places default to 0
                            label_value = self.model.get_time_label_text(format, param_dict["offset"], precision);
                        } else if (['image', 'dataset'].includes(prop_nf[0])){
                            format = prop_nf[1] ? prop_nf[1] : "name";
                            label_value = self.model.get_name_label_text(prop_nf[0], format);
                            //Escape the underscore for markdown
                            label_value = label_value.replaceAll("_", "\\_");
                        } else if (['x', 'y', 'z', 'width', 'height', 'w', 'h', 'rotation', 'rot'].includes(prop_nf[0])){
                            format = prop_nf[1] ? prop_nf[1] : "pixel";
                            precision = param_dict["precision"] !== undefined ? param_dict["precision"] : 2; // decimal places default to 2
                            label_value = self.model.get_view_label_text(prop_nf[0], format, param_dict["offset"], precision);
                        } else if (['channels', 'c'].includes(prop_nf[0])) {
                            label_value = self.model.get_channels_label_text();
                        } else if (['zoom'].includes(prop_nf[0])) {
                            label_value = self.model.get_zoom_label_text();
                        }

                        //If label_value hasn't been created (invalid prop_nf[0])
                        //  or is empty (invalid prop_nf[1]), the expression is kept intact
                        new_text = new_text + (label_value ? label_value : match[0]);
                        last_idx = match.index + match[0].length;
                    }
                    ljson.text = new_text + ljson.text.slice(last_idx);
                }

                ljson.text = DOMPurify.sanitize(marked.parse(ljson.text));

                positions[l.position].push(ljson);
            });

            // Render template for each position and append to Panel.$el
            var html = "";
            _.each(positions, function(lbls, p) {
                var json = {'position':p, 'labels':lbls};
                if (lbls.length === 0) return;
                if (p == 'leftvert') {  // vertical
                    html += self.label_vertical_template(json);
                } else if (p == 'rightvert') {
                    html += self.label_right_vertical_template(json);
                } else if (p == 'left' || p == 'right') {
                    html += self.label_table_template(json);
                } else {
                    html += self.label_template(json);
                }
            });
            self.$el.append(html);

            // need to force update of vertical labels layout
            $('.left_vlabels', self.$el).css('width', 3 * self.$el.height() + 'px');
            $('.right_vlabels', self.$el).css('width', 3 * self.$el.height() + 'px');

            var border = this.model.get('border')
            if(border?.showBorder){
                var margin =  5 + border.strokeWidth
                $('.left_vlabels>div', self.$el).css('margin-bottom', margin + 'px');
                $('.right_vlabels>div', self.$el).css('margin-bottom', margin + 'px');
                $('.label_top', self.$el).css('margin-bottom', margin + 'px');
                $('.label_bottom', self.$el).css('margin-top', margin + 'px');
                $('.label_left', self.$el).css('margin-right', margin + 'px');
                $('.label_right', self.$el).css('margin-left', margin + 'px');
            }else{
                $('.left_vlabels>div', self.$el).css('margin-bottom', '5px');
                $('.right_vlabels>div', self.$el).css('margin-bottom', '5px');
                $('.label_top', self.$el).css('margin-bottom', '5px');
                $('.label_bottom', self.$el).css('margin-top', '5px');
                $('.label_left', self.$el).css('margin-right', '5px');
                $('.label_right', self.$el).css('margin-left', '5px');
            }

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
                sb_json.height = sb.height;
                sb_json.margin = sb.margin;
                sb_json.font_size = sb.font_size;
                sb_json.show_label = sb.show_label;
                sb_json.symbol = sb.units;
                // Use global LENGTH_UNITS to get symbol for unit.
                if (LENGTH_UNITS && LENGTH_UNITS[sb.units]){
                    sb_json.symbol = LENGTH_UNITS[sb.units].symbol;
                }

                var sb_html = this.scalebar_template(sb_json);
                this.$el.append(sb_html);
            }
            this.$scalebar = $(".scalebar", this.$el);

            // update scalebar size wrt current sizes
            this.render_layout();
        },

        render_colorbar: async function() {

            if (this.$colorbar) {
                this.$colorbar.remove();
            }
            var cb = this.model.get('colorbar');
            var start = 0,
                end = 125,
                reverseIntensity = false,
                color = "";
            for (const chann of this.model.get('channels')) {
                if(chann.active) {
                    color = chann.color;
                    start = chann.window?.start;
                    end = chann.window?.end;
                    reverseIntensity = chann.reverseIntensity;
                    break;
                }
            }
            var lut_url;
            var lutBgPos;
            var isLUT = !(/^[0-9a-fA-F]+$/.test(color));  // check if it's a normal color or a LUT
            if (isLUT) {
                lut_url = await FigureLutPicker.loadLuts();  // Ensure lut url and list are loaded
                lutBgPos = FigureLutPicker.getLutBackgroundPosition(color);
            }
            var inverted_pos = {  // convenience variable for the colorbar template.
                "left": "right",
                "right": "left",
                "top": "bottom",
                "bottom": "top",
            };
            var orientation = {  // convenience variable for the colorbar template.
                "left": "vertical",
                "right": "vertical",
                "top": "horizontal",
                "bottom": "horizontal",
            };
            if (cb && cb.show) {
                var cb_json = {
                    position: cb.position,
                    inv_position: inverted_pos[cb.position],
                    orientation: orientation[cb.position],
                    show: cb.show,
                    thickness: cb.thickness,
                    font_size: cb.font_size,
                    axis_color: cb.axis_color,
                    num_ticks: cb.num_ticks,
                    mark_len: cb.mark_len,
                    gap: cb.gap,
                    tick_margin: cb.tick_margin,
                    start: start,
                    end: end,
                    color: color,
                    isLUT: isLUT,
                    lutBgPos: lutBgPos,
                    lut_url: lut_url,
                    reverseIntensity: reverseIntensity,
                };
                var cb_html = this.colorbar_template(cb_json);
                this.$el.append(cb_html);
            }
            this.$colorbar = $(".colorbar", this.$el);

            // update colorbar size wrt current sizes
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
            this.render_scalebar();     // also calls render_layout() -> render_labels()
            this.render_colorbar();

            // At this point, element is not ready for Raphael svg
            // If we wait a short time, works fine
            var self = this;
            setTimeout(function(){
                self.render_shapes();
            }, 10);
            this.render_scalebar();     // also calls render_layout() -> render_labels()

            return this;
        }
    });

    export default PanelView
