
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";

import LutPickerView from "./lutpicker";
const FigureLutPicker = new LutPickerView();

import channel_slider_template from '../../templates/channel_slider.template.html?raw';


const SLIDER_INCR_CUTOFF = 100;
// If the max value of a slider is below this, use smaller slider increments

var ChannelSliderView = Backbone.View.extend({

    template: _.template(channel_slider_template),

    initialize: function(opts) {
        // This View may apply to a single PanelModel or a list
        this.models = opts.models;
        var self = this;
        this.models.forEach(function(m){
            self.listenTo(m, 'change:channels', self.render);
        });
    },

    events: {
        "keyup .ch_start": "handle_channel_input",
        "keyup .ch_end": "handle_channel_input",
        "click .channel-btn": "toggle_channel",
        "click .dropdown-menu a": "pick_color",
        "input .ch_slider input": "channel_slider_slide",
        "change .ch_slider input": "channel_slider_stop",
    },

    pick_color: function(e) {
        var color = e.currentTarget.getAttribute('data-color'),
            $colorbtn = $(e.currentTarget).parent().parent(),
            oldcolor = $(e.currentTarget).attr('data-oldcolor'),
            idx = $colorbtn.attr('data-index'),
            self = this;

        if (color == 'colorpicker') {
            FigureColorPicker.show({
                'color': oldcolor,
                'success': function(newColor){
                    // remove # from E.g. #ff00ff
                    newColor = newColor.replace("#", "");
                    self.set_color(idx, newColor);
                }
            });
        } else if (color == 'lutpicker') {
            FigureLutPicker.show({
                success: function(lutName){
                    // LUT names are handled same as color strings
                    self.set_color(idx, lutName);
                }
            });
        } else if (color == 'reverse') {
            var reverse = $('span', e.currentTarget).hasClass('glyphicon-check');
            self.models.forEach(function(m){
                m.save_channel(idx, 'reverseIntensity', !reverse);
            });
        } else {
            this.set_color(idx, color);
        }
        return false;
    },

    set_color: function(idx, color) {
        if (this.models) {
            this.models.forEach(function(m){
                m.save_channel(idx, 'color', color);
            });
        }
    },

    hexToRgb: function hexToRgb(hex) {
        // handle #ff00ff
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) return {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        };
        // handle #ccc
        result = /^#?([a-f\d]{1})([a-f\d]{1})([a-f\d]{1})$/i.exec(hex);
        if (result) return {
            r: parseInt(result[1]+'0', 16),
            g: parseInt(result[2]+'0', 16),
            b: parseInt(result[3]+'0', 16)
        };
    },

    isDark: function(color) {
        if (color.endsWith('.lut')) {
            return false;
        }
        var c = this.hexToRgb(color);
        var min, max, delta;
        var v, s, h;
        min = Math.min(c.r, c.g, c.b);
        max = Math.max(c.r, c.g, c.b);
        v = max;
        delta = max-min;
        if (max !== 0) {
            s = delta/max;
        }
        else {
            v = 0;
            s = 0;
            h = 0;
        }
        if (delta === 0) {
            h = 0;
        } else if (c.r==max) {
            h = (c.g-c.b)/delta;
        } else if (c.g == max) {
            h = 2 + (c.b-c.r)/delta;
        } else {
            h = 4 +(c.r-c.g)/delta;
        }
        h = h * 60;
        if (h < 0) {
            h += 360;
        }
        h = h/360;
        v = v/255;
        return (v < 0.6 || (h > 0.6 && s > 0.7));
    },

    toggle_channel: function(e) {
        var idx = e.currentTarget.getAttribute('data-index');

        if (this.model) {
            this.model.toggle_channel(idx);
        } else if (this.models) {
            // 'flat' means that some panels have this channel on, some off
            var flat = $('div', e.currentTarget).hasClass('ch-btn-flat');
            this.models.forEach(function(m){
                if(flat) {
                    m.toggle_channel(idx, true);
                } else {
                    m.toggle_channel(idx);
                }
            });
        }
        return false;
    },

    handle_channel_input: function(event) {
        if (event.type === "keyup" && event.which !== 13) {
            return;     // Ignore keyups except 'Enter'
        }
        var idx = event.target.getAttribute('data-idx'),
            startEnd = event.target.getAttribute('data-window');  // 'start' or 'end'
        idx = parseInt(idx, 10);
        var value = parseFloat(event.target.value, 10);
        if (isNaN(value)) return;
        // Make sure 'start' < 'end' value
        if (event.target.getAttribute('max') && value > event.target.getAttribute('max')){
            alert("Enter a value less than " + event.target.getAttribute('max'));
            return;
        }
        if (event.target.getAttribute('min') && value < event.target.getAttribute('min')){
            alert("Enter a value greater than " + event.target.getAttribute('min'))
            return;
        }
        var newCh = {};
        newCh[startEnd] = value;
        this.models.forEach(function(m) {
            m.save_channel_window(idx, newCh);
        });
    },

    channel_slider_slide: function(event) {
        // Handle sliding action for start slider and end slider
        let $target = $(event.target);
        let value = event.target.value;
        let max = $target.attr('max');
        let chIndex = $target.data('idx');
        value = (max > SLIDER_INCR_CUTOFF) ? value : value.toFixed(2);
        // simply update the correct text input...
        if ($target.hasClass("ch_start_slider")){
            $(`.channel_slider_${chIndex} .ch_start input`).val(value);
        } else {
            $(`.channel_slider_${chIndex}  .ch_end input`).val(value);
        }
    },

    channel_slider_stop: function(event) {
        // Handle slide -> stop for start slider and end slider
        console.log("stop", this, event.target.value);
        let $target = $(event.target);
        let chIndex = $target.data('idx');
        let toUpdate = {};
        // Save change to 'start' or 'end' value;
        if ($target.hasClass("ch_start_slider")) {
            toUpdate.start = event.target.value;
        } else {
            toUpdate.end = event.target.value;
        }
        this.models.forEach(function(m) {
            m.save_channel_window(chIndex, toUpdate);
        });
    },

    clear: function() {
        // $(".ch_slider").slider("destroy");
        $("#channel_sliders").empty();
        return this;
    },

    render: function() {
        var json,
            self = this;

            // Helper functions for map & reduce below
            var addFn = function (prev, s) {
                return prev + s;
            };
            var getColor = function(idx) {
                return function(ch) {
                    return ch[idx].color;
                }
            }
            var getLabel = function(idx) {
                return function(ch) {
                    return ch[idx].label;
                }
            }
            var getReverse = function(idx) {
                return function(ch) {
                    // For older figures (created pre 5.3.0) might be undefined
                    return ch[idx].reverseIntensity === true;
                }
            }
            var getActive = function(idx) {
                return function(ch) {
                    return ch[idx].active === true;
                }
            }
            var windowFn = function (idx, attr) {
                return function (ch) {
                    return ch[idx].window[attr];
                }
            };
            var allEqualFn = function(prev, value) {
                return value === prev ? prev : undefined;
            };
            var reduceFn = function(fn) {
                return function(prev, curr) {
                    return fn(prev, curr);
                }
            }

            // Comare channels from each Panel Model to see if they are
            // compatible, and compile a summary json.
            var chData = this.models.map(function(m){
                return m.get('channels');
            });
            // images are compatible if all images have same channel count
            var allSameCount = chData.reduce(function(prev, channels){
                return channels.length === prev ? prev : false;
            }, chData[0].length);

            if (!allSameCount) {
                return this;
            }
            // $(".ch_slider").slider("destroy");
            this.$el.empty();

            chData[0].forEach(function(d, chIdx) {
                // For each channel, summarise all selected images:
                // Make list of various channel attributes:
                var starts = chData.map(windowFn(chIdx, 'start'));
                var ends = chData.map(windowFn(chIdx, 'end'));
                var mins = chData.map(windowFn(chIdx, 'min'));
                var maxs = chData.map(windowFn(chIdx, 'max'));
                var colors = chData.map(getColor(chIdx));
                var reverses = chData.map(getReverse(chIdx));
                var actives = chData.map(getActive(chIdx));
                var labels = chData.map(getLabel(chIdx));
                // Reduce lists into summary for this channel
                var startAvg = starts.reduce(addFn, 0) / starts.length;
                var endAvg = ends.reduce(addFn, 0) / ends.length;
                var startsNotEqual = starts.reduce(allEqualFn, starts[0]) === undefined;
                var endsNotEqual = ends.reduce(allEqualFn, ends[0]) === undefined;
                var min = mins.reduce(reduceFn(Math.min));
                var max = maxs.reduce(reduceFn(Math.max));
                if (max > SLIDER_INCR_CUTOFF) {
                    // If we have a large range, use integers, otherwise format to 2dp
                    startAvg = parseInt(startAvg);
                    endAvg = parseInt(endAvg);
                } else {
                    startAvg = startAvg.toFixed(2);
                    endAvg = endAvg.toFixed(2);
                }
                var color = colors.reduce(allEqualFn, colors[0]) ? colors[0] : 'ccc';
                // allEqualFn for booleans will return undefined if not or equal
                var label = labels.reduce(allEqualFn, labels[0]) ? labels[0] : ' ';
                var reverse = reverses.reduce(allEqualFn, reverses[0]) ? true : false;
                var active = actives.reduce(allEqualFn, actives[0]);
                var style = {'background-position': '0 0'}
                var sliderClass = '';
                var lutBgPos = FigureLutPicker.getLutBackgroundPosition(color);
                if (color.endsWith('.lut')) {
                    style['background-position'] = lutBgPos;
                    sliderClass = 'lutBg';
                } else if (color.toUpperCase() === "FFFFFF") {
                    color = "ccc";  // white slider would be invisible
                }
                if (reverse) {
                    style.transform = 'scaleX(-1)';
                }
                if (color == "FFFFFF") color = "ccc";  // white slider would be invisible

                // Make sure slider range is increased if needed to include current values
                min = Math.min(min, startAvg);
                max = Math.max(max, endAvg);

                var sliderHtml = self.template({'idx': chIdx,
                                                'label': label,
                                                'startAvg': startAvg,
                                                'startsNotEqual': startsNotEqual,
                                                'endAvg': endAvg,
                                                'endsNotEqual': endsNotEqual,
                                                'min': min,
                                                'max': max,
                                                'step': (max > SLIDER_INCR_CUTOFF) ? 1 : 0.01,
                                                'active': active,
                                                'lutBgPos': lutBgPos,
                                                'reverse': reverse,
                                                'color': color,
                                                'isDark': this.isDark(color)});
                var $div = $(sliderHtml).appendTo(this.$el);

                // $div.find('.ch_slider').slider({
                //     range: true,
                //     min: min,
                //     max: max,
                //     step: (max > SLIDER_INCR_CUTOFF) ? 1 : 0.01,
                //     values: [startAvg, endAvg],
                //     slide: function(event, ui) {
                //         let chStart = (max > SLIDER_INCR_CUTOFF) ? ui.values[0] : ui.values[0].toFixed(2);
                //         let chEnd = (max > SLIDER_INCR_CUTOFF) ? ui.values[1] : ui.values[1].toFixed(2);
                //         $('.ch_start input', $div).val(chStart);
                //         $('.ch_end input', $div).val(chEnd);
                //     },
                //     stop: function(event, ui) {
                //         self.models.forEach(function(m) {
                //             m.save_channel_window(chIdx, {'start': ui.values[0], 'end': ui.values[1]});
                //         });
                //     }
                // })
                // // Need to add background style to newly created div.ui-slider-range
                // .children('.ui-slider-range').css(style)
                // .addClass(sliderClass);

            }.bind(this));
        return this;
    }
});

export default ChannelSliderView
