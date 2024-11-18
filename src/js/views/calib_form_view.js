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
            console.log(m);
            self.listenTo(m, 'change:calib', self.render);
        });
    },

    events: {
        "submit .calib_form": "update_calib",
        "change .btn": "dropdown_btn_changed",
        "click .hide_calib": "hide_calib",
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
        var position = $('.label-position i:first', $form).attr('data-position');

        this.models.forEach(function(m) {
            var lutBgPos = m.get('lutBgPos');
            var cb = { show: true, lutBgPos: lutBgPos };
            if (position != '-') cb.position = position;
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

            // if (cb) {
            //     if (!cb_json.length) {
            //         cb_json.position = cb.position;
            //         cb_json.lutBgPos = lutBgPos || 0;
            //     } else {
            //         if (cb_json.position != cb.position) cb_json.position = '-';
            //     }
            // }
            if (!cb || !cb.show) hidden = true;
        });

        if (this.models.length === 0 || hidden) {
            cb_json.show = true;
        }

        cb_json.position = cb_json.position || 'top';
        var html = this.template(cb_json);
        this.$el.html(html);
        return this;
    }
});

export default CalibBarFormView;