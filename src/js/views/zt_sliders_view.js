
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";

// This simply handles buttons to increment time/z
// since other views don't have an appropriate container
const ZtSlidersView = Backbone.View.extend({

    className: "ztSliders",

    initialize: function(opts) {
        this.models = opts.models;

        this.models.forEach(m => {
            this.listenTo(m, 'change:z_projection change:theT change:theZ change:z_start', this.render);
        });

        this.render();
    },

    events: {
        "click .z-increment": "z_increment",
        "click .z-decrement": "z_decrement",
        "click .time-increment": "time_increment",
        "click .time-decrement": "time_decrement",
        "input #vp_t_slider input[type='range']": "slide_time",
        "change #vp_t_slider input[type='range']": "slidestop_time",
        "input #vp_z_slider input[type='range']": "slide_z",
        "change #vp_z_slider input[type='range']": "slidestop_z",
        "mousemove .z_start": "start_slider_mousemove",
        "mousemove .z_end": "end_slider_mousemove",
    },

    start_slider_mousemove: function(event) {
        // To avoid clicking start-slider when the mouse is ABOVE the midpoint (between slider handles)
        // On mouseover we add pointer events to end-slider (which is on top, so clicks will be handled by it)
        let $target = $(event.target);
        let fraction = event.offsetX/$target.width();
        let midfraction = this.get_midfraction($target);
        if (fraction > midfraction) {
            $(".z_end", $target.parent()).css("pointer-events", "all");
        }
    },

    end_slider_mousemove: function(event) {
        // To avoid clicking end-slider when the mouse is BELOW the midpoint (between slider handles)
        // On mouseover we REMOVE pointer events from end-slider (so they fall to the start-slider underneath)
        let $target = $(event.target);
        let fraction = event.offsetX/$target.width();
        let midfraction = this.get_midfraction($target);
        if (fraction < midfraction) {
            $target.css("pointer-events", "none");
        }
    },

    get_midfraction($target) {
        let start = parseInt($("#vp_z_slider .z_start").val());
        let end = parseInt($("#vp_z_slider .z_end").val());
        let midvalue = (start + end) / 2;
        let minval = parseFloat($target.attr('min'));
        let maxval = parseFloat($target.attr('max'));
        return (midvalue - minval) / (maxval - minval);
    },

    slide_time(event) {
        var theT = event.target.value;
        $("#vp_t_value").text(theT + "/" + (this.sizeT || '-'));
        var dt = this.models.head().get('deltaT')[theT-1];
        this.models.forEach(function(m){
            if (m.get('deltaT')[theT-1] != dt) {
                dt = undefined;
            }
        });
        $("#vp_deltaT").text(this.formatTime(dt));
    },

    slidestop_time(event) {
        this.models.forEach(function(m){
            m.save('theT', event.target.value - 1);
        });
    },

    slide_z(event) {
        // Handles z_start and z_end sliders
        // TODO: cache z_projection?
        var z_projection = this.models.allTrue('z_projection');
        let $target = $(event.target);
        let value = parseInt(event.target.value);
        let start = parseInt($("#vp_z_slider .z_start").val());
        let end = parseInt($("#vp_z_slider .z_end").val());

        const sliding_start = $target.hasClass("z_start");
        if (z_projection) {
            // ensure that start < end
            if (sliding_start) {
                if (value >= end) {
                    $target.val(end - 1);
                    return;
                }
            } else {
                if (value <= start) {
                    $target.val(start + 1);
                    return;
                }
            }
            start = start + "-" + end;
        }
        $("#vp_z_value").text(start + "/" + this.sizeZ);
    },

    slidestop_z(event) {
        var z_projection = this.models.allTrue('z_projection');
        let start = $("#vp_z_slider .z_start").val();
        let end = $("#vp_z_slider .z_end").val();

        this.models.forEach(function(m){
            if (z_projection) {
                m.save({
                    'z_start': start - 1,
                    'z_end': end - 1
                });
            } else {
                m.save('theZ', event.target.value - 1);
            }
        });
    },

    formatTime: function(seconds) {

        if (typeof seconds === 'undefined') {
            return "";
        }
        var isNegative = seconds < 0;
        seconds = Math.abs(seconds);
        function leftPad(s) {
            s = s + '';
            if (s.split('.')[0].length === 1) return '0' + s;
            return s;
        }
        var hours = parseInt(seconds / 3600);
        var mins = parseInt(seconds % 3600 / 60);
        var secs = (seconds % 60).toFixed(2);
        return (isNegative ? '-' : '') + leftPad(hours) + ":" + leftPad(mins) + ":" + leftPad(secs);
    },

    z_increment: function(event) {
        this.models.forEach(function(m){
            var newZ = {};
            if (m.get('z_projection')) {
                newZ.z_start = m.get('z_start') + 1;
                newZ.z_end = m.get('z_end') + 1;
            } else {
                newZ.theZ = m.get('theZ') + 1;
            }
            m.set(newZ, {'validate': true});
        });
        return false;
    },
    z_decrement: function(event) {
        this.models.forEach(function(m){
            var newZ = {};
            if (m.get('z_projection')) {
                newZ.z_start = m.get('z_start') - 1;
                newZ.z_end = m.get('z_end') - 1;
            } else {
                newZ.theZ = m.get('theZ') - 1;
            }
            m.set(newZ, {'validate': true});
        });
        return false;
    },
    time_increment: function(event) {
        this.models.forEach(function(m){
            m.set({'theT': m.get('theT') + 1}, {'validate': true});
        });
        return false;
    },
    time_decrement: function(event) {
        this.models.forEach(function(m){
            m.set({'theT': m.get('theT') - 1}, {'validate': true});
        });
        return false;
    },

    render_z_t_labels: function() {
        // Rendering Z/T labels without rendering whole component
        // means we don't re-build z/t sliders (they don't lose focus)
        var sizeZ = this.models.getIfEqual('sizeZ');
        var sizeT = this.models.getIfEqual('sizeT');
        var theT = this.models.getAverage('theT');
        var theZ = this.models.getAverage('theZ');
        var z_projection = this.models.allTrue('z_projection');
        var deltaT = this.models.getDeltaTIfEqual();

        var Z_disabled = false,
            Z_max = sizeZ;
        if (!sizeZ || sizeZ === 1) {    // undefined or 1
            Z_disabled = true;
            Z_max = 1;
            $("#vp_z_slider", this.$el).hide();
        } else {
            $("#vp_z_slider", this.$el).show();
        }

        var T_disabled = false;
        var T_slider_max = this.models.getMin('sizeT');
        if (T_slider_max === 1) {
            T_disabled = true;
            $("#vp_t_slider", this.$el).hide();
        } else {
            $("#vp_t_slider", this.$el).show();
        }
        var z_label = theZ + 1;
        $("#vp_z_slider input[type='range']", this.$el).val(theZ + 1)
        if (z_projection) {
            var z_start = Math.round(this.models.getAverage('z_start'));
            var z_end = Math.round(this.models.getAverage('z_end'));
            z_label = (z_start + 1) + "-" + (z_end + 1);
            $("#vp_z_slider .z_end", this.$el).val(z_end + 1);
            $("#vp_z_slider .z_start", this.$el).val(z_start + 1);
        } else if (!this.models.allEqual('theZ')) {
            z_label = "-";
        }
        // $("#vp_z_slider").slider({'value': theZ + 1});
        $("#vp_z_value", this.$el).text(z_label + "/" + (sizeZ || '-'));

        var t_label = theT + 1;
        var dt_label;
        if (!this.models.allEqual('theT')) {
            t_label = "-";
        }
        $("#vp_t_slider input[type='range']", this.$el).val(theT + 1)
        $("#vp_t_value", this.$el).show().text(t_label + "/" + (sizeT || '-'));

        if ((deltaT === 0 || deltaT) && sizeT > 1) {
            dt_label = this.formatTime(deltaT);
        } else {
            dt_label = "";
        }
        $("#vp_deltaT", this.$el).text(dt_label);
    },

    render() {
        var theZ = this.models.getAverage('theZ'),
            z_start = Math.round(this.models.getAverage('z_start')),
            z_end = Math.round(this.models.getAverage('z_end')),
            theT = this.models.getAverage('theT'),
            sizeZ = this.models.getIfEqual('sizeZ'),
            sizeT = this.models.getIfEqual('sizeT'),
            deltaT = this.models.getDeltaTIfEqual(),
            z_projection = this.models.allTrue('z_projection'),
            dt_label = "";

        // cache some values, so we don't need to re-calculate on slide...\
        this.sizeZ = sizeZ;
        this.sizeT = sizeT;

        // update sliders
        var Z_disabled = false;
        var Z_max = sizeZ;
        if (!sizeZ || sizeZ === 1) {    // undefined or 1
            Z_disabled = true;
            Z_max = 1;
        }

        // T-slider should be enabled even if we have a mixture of sizeT values.
        // Slider T_max is the minimum of sizeT values
        // Slider value is average of theT values (but smaller than T_max)
        var T_slider_max = this.models.getMin('sizeT');
        var T_disabled = (T_slider_max === 1);
        if ((deltaT === 0 || deltaT) && sizeT > 1) {
            dt_label = this.formatTime(deltaT);
        }
        var t_slider_value = Math.min(theT, T_slider_max);

        var t_label = theT + 1;
        var dt_label;
        if (!this.models.allEqual('theT')) {
            t_label = "-";
        }

        var z_label = theZ + 1;
        if (z_projection) {
            theZ = z_start;
            z_label = (z_start + 1) + "-" + (z_end + 1);
        } else if (!this.models.allEqual('theZ')) {
            z_label = "-";
        }

        this.$el.html(`<div id="vp_z_label">Z</div>
        <div id="vp_z_value">${ z_label }/${ (sizeZ || '-') }</div>
        <div id="vp_t_label">T</div>
        <div id="vp_t_value">${ t_label }/${ (sizeT || '-') }</div>
        <div id="vp_deltaT">${dt_label}</div>
        
        <div id="vp_z_slider" style="${Z_disabled ? "display:none" : ""}">
            <input type="range" class="z_start" value="${theZ + 1}" min="1" max="${Z_max}" />
            <input type="range" class="z_end" value="${z_end + 1}" min="1" max="${Z_max}" style="${!z_projection ? "display:none" : ""}" />
            <button
              type="button"
              class="btn btn-link btn-sm z-decrement"
              title="Decrease Z-index">
                <i class="bi-chevron-down" style="font-size: 1rem"></i>
            </button>
            <button
              type="button"
              class="btn btn-link btn-sm z-increment"
              title="Increase Z-index">
                <i class="bi-chevron-up" style="font-size: 1rem"></i>
            </button>
        </div>
        
        <div id="vp_t_slider" style="${T_disabled ? "display:none" : ""}">
            <input type="range" value="${t_slider_value + 1}" min="1" max="${T_slider_max}" />
            <button
              type="button"
              class="btn btn-link btn-sm time-decrement"
              title="Decrease T-index">
                <i class="bi-chevron-left" style="font-size: 1rem"></i>
            </button>
            <button
              type="button"
              class="btn btn-link btn-sm time-increment"
              title="Increase T-index">
                <i class="bi-chevron-right" style="font-size: 1rem"></i>
            </button>
        </div>`);
    }
});

export default ZtSlidersView;
