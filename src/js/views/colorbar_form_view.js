import Backbone from "backbone";
import _, { forEach } from "underscore";
import $ from "jquery";

import colorbar_form_template from '../../templates/colorbar_form.template.html?raw';

var ColorbarFormView = Backbone.View.extend({

    template: _.template(colorbar_form_template),

    initialize: function(opts) {
        this.render = _.debounce(this.render);
        this.models = opts.models;

        var self = this;
        this.models.forEach(function(m) {
            self.listenTo(m, 'change:colorbar', self.render);
        });
    },

    events: {
        "submit .colorbar_form": "update_colorbar",
        "change .btn": "dropdown_btn_changed",
        "click .hide_colorbar": "hide_colorbar",
        "keyup input[type='number']"  : "handle_keyup",
     },

    handle_keyup: function (event) {
        // If Enter key - submit form...
        if (event.which == 13) {
            this.update_colorbar();
        }
    },

    dropdown_btn_changed: function(event) {
        $(event.target).closest('form').submit();
    },

    hide_colorbar: function() {
        this.models.forEach(function(m) {
            m.hide_colorbar();
        });
    },

    update_colorbar: function(event) {
        var $form = $('.colorbar_form');
        var position = $('.label-position i:first', $form).attr('data-position'),
            thickness = parseInt($('.colorbar-thickness', $form).val()),
            font_size = $('.colorbar_font_size span:first', $form).text().trim(),
            color = $('.colorbar-color span:first', $form).attr('data-color'),
            ticks_parameter = parseInt($('.colorbar-tick-parameter', $form).val()),
            length = parseInt($('.colorbar-tick-length', $form).val()),
            spacing = parseInt($('.colorbar-spacing', $form).val()),
            tick_label_spacing = parseInt($('.colorbar-tick-label-spacing', $form).val());

        this.models.forEach(function(m) {
            var lutBgPos = m.get('lutBgPos');
            var cb = { show: true, lutBgPos: lutBgPos };
            if (position != '-') cb.position = position;
            if (thickness != '-') cb.thickness = thickness;
            if (font_size != '-') cb.font_size = font_size;
            if (color != '-') cb.color = color;
            if (ticks_parameter != '-') cb.ticks_parameter = ticks_parameter;
            if (length != '-') cb.length = length;
            if (spacing != '-') cb.spacing = spacing;
            if (tick_label_spacing != '-') cb.tick_label_spacing = tick_label_spacing;
            m.save_colorbar(cb);
        });
        return false;
    },

    render: function() {
        var cb_json = {show: false},
            hidden = false,
            cb;

        this.models.forEach(function(m) {
            cb = m.get('colorbar');

            if (cb) {
                if (!cb_json.length) {
                    cb_json.position = cb.position;
                    cb_json.thickness = cb.thickness;
                    cb_json.font_size = cb.font_size;
                    cb_json.color = cb.color;
                    cb_json.ticks_parameter = cb.ticks_parameter;
                    cb_json.length = cb.length;
                    cb_json.spacing = cb.spacing;
                    cb_json.tick_label_spacing = cb.tick_label_spacing;
                } else {
                    if (cb_json.position != cb.position) cb_json.position = '-';
                    if (cb_json.thickness != cb.thickness) cb_json.thickness = '-';
                    if (cb_json.font_size != cb.font_size) cb_json.font_size = '-';
                    if (cb_json.color != cb.color) cb_json.color = '-';
                    if (cb_json.ticks_parameter != cb.ticks_parameter) cb_json.ticks_parameter = '-';
                    if (cb_json.length != cb.length) cb_json.length = '-';
                    if (cb_json.spacing != cb.spacing) cb_json.spacing = '-';
                    if (cb_json.tick_label_spacing != cb.tick_label_spacing) cb_json.tick_label_spacing = '-';
                }
            }
            if (!cb || !cb.show) hidden = true;
        });

        if (this.models.length === 0 || hidden) {
            cb_json.show = true;
        }

        cb_json.position = cb_json.position || 'right';
        cb_json.thickness = cb_json.thickness || 15;
        cb_json.font_size = cb_json.font_size || 10;
        cb_json.color = cb_json.color || '000';
        cb_json.ticks_parameter = cb_json.ticks_parameter || 7;
        cb_json.length = cb_json.length || 3;
        cb_json.spacing = cb_json.spacing || 5;
        cb_json.tick_label_spacing = cb_json.tick_label_spacing || 5;
        var html = this.template(cb_json);
        this.$el.html(html);
        return this;
    }
});

export default ColorbarFormView;