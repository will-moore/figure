import Backbone from "backbone";
import _, { forEach } from "underscore";
import $ from "jquery";

import calib_form_template from '../../templates/calib_form.template.html?raw';

var CalibBarFormView = Backbone.View.extend({

    template: _.template(calib_form_template),

    initialize: function(opts) {
        this.render = _.debounce(this.render);
        this.models = opts.models;

        var self = this;
        this.models.forEach(function(m) {
            self.listenTo(m, 'change:calib', self.render);
        });
    },

    events: {
        "submit .calib_form": "update_calib",
        "change .btn": "dropdown_btn_changed",
        "click .hide_calib": "hide_calib",
        "keyup input[type='number']"  : "handle_keyup",
     },

    handle_keyup: function (event) {
        // If Enter key - submit form...
        if (event.which == 13) {
            this.update_calib();
        }
    },

    dropdown_btn_changed: function(event) {
        $(event.target).closest('form').submit();
    },

    hide_calib: function() {
        this.models.forEach(function(m) {
            m.hide_calib();
        });
    },

    update_calib: function(event) {
        var $form = $('.calib_form');
        var position = $('.label-position i:first', $form).attr('data-position'),
            thickness = parseInt($('.calib-thickness', $form).val()),
            font_size = $('.calib_font_size span:first', $form).text().trim(),
            color = $('.calib-color span:first', $form).attr('data-color'),
            ticks_parameter = parseInt($('.calib-tick-parameter', $form).val()),
            length = parseInt($('.calib-tick-length', $form).val());

        this.models.forEach(function(m) {
            var lutBgPos = m.get('lutBgPos');
            var cb = { show: true, lutBgPos: lutBgPos };
            if (position != '-') cb.position = position;
            if (thickness != '-') cb.thickness = thickness;
            if (font_size != '-') cb.font_size = font_size;
            if (color != '-') cb.color = color;
            if (ticks_parameter != '-') cb.ticks_parameter = ticks_parameter;
            if (length != '-') cb.length = length;
            m.save_calib(cb);
        });
        return false;
    },

    render: function() {
        var cb_json = {show: false},
            hidden = false,
            cb;

        this.models.forEach(function(m) {
            cb = m.get('calib');

            if (cb) {
                if (!cb_json.length) {
                    cb_json.position = cb.position;
                    cb_json.thickness = cb.thickness;
                    cb_json.font_size = cb.font_size;
                    cb_json.color = cb.color;
                    cb_json.ticks_parameter = cb.ticks_parameter;
                    cb_json.length = cb.length;
                } else {
                    if (cb_json.position != cb.position) cb_json.position = '-';
                    if (cb_json.thickness != cb.thickness) cb_json.thickness = '-';
                    if (cb_json.font_size != cb.font_size) cb_json.font_size = '-';
                    if (cb_json.color != cb.color) cb_json.color = '-';
                    if (cb_json.ticks_parameter != cb.ticks_parameter) cb_json.ticks_parameter = '-';
                    if (cb_json.length != cb.length) cb_json.length = '-';
                }
            }
            if (!cb || !cb.show) hidden = true;
        });

        if (this.models.length === 0 || hidden) {
            cb_json.show = true;
        }

        cb_json.position = cb_json.position || 'top';
        cb_json.thickness = cb_json.thickness || 45;
        cb_json.font_size = cb_json.font_size || 12;
        cb_json.color = cb_json.color || '000';
        cb_json.ticks_parameter = cb_json.ticks_parameter || 6;
        cb_json.length = cb_json.length || 10;
        var html = this.template(cb_json);
        this.$el.html(html);
        return this;
    }
});

export default CalibBarFormView;