
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";
import Mousetrap from "mousetrap";

import FigureModel from "../models/figure_model";
import RoiList from "../models/roi_model";
import ShapeManager from "../shape_editor/shape_manager";
import FigureColorPicker from "../views/colorpicker";

import shape_toolbar_template from '../../templates/shapes/shape_toolbar.template.html?raw';
import shape_sidebar_template from '../../templates/shapes/shape_sidebar.template.html?raw';
import roi_zt_buttons from '../../templates/modal_dialogs/roi_zt_buttons.template.html?raw';
import RoiLoaderView from './roi_loader_view';
import { hideModal, getJson } from "./util";

const LABEL_POSITION_ICONS = {
    "topleft": "bi-box-arrow-in-up-left",
    "topright": "bi-box-arrow-in-up-right",
    "bottomleft": "bi-box-arrow-in-down-left",
    "bottomright": "bi-box-arrow-in-down-right",
    "left": "bi-box-arrow-left",
    "top": "bi-box-arrow-up",
    "right": "bi-box-arrow-right",
    "bottom": "bi-box-arrow-down",
    "center": "bi-arrows-fullscreen",
    "freehand": "bi-arrows-move"
}

export const RoiModalView = Backbone.View.extend({

        template: _.template(shape_toolbar_template),

        roi_zt_buttons_template: _.template(roi_zt_buttons),

        sidebar_template: _.template(shape_sidebar_template),

        el: $("#roiModal"),

        model:FigureModel,

        // ID for temp shape that we add & remove from shapeManager
        TEMP_SHAPE_ID: -1234,

        // This gets populated when dialog loads
        omeroRoiCount: 0,
        roisLoaded: false,
        roisPageSize: 500,
        roisPage: 0,

        initialize: function() {

            var self = this;

            // We create a new Model and RoiLoaderView.
            // Then listen for selection events etc coming from RoiLoaderView
            this.Rois = new RoiList();
            this.listenTo(this.Rois, "change:selection", this.showTempShape);  // mouseover shape
            this.listenTo(this.Rois, "shape_add", this.addShapeFromOmero);
            this.listenTo(this.Rois, "shape_click", this.showShapePlane);

            // We manually bind Mousetrap keyboardEvents to body so as
            // not to clash with the global keyboardEvents in figure_view.js
            // Bind to 'body' instead of #roiModal since this didn't always work with
            // some events maybe getting lost to Raphael elements??
            var dialog = document.getElementById('body');
            Mousetrap(dialog).bind('backspace', function(event, combo) {
                // Need to ignore if the dialog isn't visible
                if(!self.$el.is(":visible")) return true;
                var inputText = document.getElementById('label-text');
                if(inputText === document.activeElement) return true;
                self.deleteShapes(event);
                return false;
            });
            Mousetrap(dialog).bind('del', function(event, combo) {
                if(!self.$el.is(":visible")) return true;
                var inputText = document.getElementById('label-text');
                if(inputText === document.activeElement) return true;
                self.deleteShapes(event);
                return false;
            });
            Mousetrap(dialog).bind('mod+c', function(event, combo) {
                if(!self.$el.is(":visible")) return true;
                self.copyShapes(event);
                return false;
            });
            Mousetrap(dialog).bind('mod+v', function(event, combo) {
                if(!self.$el.is(":visible")) return true;
                self.pasteShapes(event);
                return false;
            });
            Mousetrap(dialog).bind('mod+a', function(event, combo) {
                if(!self.$el.is(":visible")) return true;
                self.selectAllShapes(event);
                return false;
            });

            // Here we handle init of the dialog when it's shown...
            document.getElementById('roiModal').addEventListener('shown.bs.modal', () => {
                // Clone the 'first' selected panel as our reference for everything
                self.m = self.model.getSelected().head().clone();

                // We don't support Shape editing when rotated or flipped!
                self.rotated = self.m.get('rotation') !== 0 || self.m.get('vertical_flip') || self.m.get('horizontal_flip');
                self.realRotation = self.m.get('rotation')
                self.realVFlip = self.m.get('vertical_flip') ? -1 : 1
                self.realHFlip = self.m.get('horizontal_flip') ? -1 : 1
                self.m.set('rotation', 0);
                self.m.set('vertical_flip', false);
                self.m.set('horizontal_flip', false);

                self.shapeManager.setState("SELECT");
                self.shapeManager.deleteAllShapes();
                self.shapeManager.setInModalView(true)
                self.shapeManager.setVerticalFlip(this.realVFlip)
                self.shapeManager.setHorizontalFlip(this.realHFlip)
                self.shapeManager.setTextRotation(this.realRotation)

                // Load any existing shapes on panel
                var shapesJson = self.m.get('shapes');
                if (shapesJson) {
                    self.shapeManager.setShapesJson(shapesJson);
                }

                // Default line width
                self.shapeManager.setStrokeWidth(1);

                // remove any previous OMERO ROIs
                $("#roiModalRoiList table").empty();
                self.roisLoaded = false;

                self.shapeManager.setText('');
                self.render();
                self.checkForRois();
                self.renderPagination();
            });

            this.shapeManager = new ShapeManager("roi_paper", 1, 1);
            self.shapeManager.setStrokeColor('#FFFFFF');
            self.shapeManager.setFillColor('#FFFFFF');


            this.$roiImg = $('.roi_image', this.$el);
        },

        events: {
            "submit .roiModalForm": "handleRoiForm",
            "click .shape-option .btn": "selectState",
            "click .dropdownSelect a": "select_dropdown_option",
            "change .line-width": "changeLineWidth",
            "change .text-font-size": "changeFontSize",
            "keyup .label-text": "labelInputKeyup",
            "change .shape-color": "changeColor",
            "change .fill-color": "changeFillColor",
            "change .fill-opacity": "changeFillOpacity",
            // shapeManager triggers on canvas element
            "change:selected .roi_paper": "shapeSelected",
            "new:shape .roi_paper": "shapeSelected",
            "click .copyShape": "copyShapes",
            "click .pasteShape": "pasteShapes",
            "click .deleteShape": "deleteShapes",
            "click .selectAll": "selectAllShapes",
            "click .loadRoisBtn": "loadRoisFirstPage",
            "click .roisPrevPage": "roisPrevPage",
            "click .roisNextPage": "roisNextPage",
            "click .roisJumpPage": "roisJumpPage",
            "click .revert_theZ": "revertTheZ",
            "click .revert_theT": "revertTheT",
        },

        revertTheZ: function() {
            var orig_model = this.model.getSelected().head();
            this.m.set('theZ', orig_model.get('theZ'));
            this.renderImagePlane();
        },

        revertTheT: function() {
            var orig_model = this.model.getSelected().head();
            this.m.set('theT', orig_model.get('theT'));
            this.renderImagePlane();
        },

        checkForRois: function() {
            var url = BASE_WEBFIGURE_URL + 'roiCount/' + this.m.get('imageId') + '/';

            var $btn = $("#loadRois")
                .attr({'disabled': 'disabled'});
            $btn.parent().attr('title', 'Checking for ROIs...');  // title on parent div - still works if btn disabled

            getJson(url).then((data) => {
                this.omeroRoiCount = data.roi;
                this.renderSidebar();
            });
        },

        loadRoisFirstPage: function (event) {
            event.preventDefault();
            // hide button and tip
            $("#loadRois").prop('disabled', true);
            this.roisPage = 0;
            this.loadRois();
        },

        roisPrevPage: function (event) {
            event.preventDefault();
            this.roisPage -= 1;
            this.loadRois();
        },

        roisNextPage: function (event) {
            event.preventDefault();
            this.roisPage += 1;
            this.loadRois();
        },

        roisJumpPage: function (event) {
            event.preventDefault();
            var page = $(event.target).data('page');
            if (!isNaN(page)) {
                this.roisPage = parseInt(page);
                this.loadRois();
            }
        },

        // Load Shapes from OMERO and render them
        loadRois: function() {
            var iid = this.m.get('imageId');
            let url = BASE_OMEROWEB_URL + 'api/v0/m/rois/';
            var roiUrl = url + '?image=' + iid + '&limit=' + this.roisPageSize + '&offset=' + (this.roisPageSize * this.roisPage);
            getJson(roiUrl).then((data) => {
                this.Rois.set(data.data);
                $("#loadRois").prop('disabled', false);
                $("#roiModalRoiList table").empty();
                this.roisLoaded = true;
                this.renderSidebar();
                $("#roiModalTip").hide();
                var roiLoaderView = new RoiLoaderView({ collection: this.Rois, panel: this.m, totalCount: this.omeroRoiCount});
                $("#roiModalRoiList table").append(roiLoaderView.el);
                roiLoaderView.render();
                this.renderPagination();
            });
        },

        showShapePlane: function(args) {
            var shapeJson = args[0];
            if (shapeJson) {
                var newPlane = {};
                if (shapeJson.theZ !== undefined) {
                    newPlane.theZ = shapeJson.theZ;
                }
                if (shapeJson.theT !== undefined) {
                    newPlane.theT = shapeJson.theT;
                }
                this.m.set(newPlane);
                this.renderImagePlane();
            }
        },

        addShapeFromOmero: function(args) {

            var shapesJson = args.length == 1 ? [args[0]] : args,
                shape;
            // Remove the temp shape
            this.shapeManager.deleteShapesByIds([this.TEMP_SHAPE_ID]);

            // Paste (will offset if shape exists)
            var viewport = this.m.getViewportAsRect();
            shape = this.shapeManager.pasteShapesJson(shapesJson, viewport);
            if (!shape) {
                alert("Couldn't add shape outside of current view. Try zooming out.");
            }
        },

        showTempShape: function(args) {
            const shape = args[0];
            this.shapeManager.deleteShapesByIds([this.TEMP_SHAPE_ID]);
            if (shape) {
                var viewport = this.m.getViewportAsRect();
                shape.id = this.TEMP_SHAPE_ID;
                var convertedShape = shape;
                if(shape.type == "Label"){
                    convertedShape = this.shapeManager.convertOmeroLabelToFigureText(shape)
                    convertedShape.id = this.TEMP_SHAPE_ID
                }
                var ok = this.shapeManager.addShapeJson(convertedShape, viewport);
            }
        },

        copyShapes: function(event) {
            event.preventDefault();
            var shapeJson = this.shapeManager.getSelectedShapesJson();
            if (shapeJson.length > 0) {
                this.model.set('clipboard', {'SHAPES': shapeJson});
            }
            this.renderToolbar();    // to enable paste
        },

        pasteShapes: function(event) {
            event.preventDefault();
            var roiJson = this.model.get('clipboard');
            if (roiJson.SHAPES) {
                roiJson = roiJson.SHAPES;
            } else if (roiJson.CROP) {
                // Need to create Rectangle with current color & line width
                var color = $(".roi_toolbar .shape-color span:first", this.$el).attr('data-color'),
                    fillColor = $(".roi_toolbar .fill-color span:first", this.$el).attr('data-fill-color'),
                    opacity = $(".roi_toolbar .fill-opacity span:first", this.$el).attr('data-fill-opacity'),
                    width = $(".roi_toolbar .line-width span:first", this.$el).attr('data-line-width'),
                    rect = roiJson.CROP;
                roiJson = [{type: "Rectangle",
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                            strokeColor: "#" + color,
                            fillColor: "#" + fillColor,
                            fillOpacity: opacity,
                            lineWidth: width}];
            } else {
                return;
            }

            // paste ROIs, with offset if matching existing shape
            // Constrain pasting to within viewport
            var viewport = this.m.getViewportAsRect();
            var p = this.shapeManager.pasteShapesJson(roiJson, viewport);
            if (!p) {
                this.renderSidebarWarning("Could not paste ROI outside viewport.");
            }
        },

        deleteShapes: function(event) {
            event.preventDefault();
            this.shapeManager.deleteSelectedShapes();
        },

        handleRoiForm: function(event) {
            event.preventDefault();

            this.shapeManager.setInModalView(false)

            var shapesJson = this.shapeManager.getShapesJson();
            shapesJson = shapesJson.filter(function(s){
                // Remove any temporary shapes (from hovering over OMERO shapes)
                return (s.id !== this.TEMP_SHAPE_ID);
            }.bind(this));

            var theZ = this.m.get('theZ'),
                theT = this.m.get('theT');
            this.model.getSelected().forEach(function(panel){

                // We use save() to notify undo/redo queue. TODO - fix!
                panel.save({'shapes': shapesJson, 'theZ': theZ, 'theT': theT});
            });

            hideModal("roiModal");
            return false;
        },

        shapeSelected: function() {
            // simply re-render toolbar
            this.renderToolbar();
        },

        changeLineWidth: function(event) {
            var lineWidth = $("span:first", event.target).attr('data-line-width');
            lineWidth = parseFloat(lineWidth, 10);
            this.shapeManager.setStrokeWidth(lineWidth);
        },

        changeFontSize: function(event) {
            var fontSize = $("span:first", event.target).attr('data-font-size');
            fontSize = parseFloat(fontSize, 10);
            this.shapeManager.setFontSize(fontSize);
        },

        labelInputKeyup: function(event){
            // This will update text on any currently selected Text shapes
            // and/or set the default text for new Text shapes
            var text = event.target.value;
            this.shapeManager.setText(text);
        },

        changeColor: function(event) {
            var color = $("span:first", event.target).attr('data-color');
            this.shapeManager.setStrokeColor("#" + color);
        },

        changeFillColor: function(event) {
            var color = $("span:first", event.target).attr('data-fill-color');
            this.shapeManager.setFillColor("#" + color);
        },

        changeFillOpacity: function(event) {
            var opacity = $("span:first", event.target).attr('data-fill-opacity');
            opacity = parseFloat(opacity, 10).toFixed(1);
            this.shapeManager.setFillOpacity(opacity);
        },

        // Handles all the various drop-down menus in the toolbar
        select_dropdown_option: function(event) {
            event.preventDefault();
            var $a = $(event.target),
                $span = $a.children('span');
            // Take the <span> from the <a> and place it in the <button>
            if ($span.length === 0) $span = $a;  // in case we clicked on <span>
            var $li = $span.parent().parent();
            // Don't use $li.parent().prev() since bootstrap inserts a div.dropdown-backdrop on Windows
            var $button = $("button.dropdown-toggle", $li.parent().parent());
            $span = $span.clone();

            if ($span.hasClass('colorpickerOption')) {
                var oldcolor = $a.attr('data-oldcolor');
                FigureColorPicker.show({
                    'color': oldcolor,
                    'success': function(newColor){
                        $span.css({'background-color': newColor, 'background-image': 'none'});
                        // remove # from E.g. #ff00ff
                        newColor = newColor.replace("#", "");
                        if($a.attr('data-color')){
                            $span.attr('data-color', newColor);
                        }else{
                            $span.attr('data-fill-color', newColor);
                        }
                        $('span:first', $button).replaceWith($span);
                        // can listen for this if we want to 'submit' etc
                        $button.trigger('change');
                    }
                });
            } else {
                $('span:first', $button).replaceWith($span);
                if ($span.prop('title')) {
                    $button.prop('title', $span.prop('title'));
                }
                $button.trigger('change');      // can listen for this if we want to 'submit' etc
            }
        },

        selectAllShapes: function(event) {
            event.preventDefault();
            // manager triggers shapeSelected, which renders toolbar
            this.shapeManager.selectAllShapes();
        },

        selectState: function(event) {
            var $target = $(event.target),
                newState = $target.attr('data-state');
            if (newState === undefined) {
                // in case we clicked 'span'
                newState = $target.parent().attr('data-state');
            }
            this.shapeManager.setState(newState);
            if (this.shapeManager.getSelectedShapes().length == 0){
                this.shapeManager.setText("");
            }
            this.renderToolbar();
        },

        // we disable Submit when dialog is shown, enable when region/ROI chosen
        enableSubmit: function(enabled) {
            var $okBtn = $('button[type="submit"]', this.$el);
            if (enabled) {
                $okBtn.prop('disabled', false);
                $okBtn.prop('title', 'Crop selected images to chosen region');
            } else {
                $okBtn.prop('disabled', 'disabled');
                $okBtn.prop('title', 'No valid region selected');
            }
        },

        renderToolbar: function() {
            // render toolbar
            let shapes = this.shapeManager.getSelectedShapesJson();
            let textShapes = shapes.filter(s => s.type === "Text");
            var sel = shapes.length > 0,
                state = this.shapeManager.getState(),
                lineW = this.shapeManager.getStrokeWidth(),
                color = this.shapeManager.getStrokeColor(),
                fillColor = this.shapeManager.getFillColor(),
                opacity = this.shapeManager.getFillOpacity(),
                scale = this.zoom,
                toPaste = this.model.get('clipboard'),
                windows = navigator.platform.toUpperCase().indexOf('WIN') > -1,
                lineWidths = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30],
                opacities = ["0", "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1"],
                fontSize = this.shapeManager.getFontSize(),
                fontSizes = [6, 8, 10, 12, 14, 18, 21, 24, 36, 48],
                text = textShapes.length > 0 ? this.shapeManager.getText() : "";
            // various different text values
            if (text === false || text === undefined) text = "";
            color = color ? color.replace("#", "") : 'FFFFFF';
            fillColor = fillColor ? fillColor.replace("#", "") : 'FFFFFF';
            toPaste = (toPaste && (toPaste.SHAPES || toPaste.CROP));
            opacity = opacity <= 0.01 ? parseInt(opacity) : opacity;

            var json = {'state': state,
                        'lineWidths': lineWidths,
                        'lineWidth': lineW,
                        'color': color,
                        'fillColor': fillColor,
                        'opacities': opacities,
                        'opacity': opacity,
                        'sel': sel,
                        'cmdKey': windows ? "Ctrl+" : "⌘",
                        'toPaste': toPaste,
                        'zoom': parseInt(scale * 100, 10),
                        'omeroRoiCount': this.omeroRoiCount,
                        'roisLoaded': this.roisLoaded,
                        'fontSizes': fontSizes,
                        'fontSize': fontSize,
                        'textControlsEnabled': textShapes.length > 0 || state === "TEXT",
                        'text': text};

            $(".roi_toolbar", this.$el).html(this.template(json));
        },

        renderSidebarWarning: function(text) {
            var html = "<p><span class='label label-warning'>Warning</span> " + text + "</p>";
            $("#roiModalTip").html(html).show().fadeOut(10000);
        },

        // this is called each time the ROI dialog is displayed
        renderSidebar: function() {
            var tip;
            if (this.rotated) {
                tip = "This image panel is rotated or flipped in the figure, but this ROI editor can't work with rotated/flipped images. " +
                      "The image is displayed here <b>without</b> rotation/flipping, but the ROIs you add will be applied " +
                      "correctly to the image panel in the figure.";
            } else {
                tip = "If you copy a region from the Crop dialog (under the 'Preview' tab), you can paste it here to create a new Rectangle."
            }

            var json = {
                omeroRoiCount: this.omeroRoiCount,
                roisLoaded: this.roisLoaded,
                tip: tip,
                rotated: this.rotated
            }
            $("#roiModalSidebar", this.$el).html(this.sidebar_template(json));
        },

        // for rendering bounding-box viewports for shapes
        getBboxJson: function(bbox, theZ, theT) {
            var size = 50;   // longest side
            var orig_width = this.m.get('orig_width'),
                orig_height = this.m.get('orig_height');
                // origT = this.m.get('theT'),
                // origZ = this.m.get('theZ');
            // theT = (theT !== undefined ? theT : this.m.get('theT'))
            var div_w, div_h;
            // get src for image by temp setting Z & T
            if (theT !== undefined) this.m.set('theT', bbox.theT, {'silent': true});
            if (theZ !== undefined) this.m.set('theZ', bbox.theZ, {'silent': true});
            var src = this.m.get_img_src();
            if (bbox.width > bbox.height) {
                div_w = size;
                div_h = (bbox.height/bbox.width) * div_w;
            } else {
                div_h = size;
                div_w = (bbox.width/bbox.height) * div_h;
            }
            var zoom = div_w/bbox.width;
            var img_w = orig_width * zoom;
            var img_h = orig_height * zoom;
            var top = -(zoom * bbox.y);
            var left = -(zoom * bbox.x);
            // bbox.theT = bbox.theT !== undefined ? bbox.theT : origT;
            // bbox.theZ = bbox.theZ !== undefined ? bbox.theZ : origZ;

            return {
                'src': src,
                'w': div_w,
                'h': div_h,
                'top': top,
                'left': left,
                'img_w': img_w,
                'img_h': img_h
            };
        },

        renderImagePlane: function() {
            var src = this.m.get_img_src();
            this.$roiImg.attr('src', src);

            var orig_model = this.model.getSelected().head();
            var json = {'theZ': this.m.get('theZ'),
                        'theT': this.m.get('theT'),
                        'origZ': orig_model.get('theZ'),
                        'origT': orig_model.get('theT')}
            var html = this.roi_zt_buttons_template(json);
            $("#roi_zt_buttons").html(html);
        },

        renderPagination: function() {
            if (!this.roisLoaded) {
                $("#roiPageControls").html("").hide();
                return;
            }
            var pageCount = Math.ceil(this.omeroRoiCount / this.roisPageSize);
            var html = `<span>${ this.omeroRoiCount} ROIs`
            // Only show pagination controls if needed
            if (pageCount > 1) {
                html += `: page ${ this.roisPage + 1}/${pageCount}</span>
                <div class="btn-group" style="float:right">
                    <button title="Load previous page of ROIs" ${this.roisPage === 0 ? "disabled='disabled'":'' }
                        type="button" class="btn btn-default btn-sm roisPrevPage">
                        Prev
                    </button>
                    <button title="Load next page of ROIs" ${(this.roisPage + 1) >= pageCount ? "disabled='disabled'" : '' }
                        type="button" class="btn btn-default btn-sm roisNextPage">
                        Next
                    </button>
                    <button type="button" class="btn btn-default btn-sm dropdown-toggle" title="Select page" data-bs-toggle="dropdown">
                        <span class="caret"></span>
                    </button>
                    <ul class="dropdown-menu" role="menu">
                    ${
                        _.range(pageCount).map(p => `<li>
                        <a class="roisJumpPage" href="#" data-page="${p}">
                            <span class="glyphicon glyphicon-ok" ${ this.roisPage !== p ? "style='visibility:hidden'" : ""}></span>
                            Page ${p + 1}
                        </a>
                        </li>`).join(`\n`)
                    }
                    </ul>
                </div>`
            } else {
                html += `</span>`;
            }
            $("#roiPageControls").html(html).show();
        },

        render: function() {

            var maxSize = 550,
                frame_w = maxSize,
                frame_h = maxSize,
                wh = this.m.get('width') / this.m.get('height');
            var sc = 1;
            if (wh <= 1) {
                sc = maxSize / this.m.get('height');
                frame_h = maxSize;
                frame_w = maxSize * wh;
            } else {
                sc = maxSize / this.m.get('width');
                frame_w = maxSize;
                frame_h = maxSize / wh;
            }

            // Get css for the image plane
            var css = this.m.get_vp_img_css(this.m.get('zoom'), frame_w, frame_h);
            this.$roiImg.css(css);

            // Get css for the SVG (full plane)
            var svg_css = this.m.get_vp_full_plane_css(this.m.get('zoom'), frame_w, frame_h);
            var w = this.m.get('orig_width'),
                h = this.m.get('orig_height');
            var scale = svg_css.width / w;
            // TODO: add public methods to set w & h
            this.shapeManager._orig_width = w;
            this.shapeManager._orig_height = h;
            this.shapeManager.setZoom(scale * 100);
            this.shapeManager.setShapeScalingFactor(sc * 100);
            $("#roi_paper").css(svg_css);

            $("#roiViewer").css({'width': frame_w + 'px', 'height': frame_h + 'px'});

            this.renderImagePlane();
            this.renderToolbar();
            this.renderSidebar();
        }
    });
