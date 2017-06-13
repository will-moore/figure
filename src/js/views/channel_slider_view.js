
var ChannelSliderView = Backbone.View.extend({

    template: JST["src/templates/channel_slider_template.html"],

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
            var reverse = $('span', e.currentTarget).hasClass('glyphicon-ok');
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
        var value = parseInt(event.target.value, 10);
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

    clear: function() {
        $(".ch_slider").slider("destroy");
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
            $(".ch_slider").slider("destroy");
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
                // Reduce lists into summary for this channel
                var startAvg = parseInt(starts.reduce(addFn, 0) / starts.length, 10);
                var endAvg = parseInt(ends.reduce(addFn, 0) / ends.length, 10);
                var startsNotEqual = starts.reduce(allEqualFn, starts[0]) === undefined;
                var endsNotEqual = ends.reduce(allEqualFn, ends[0]) === undefined;
                var min = mins.reduce(reduceFn(Math.min), 9999);
                var max = maxs.reduce(reduceFn(Math.max), -9999);
                var color = colors.reduce(allEqualFn, colors[0]) ? colors[0] : 'ccc';
                // allEqualFn for booleans will return undefined if not or equal
                var reverse = reverses.reduce(allEqualFn, reverses[0]) ? true : false;
                var active = actives.reduce(allEqualFn, actives[0]);
                var style = {'background-position': '0 0'}
                var sliderClass = '';
                var lutBgPos = FigureLutPicker.getLutBackgroundPosition(color);
                if (color.endsWith('.lut')) {
                    style['background-position'] = lutBgPos;
                    sliderClass = 'lutBg';
                }
                if (reverse) {
                    style.transform = 'scaleX(-1)';
                }
                if (color == "FFFFFF") color = "ccc";  // white slider would be invisible

                // Make sure slider range is increased if needed to include current values
                min = Math.min(min, startAvg);
                max = Math.max(max, endAvg);

                var sliderHtml = self.template({'idx': chIdx,
                                                'startAvg': startAvg,
                                                'startsNotEqual': startsNotEqual,
                                                'endAvg': endAvg,
                                                'endsNotEqual': endsNotEqual,
                                                'active': active,
                                                'lutBgPos': lutBgPos,
                                                'reverse': reverse,
                                                'color': color});
                var $div = $(sliderHtml).appendTo(this.$el);

                $div.find('.ch_slider').slider({
                    range: true,
                    min: min,
                    max: max,
                    values: [startAvg, endAvg],
                    slide: function(event, ui) {
                        $('.ch_start input', $div).val(ui.values[0]);
                        $('.ch_end input', $div).val(ui.values[1]);
                    },
                    stop: function(event, ui) {
                        self.models.forEach(function(m) {
                            m.save_channel_window(chIdx, {'start': ui.values[0], 'end': ui.values[1]});
                        });
                    }
                })
                // Need to add background style to newly created div.ui-slider-range
                .children('.ui-slider-range').css(style)
                .addClass(sliderClass);

            }.bind(this));
        return this;
    }
});