
//
// Copyright (C) 2015-2023 University of Dundee & Open Microscopy Environment.
// All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
//

import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";
import { showModal, hideModals } from "./util";

// Should only ever have a singleton on this
var ColorPickerView = Backbone.View.extend({

    el: $("#colorpickerModal"),

    // remember picked colors, for picking again
    pickedColors: [],

    initialize:function () {
        this.$submit_btn = $("#colorpickerModal .modal-footer button[type='submit']");
    },

    events: {
        "input .color-input": "handleColorInput",
        "submit .colorpickerForm": "handleColorpicker",
        "click .pickedColors button": "pickRecentColor",
    },

    handleColorInput: function(event) {
        let color = event.target.value;
        // enable form submission & show color
        this.$submit_btn.prop('disabled', false);
        $('.oldNewColors li:first-child').css('background-color', color);
    },

    // 'Recent colors' buttons have color as their title
    pickRecentColor: function(event) {
        var color = $(event.target).prop('title');
        $('.color-input').val(color).trigger("click");
        // enable submit
        this.$submit_btn.prop('disabled', false);
    },

    // submit of the form: call the callback and close dialog
    handleColorpicker: function(event) {
        event.preventDefault();

        // var color = $(".colorpickerForm input[name='color']").val();
        var color = $('.color-input').val();

        // very basic validation (in case user has edited color field manually)
        if (color.length === 0) return;
        if (color[0] != "#") {
            color = "#" + color;
        }
        // E.g. must be #f00 or #ff0000
        if (color.length != 7 && color.length != 4) return;

        // remember for later
        this.pickedColors.push(color);

        if (this.success) {
            this.success(color);
        }

        hideModals();
        return false;
    },

    show: function(options) {
        showModal("colorpickerModal");

        $(".color-input", this.$el).trigger("click");
        if (options.color) {
            // compare old and new colors - init with old color
            $('.oldNewColors li').css('background-color', "#" + options.color);

            // disable submit button until color is chosen
            this.$submit_btn.prop('disabled', 'disabled');
        }

        if (options.pickedColors) {
            this.pickedColors = _.uniq(this.pickedColors.concat(options.pickedColors));
        }

        // save callback to use on submit
        if (options.success) {
            this.success = options.success;
        }

        this.render();
    },

    render:function () {
        
        // this is a list of strings
        var json = {'colors': _.uniq(this.pickedColors)};

        var t = '' +
            '<div class="btn-group">' +
            '<% _.each(colors, function(c, i) { %>' +
                '<button type="button" class="btn btn-default" ' +
                    'title="<%= c %>"' +
                    'style="background-color: <%= c %>"> </button>' +
            '<% if ((i+1)%4 == 0){ %> </div><div class="btn-group"><% } %>' +
            '<% }); %>' +
            '</div>';

        var compiled = _.template(t);
        var html = compiled(json);

        $("#pickedColors").html(html);
    }
});

// create single instance:
const FigureColorPicker = new ColorPickerView();

export default FigureColorPicker
