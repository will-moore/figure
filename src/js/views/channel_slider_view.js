
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
            var windowFn = function (idx, attr) {
                return function (ch) {
                    return ch[idx].window[attr];
                }
            };
            var allEqualFn = function(prev, value) {
                return value === prev ? prev : false;
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
                // Reduce lists into summary for this channel
                var startAvg = parseInt(starts.reduce(addFn, 0) / starts.length, 10);
                var endAvg = parseInt(ends.reduce(addFn, 0) / ends.length, 10);
                var startsNotEqual = starts.reduce(allEqualFn, starts[0]) === false;
                var endsNotEqual = ends.reduce(allEqualFn, ends[0]) === false;
                var min = mins.reduce(reduceFn(Math.min), 9999);
                var max = maxs.reduce(reduceFn(Math.max), -9999);
                var color = colors.reduce(allEqualFn, colors[0]) ? colors[0] : 'ccc';
                var lutBgPos = FigureLutPicker.getLutBackgroundPosition(color);
                if (color == "FFFFFF") color = "ccc";  // white slider would be invisible

                // Make sure slider range is increased if needed to include current values
                min = Math.min(min, startAvg);
                max = Math.max(max, endAvg);

                var sliderHtml = self.template({'idx': chIdx,
                                                'startAvg': startAvg,
                                                'startsNotEqual': startsNotEqual,
                                                'endAvg': endAvg,
                                                'endsNotEqual': endsNotEqual,
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
                .children('.ui-slider-range').css('background-position', lutBgPos)
            }.bind(this));
        return this;
    }
});