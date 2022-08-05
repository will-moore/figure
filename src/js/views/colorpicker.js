
//
// Copyright (C) 2015 University of Dundee & Open Microscopy Environment.
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
import $ from "jquery";

// Should only ever have a singleton on this
var ColorPickerView = Backbone.View.extend({

    el: $("#colorpickerModal"),

    // remember picked colors, for picking again
    pickedColors: [],

    initialize:function () {
        
        // var sliders = {
        //     saturation: {
        //         maxLeft: 200,
        //         maxTop: 200,
        //         callLeft: 'setSaturation',
        //         callTop: 'setBrightness'
        //     },
        //     hue: {
        //         maxLeft: 0,
        //         maxTop: 200,
        //         callLeft: false,
        //         callTop: 'setHue'
        //     },
        //     alpha: {
        //         maxLeft: 0,
        //         maxTop: 200,
        //         callLeft: false,
        //         callTop: 'setAlpha'
        //     }
        // };

        // var self = this,
        //     editingRGB = false;     // flag to prevent update of r,g,b fields

        this.$submit_btn = $("#colorpickerModal .modal-footer button[type='submit']");

        // TODO: use <input type="color"/>
        // var $cp = $('.demo-auto').colorpicker({
        //     'sliders': sliders,
        //     'color': '00ff00',
        // });

        // // Access the colorpicker object for use below...
        // var cp = $cp.data('colorpicker');


        // $cp.on('changeColor', function(event){

        //     // In edge-case of starting with 'black', clicking on Hue slider,
        //     // default is to stay 'black', but we want to pick the color
        //     // by setting saturation and brightness.
        //     var c = event.color;
        //     if ((c.toHex() === "#000000" || c.toHex() === "#ffffff") &&
        //             cp.currentSlider && cp.currentSlider.callTop === "setHue") {
        //         cp.color.setSaturation(1);
        //         cp.color.setBrightness(0);
        //         cp.update(true);
        //         cp.element.trigger({
        //             type: 'changeColor',
        //             color: cp.color
        //         });
        //         // so we don't do this again until next click
        //         cp.currentSlider = undefined;
        //         return;
        //     }

        //     // enable form submission & show color
        //     self.$submit_btn.prop('disabled', false);
        //     $('.oldNewColors li:first-child').css('background-color', event.color.toHex());

        //     // update red, green, blue inputs
        //     if (!editingRGB) {
        //         var rgb = event.color.toRGB();
        //         $(".rgb-group input[name='red']").val(rgb.r);
        //         $(".rgb-group input[name='green']").val(rgb.g);
        //         $(".rgb-group input[name='blue']").val(rgb.b);
        //     }
        // });

        $(".rgb-group input").bind("change keyup", function(){
            var $this = $(this),
                value = $.trim($this.val());
            // check it's a number between 0 - 255
            if (value == parseInt(value, 10)) {
                value = parseInt(value, 10);
                if (value < 0) {
                    value = 0;
                    $this.val(value);
                }
                else if (value > 255) {
                    value = 255;
                    $this.val(value);
                }
            } else {
                value = 255
                $this.val(value);
            }

            // update colorpicker
            var r = $(".rgb-group input[name='red']").val(),
                g = $(".rgb-group input[name='green']").val(),
                b = $(".rgb-group input[name='blue']").val(),
                rgb = "rgb(" + r + "," + g + "," + b + ")";

            // flag prevents update of r, g, b fields while typing
            editingRGB = true;
            $('.demo-auto').colorpicker('setValue', rgb);
            editingRGB = false;
        });
    },

    
    events: {
        "submit .colorpickerForm": "handleColorpicker",
        "click .pickedColors button": "pickRecentColor",
    },

    // 'Recent colors' buttons have color as their title
    pickRecentColor: function(event) {
        var color = $(event.target).prop('title');
        $('.demo-auto').colorpicker('setValue', color);
    },

    // submit of the form: call the callback and close dialog
    handleColorpicker: function(event) {
        event.preventDefault();

        // var color = $(".colorpickerForm input[name='color']").val();
        var color = $('.demo-auto').colorpicker('getValue');

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

        $("#colorpickerModal").modal('hide');
        return false;
    },

    show: function(options) {

        $("#colorpickerModal").modal('show');

        if (options.color) {
            $('.demo-auto').colorpicker('setValue', options.color);

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

export default ColorPickerView
