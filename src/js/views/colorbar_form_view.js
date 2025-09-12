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
            axis_color = $('.colorbar-axis-color span:first', $form).attr('data-axis-color'),
            num_ticks = parseInt($('.colorbar-num-ticks', $form).val()),
            mark_len = parseInt($('.colorbar-mark-length', $form).val()),
            gap = parseInt($('.colorbar-gap', $form).val()),
            tick_margin = parseInt($('.colorbar-tick-margin', $form).val());

        this.models.forEach(function(m) {
            var lutBgPos = m.get('lutBgPos');
            var cb = { show: true, lutBgPos: lutBgPos };
            if (position != '-') cb.position = position;
            if (thickness != '-') cb.thickness = thickness;
            if (font_size != '-') cb.font_size = font_size;
            if (axis_color != '-') cb.axis_color = axis_color;
            if (num_ticks != '-') cb.num_ticks = num_ticks;
            if (mark_len != '-') cb.mark_len = mark_len;
            if (gap != '-') cb.gap = gap;
            if (tick_margin != '-') cb.tick_margin = tick_margin;
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
                    cb_json.axis_color = cb.axis_color;
                    cb_json.num_ticks = cb.num_ticks;
                    cb_json.mark_len = cb.mark_len;
                    cb_json.gap = cb.gap;
                    cb_json.tick_margin = cb.tick_margin;
                } else {
                    if (cb_json.position != cb.position) cb_json.position = '-';
                    if (cb_json.thickness != cb.thickness) cb_json.thickness = '-';
                    if (cb_json.font_size != cb.font_size) cb_json.font_size = '-';
                    if (cb_json.axis_color != cb.axis_color) cb_json.axis_color = '-';
                    if (cb_json.num_ticks != cb.num_ticks) cb_json.num_ticks = '-';
                    if (cb_json.mark_len != cb.mark_len) cb_json.mark_len = '-';
                    if (cb_json.gap != cb.gap) cb_json.gap = '-';
                    if (cb_json.tick_margin != cb.tick_margin) cb_json.tick_margin = '-';
                }
            }
            if (!cb || !cb.show) {
                hidden = true;
            }
        });

        if (this.models.length === 0 || hidden) {
            cb_json.show = true;
        }

        cb_json.position = cb_json.position ?? 'right';
        cb_json.thickness = cb_json.thickness ?? 15;
        cb_json.font_size = cb_json.font_size ?? 10;
        cb_json.axis_color = cb_json.axis_color ?? '000000';
        cb_json.num_ticks = cb_json.num_ticks ?? 7;
        cb_json.mark_len = cb_json.mark_len ?? 3;
        cb_json.gap = cb_json.gap ?? 5;
        cb_json.tick_margin = cb_json.tick_margin ?? 2;
        var html = this.template(cb_json);
        this.$el.html(html);
        return this;
    }
});

export default ColorbarFormView;