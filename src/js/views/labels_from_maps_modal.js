
import Backbone from "backbone";
import $ from "jquery";
import _ from "underscore";

import FigureModel from "../models/figure_model";
import { getJson, hideModal } from "./util";


export var LabelFromMapsModal = Backbone.View.extend({

    el: $("#labelsFromMapAnns"),

    model: FigureModel,

    // label options: position, size, color
    options: {},

    /**
     * Constructor - listen for dialog opening to load data and render
     */
    initialize: function() {
        // when dialog is shown, load map annotations for selected images
        document.getElementById('labelsFromMapAnns').addEventListener('shown.bs.modal', (event) => {
            // event options from the label form: {position: 'top', size: '12', color: '0000'}
            this.options = event.relatedTarget;
            this.loadMapAnns();
        });
    },

    events: {
        "submit .labelsFromMapAnnsForm": "handleForm",
        "change select": "renderExampleLabel",
        "change input": "renderExampleLabel",
    },

    /**
     * Load the map annotations, then call render()
     */
    loadMapAnns() {
        let imageIds = this.model.getSelected().map(function(m){return m.get('imageId')});
        this.isLoading = true;
        $('select', this.el).html("<option>Loading data...</option>");

        var url = WEBINDEX_URL + "api/annotations/?type=map&image=";
        url += imageIds.join("&image=");

        getJson(url).then(data => {
                this.isLoading = false;
                this.annotations = data.annotations;
                this.render();
            }
        );
    },

    /**
     * Handle submission of the form to create labels and close dialog
     *
     * @param {Object} event
     */
    handleForm: function(event) {
        event.preventDefault();
        if (this.isLoading) return;

        var choice = $("input[name='kvpChoice']:checked").val();
        var key;
        if(choice === "single-key"){
            key = $('select', this.el).val();
        }

        var includeKey = $("input[name='includeKey']").is(':checked');
        var labelSize = this.options.size || "12";
        var labelPosition = this.options.position || "top";
        var labelColor = this.options.color || "000000";

        var imageKeyValues = this.annotations.reduce(function(prev, t){
            var iid = t.link.parent.id;
            if (!prev[iid]) {
                prev[iid] = [];
            }
            t.values.forEach(function(kv) {
                var value = kv[1];
                // If key matches, add to values for the image (no duplicates)
                if ((choice === "all-keys" || (kv[0] === key)) && prev[iid].indexOf(value) === -1) {
                    prev[iid].push(kv);
                }
            });
            return prev;
        }, {});

        this.model.getSelected().forEach(function(p){
            var iid = p.get('imageId');
            if (imageKeyValues[iid]) {
                var labels = imageKeyValues[iid].map(function(value){
                    return {
                        'text': includeKey ? (value[0].replaceAll("_","\\_") + ': ' + value[1].replaceAll("_","\\_")) : value[1].replaceAll("_","\\_"),
                        'size': labelSize,
                        'position': labelPosition,
                        'color': labelColor,
                    }
                });
                p.add_labels(labels);
            }
        });
        hideModal("labelsFromMapAnns");
        return false;
    },

    /**
     * Renders the Example label based on currently selected Key and includeKey
     */
    renderExampleLabel: function() {
        var key = $('select', this.el).val();
        var includeKey = $("input[name='includeKey']").is(':checked');
        // find first annotation with this value
        var label;
        for (var a=0; a<this.annotations.length; a++) {
            this.annotations[a].values.forEach(function(kv) {
                if (kv[0] === key) {
                    label = kv[1];
                }
            });
            if (label) {
                break;
            }
        }

        if (includeKey) {
            label = key + ": " + label;
        }
        // Handle no annotations on images
        if (this.annotations.length == 0) {
            label = ""
        }

        $("#exampleLabelFromMap").html(_.escape(label));
    },

    /**
     * Renders the <select> for choosing Key. Also calls renderExampleLabel()
     */
    render: function() {
        // Get keys for images {'key' : {iid: true}}
        var keys = {};
        this.annotations.forEach(function(ann) {
            let iid = ann.link.parent.id;
            ann.values.forEach(function(kv){
                var key = kv[0];
                if (!keys[key]) {
                    keys[key] = {};
                }
                keys[key][iid] = true;
            })
        });

        // Make a list of keys (and sort) along with counts of images for each key
        var keyList = [];
        var keyCounts = {};
        for (var key in keys) {
            if (keys.hasOwnProperty(key)) {
                keyList.push(key);
                keyCounts[key] = Object.keys(keys[key]).length;
            }
        }
        keyList.sort(function(a, b) {
            return (a.toUpperCase() < b.toUpperCase()) ? -1 : 1; 
        });

        var html = keyList.map(function(key) {
            return "<option value='" + _.escape(key) + "'>" + _.escape(key) + " (" + keyCounts[key] + ")</option>";
        }).join("");
        if (keyList.length === 0) {
            html = "<option>No Key-Value Pairs found</option>";
        }
        $('select', this.el).html(html);

        this.renderExampleLabel();
    }
});
