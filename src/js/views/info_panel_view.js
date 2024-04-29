
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";

import info_panel_template from '../../templates/info_panel.template.html?raw';
import xywh_panel_template from '../../templates/xywh_panel.template.html?raw';

import { OPEN_WITH, showModal } from "./util";


var InfoPanelView = Backbone.View.extend({

    template: _.template(info_panel_template),
    xywh_template: _.template(xywh_panel_template),

    initialize: function(opts) {
        this.render = _.debounce(this.render);
        this.figureModel = opts.figureModel;
        this.models = opts.models;
        if (opts.models.length > 1) {
            var self = this;
            this.models.forEach(function(m){
                self.listenTo(m, 'change:x change:y change:width change:height change:imageId change:zoom change:min_export_dpi change:max_export_dpi', self.render);
            });
        } else if (opts.models.length == 1) {
            this.model = opts.models.head();
            this.listenTo(this.model, 'change:x change:y change:width change:height change:zoom change:min_export_dpi change:max_export_dpi', this.render);
            this.listenTo(this.model, 'drag_resize', this.drag_resize);
        }
    },

    events: {
        "click .setId": "setImageId",
        "click .set_dpi": "set_dpi",
        "click .clear_dpi": "clear_dpi",
        "blur .xywh_form input": "handle_xywh",
        "keyup .xywh_form input": "handle_xywh",
        "click .setAspectRatio": "lockAspectRatio"
    },

    handle_xywh: function(event) {
        // Ignore the 2nd blur event generated during render()
        if (this.rendering) {
            return;
        }
        if (event.type === "keyup" && event.which !== 13) {
            return;
        }
        var attr = event.target.getAttribute("name");
        var value = parseInt(event.target.value, 10);
        if (isNaN(value)) {
            return;
        }

        var figsize = this.figureModel.getFigureSize();
        // Avoid re-rendering and losing focus everytime there is a Blur event
        // set(attr, value) will not cause render()
        this.ignoreChange = true;
        var aspectRatioStatus = false;
        this.models.forEach(function(m) {
            if (attr === 'x' || attr ==='y') {
                var old = m.get(attr);
                var coords = {};
                coords[attr] = old;
                var offset = this.figureModel.getPageOffset(coords);
                var newValue = old - offset[attr] + value;
                // Keep panel within figure limits
                if (attr === 'x') {
                    if (newValue > figsize.w || newValue < 0) {
                        this.ignoreChange = false;
                    }
                    newValue = Math.min(figsize.w, newValue);
                } else if (attr === 'y') {
                    if (newValue > figsize.h || newValue < 0) {
                        this.ignoreChange = false;
                    }
                    newValue = Math.min(figsize.h, newValue);
                }
                newValue = Math.max(0, newValue);
                m.set(attr, newValue);
            }
            else {
                if (value < 1) {
                    this.render();
                    return;
                }

                //Check aspect ratio button state
                //If selected, check attribute and value and then recalculate other attribute value
                //Set both values parallely
                var newWidthHeight = {};
                newWidthHeight[attr] = value;

                if ($(".setAspectRatio", this.$el).hasClass("aspectRatioSelected")) {
                    aspectRatioStatus = true;
                    var widthCur = m.get('width');
                    var heightCur = m.get('height');
                    var aspRatio = widthCur/heightCur;

                    if (attr === 'width'){
                        var heightNew = value/aspRatio;
                        newWidthHeight['height'] = heightNew;
                    }
                    else {
                        var widthNew = value * aspRatio;
                        newWidthHeight['width'] = widthNew;
                    }
                    this.ignoreChange = false;
                }
                m.save(newWidthHeight);
            }
        }.bind(this));
        // Timout for ignoreChange
        // Only reset this AFTER render() is called
        setTimeout(function(){
            this.ignoreChange = false;
            // keep locked status of the aspect ratio button the same,
            // when the focus shifts because of a blur event
            if (aspectRatioStatus) {
                $(".setAspectRatio", this.$el).addClass("aspectRatioSelected");
            }
        }.bind(this), 50);

    },

    set_dpi: function(event) {
        event.preventDefault();
        showModal("dpiModal");
    },

    // remove optional min_export_dpi attribute from selected panels
    clear_dpi: function(event) {
        event.preventDefault();
        this.models.forEach(function(m) {
            m.unset("min_export_dpi");
        });
    },

    setImageId: function(event) {
        event.preventDefault();
        // Simply show dialog - Everything else handled by SetIdModalView
        showModal("setIdModal");
        $("#setIdModal .imgId").val("").focus();
    },

    lockAspectRatio: function(event) {
        event.preventDefault();
        $(".setAspectRatio", this.$el).toggleClass("aspectRatioSelected");
    },

    // just update x,y,w,h by rendering ONE template
    drag_resize: function(xywh) {
        $("#xywh_table").remove();
        var json = {'x': xywh[0].toFixed(0),
                    'y': xywh[1].toFixed(0),
                    'width': xywh[2].toFixed(0),
                    'height': xywh[3].toFixed(0)};
        var offset = this.figureModel.getPageOffset(json);
        json.x = offset.x;
        json.y = offset.y;
        json.dpi = this.model.getPanelDpi(json.width, json.height);
        json.export_dpi = this.model.get('min_export_dpi');
        this.$el.append(this.xywh_template(json));
    },

    getImageLinks: function(remoteUrl, imageIds, imageNames) {
        // Link if we have a single remote image, E.g. http://jcb-dataviewer.rupress.org/jcb/img_detail/625679/
        var imageLinks = [];
        if (remoteUrl) {
            if (imageIds.length == 1) {
                imageLinks.push({'text': 'Image viewer', 'url': remoteUrl});
            }
        // OR all the images are local...
        } else {
            imageLinks.push({'text': 'Webclient', 'url': WEBINDEX_URL + "?show=image-" + imageIds.join('|image-')});

            // Handle other 'Open With' options
            OPEN_WITH.forEach(function(v){
                var selectedObjs = imageIds.map(function(id, i){
                    return {'id': id, 'name': imageNames[i], 'type': 'image'};
                });
                var enabled = false;
                if (typeof v.isEnabled === "function") {
                    enabled = v.isEnabled(selectedObjs);
                } else if (typeof v.supported_objects === "object" && v.supported_objects.length > 0) {
                    enabled = v.supported_objects.reduce(function(prev, supported){
                        // enabled if plugin supports 'images' or 'image' (if we've selected a single image)
                        return prev || supported === 'images' || (supported === 'image' && imageIds.length === 1);
                    }, false);
                }
                if (!enabled) return;

                // Get the link via url provider...
                var url = v.url + '?image=' + imageIds.join('&image=');
                if (v.getUrl) {
                    url = v.getUrl(selectedObjs, v.url);
                }
                // Ignore any 'Open with OMERO.figure' urls
                if (url.indexOf(BASE_WEBFIGURE_URL) === 0) {
                    return;
                }
                var label = v.label || v.id;
                imageLinks.push({'text': label, 'url': url});
            });
        }
        return imageLinks;
    },

    // render BOTH templates
    render: function() {
        // If event comes from handle_xywh() then we don't need to render()
        if (this.ignoreChange) {
            return;
        }
        // Flag to ignore blur events caused by $el.html() below
        this.rendering = true;
        var json,
            title = this.models.length + " Panels Selected...",
            remoteUrl;

        var imageIds = this.models.pluck('imageId');
        var imageNames = this.models.pluck('name');
        this.models.forEach(function(m) {
            if (m.get('baseUrl')) {
                // only used when a single image is selected
                remoteUrl = m.get('baseUrl') + "/img_detail/" + m.get('imageId') + "/";
            }
            // start with json data from first Panel
            var this_json = m.toJSON();
            // Format floating point values
            _.each(["x", "y", "width", "height"], function(a){
                if (this_json[a] != "-") {
                    this_json[a] = this_json[a].toFixed(0);
                }
            });
            var offset = this.figureModel.getPageOffset(this_json);
            this_json.x = offset.x;
            this_json.y = offset.y;
            this_json.dpi = m.getPanelDpi();
            this_json.channel_labels = this_json.channels.map(function(c){return c.label})
            if (!json) {
                json = this_json;
            } else {
                json.name = title;
                // compare json summary so far with this Panel
                var attrs = ["imageId", "orig_width", "orig_height", "sizeT", "sizeZ", "x", "y", "width", "height", "dpi", "min_export_dpi", "max_export_dpi"];
                _.each(attrs, function(a){
                    if (json[a] != this_json[a]) {
                        if (a === 'x' || a === 'y' || a === 'width' || a === 'height') {
                            json[a] = "";
                        } else {
                            json[a] = "-";
                        }
                    }
                });
                // handle channel names
                if (this_json.channels.length != json.channel_labels.length) {
                    json.channel_labels = ["-"];
                } else {
                    _.each(this_json.channels, function(c, idx){
                        if (json.channel_labels[idx] != c.label) {
                            json.channel_labels[idx] = '-';
                        }
                    });
                }

            }
        }.bind(this));

        json.export_dpi = Math.min(json.dpi, json.max_export_dpi);
        if (!isNaN(json.min_export_dpi)) {
            json.export_dpi = Math.max(json.export_dpi, json.min_export_dpi);
        }

        json.imageLinks = this.getImageLinks(remoteUrl, imageIds, imageNames);

        // all setId if we have a single Id
        json.setImageId = _.uniq(imageIds).length == 1;

        if (json) {
            var html = this.template(json),
                xywh_html = this.xywh_template(json);
            this.$el.html(html + xywh_html);
        }
        this.rendering = false;
        return this;
    }
});

export default InfoPanelView
