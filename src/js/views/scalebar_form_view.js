
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";

import scalebar_form_template from '../../templates/scalebar_form.template.html?raw';


// Created new for each selection change
var ScalebarFormView = Backbone.View.extend({

    template: _.template(scalebar_form_template),

    initialize: function(opts) {

        // prevent rapid repetative rendering, when listening to multiple panels
        this.render = _.debounce(this.render);

        this.models = opts.models;
        var self = this;

        this.models.forEach(function(m){
            self.listenTo(m, 'change:scalebar change:pixel_size_x change:scalebar_label', self.render);
        });

        // this.$el = $("#scalebar_form");
    },

    events: {
        "submit .scalebar_form": "update_scalebar",
        "click .scalebar_label": "update_scalebar",
        "change .btn": "dropdown_btn_changed",
        "click .hide_scalebar": "hide_scalebar",
        "click .pixel_size_display": "edit_pixel_size",
        "keypress .pixel_size_input"  : "enter_pixel_size",
        "blur .pixel_size_input"  : "save_pixel_size",
        "keyup input[type='text']"  : "handle_keyup",
     },

    handle_keyup: function (event) {
        // If Enter key - submit form...
        if (event.which == 13) {
            this.update_scalebar();
        }
    }, 

    // simply show / hide editing field
    edit_pixel_size: function() {
        $('.pixel_size_display', this.$el).hide();
        $(".pixel_size_input", this.$el).css('display','inline-block').focus();
    },
    done_pixel_size: function() {
        $('.pixel_size_display', this.$el).show();
        $(".pixel_size_input", this.$el).css('display','none').focus();
    },

    // If you hit `enter`, set pixel_size
    enter_pixel_size: function(e) {
        if (e.keyCode == 13) {
            this.save_pixel_size(e);
        }
    },

    // on 'blur' or 'enter' we save...
    save_pixel_size: function(e) {
        // save will re-render, but only if number has changed - in case not...
        this.done_pixel_size();

        var val = $(e.target).val();
        if (val.length === 0) return;
        var pixel_size = parseFloat(val);
        if (isNaN(pixel_size)) return;
        this.models.forEach(function(m){
            m.save('pixel_size_x', pixel_size);
        });
    },

    // Automatically submit the form when a dropdown is changed
    dropdown_btn_changed: function(event) {
        $(event.target).closest('form').submit();
    },

    hide_scalebar: function() {
        this.models.forEach(function(m){
            m.hide_scalebar();
        });
    },

    // called when form changes
    update_scalebar: function(event) {

        var $form = $('.scalebar_form ');

        var length = $('.scalebar-length', $form).val(),
            units = $('.scalebar-units span:first', $form).attr('data-unit'),
            position = $('.label-position i:first', $form).attr('data-position'),
            color = $('.label-color span:first', $form).attr('data-color'),
            show_label = $('.scalebar_label', $form).prop('checked'),
            font_size = $('.scalebar_font_size span:first', $form).text().trim(),
            height = parseInt($('.scalebar-height', $form).val());

        this.models.forEach(function(m){
            var old_sb = m.get('scalebar');
            var sb = {show: true};
            if (length != '-') sb.length = parseFloat(length, 10);
            if (units != '-') {
                sb.units = units;
            } else {
                // various images have different units
                // keep existing scalebar units OR use image pixel_size units
                if (old_sb && old_sb.units) {
                    sb.units = old_sb.units;
                } else if (m.get('pixel_size_x_unit')) {
                    sb.units = m.get('pixel_size_x_unit');
                } else {
                    sb.units = "MICROMETER";
                }
            }
            if (position != '-') sb.position = position;
            if (color != '-') sb.color = color;
            sb.show_label = show_label;
            if (font_size != '-') sb.font_size = font_size;
            if (height != '-') sb.height = height;

            m.save_scalebar(sb);
        });
        return false;
    },

    render: function() {
        var json = {show: false, show_label: true},
            hidden = false,
            sb;

        // Turn dict into list of units we can sort by size
        var scalebarUnits = ["PICOMETER", "ANGSTROM", "NANOMETER", "MICROMETER",
            "MILLIMETER", "CENTIMETER", "METER", "KILOMETER", "MEGAMETER"]
        var unit_symbols = Object.keys(LENGTH_UNITS)
            .filter(function(unit){
                return (scalebarUnits.indexOf(unit) > -1);
            })
            .map(function(unit){
                return $.extend({unit: unit}, LENGTH_UNITS[unit]);
            });
        unit_symbols.sort(function(a, b){
            return a.microns > b.microns ? 1 : -1;
        })
        json.unit_symbols = unit_symbols;

        this.models.forEach(function(m){
            // start with json data from first Panel
            if (!json.pixel_size_x) {
                json.pixel_size_x = m.get('pixel_size_x');
                json.pixel_size_symbol = m.get('pixel_size_x_symbol');
                json.pixel_size_unit = m.get('pixel_size_x_unit');
            } else {
                let pix_sze = m.get('pixel_size_x');
                // account for floating point imprecision when comparing
                if (json.pixel_size_x != '-' &&
                    json.pixel_size_x.toFixed(10) != pix_sze.toFixed(10)) {
                        json.pixel_size_x = '-';
                }
                if (json.pixel_size_symbol != m.get('pixel_size_x_symbol')) {
                    json.pixel_size_symbol = '-';
                }
                if (json.pixel_size_unit != m.get('pixel_size_x_unit')) {
                    json.pixel_size_unit = '-';
                }
            }
            sb = m.get('scalebar');
            // if panel has scalebar, combine into json
            if (sb) {
                // for first panel, json = sb
                if (!json.length) {
                    json.length = sb.length;
                    json.units = sb.units;
                    json.position = sb.position;
                    json.color = sb.color;
                    json.show_label = sb.show_label;
                    json.font_size = sb.font_size;
                    json.height = sb.height;
                }
                else {
                    // combine attributes. Use '-' if different values found
                    if (json.length != sb.length) json.length = '-';
                    if (json.units != sb.units) json.units = '-';
                    if (json.position != sb.position) json.position = '-';
                    if (json.color != sb.color) json.color = '-';
                    if (!sb.show_label) json.show_label = false;
                    if (json.font_size != sb.font_size) json.font_size = '-';
                    if (json.height != sb.height) json.height = '-';
                }
            }
            // if any panels don't have scalebar - we allow to add
            if(!sb || !sb.show) hidden = true;
        });

        if (this.models.length === 0 || hidden) {
            json.show = true;
        }
        json.length = json.length || 10;
        // If no units chosen, use pixel size units
        json.units = json.units || json.pixel_size_unit;
        json.units_symbol = '-';
        if (json.units !== '-') {
            // find the symbol e.g. 'mm' from units 'MILLIMETER'
            json.units_symbol = LENGTH_UNITS[json.units].symbol;
        }
        json.position = json.position || 'bottomright';
        json.color = json.color || 'FFFFFF';
        json.font_size = json.font_size || 10;
        json.pixel_size_symbol = json.pixel_size_symbol || '-';
        json.height = json.height || 3;

        var html = this.template(json);
        this.$el.html(html);
        // this.$el.find("[title]").tooltip();

        return this;
    }
});

export default ScalebarFormView

