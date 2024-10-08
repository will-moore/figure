
//
// Copyright (C) 2016 University of Dundee & Open Microscopy Environment.
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
import _ from 'underscore';
import * as bootstrap from "bootstrap"

import lut_picker_template from '../../templates/lut_picker.template.html?raw';
import { showModal } from "./util";

var lutsPngUrl;
fetch('/get_lut_url/')
    .then(response => response.json())  // Parse the response as JSON
    .then(data => {
        lutsPngUrl = STATIC_DIR + data.lut_url;  // Get the URL from the response
    });

// Should only ever have a singleton on this
var LutPickerView = Backbone.View.extend({

    el: $("#lutpickerModal"),

    template: _.template(lut_picker_template),

    initialize:function () {
        this.lutModal = new bootstrap.Modal('#lutpickerModal');
    },


    events: {
        "click button[type='submit']": "handleSubmit",
        "click .lutOption": "pickLut",
    },

    handleSubmit: function() {
        this.success(this.pickedLut);
        this.lutModal.hide();
    },

    pickLut: function(event) {
        var lutName = event.currentTarget.getAttribute('data-lut');
        // Save the name - used in handleSubmit();
        this.pickedLut = lutName;

        // Update preview to show LUT
        var bgPos = this.getLutBackgroundPosition(lutName);
        $(".lutPreview", this.el).css({'background-position': bgPos, 'background-image': `url(${lutsPngUrl})`});
        // Enable OK button
        $("button[type='submit']", this.el).removeAttr('disabled');
    },

    loadLuts: function() {
        var url = WEBGATEWAYINDEX + 'luts/';
        let cors_headers = { mode: 'cors', credentials: 'include' };
        return fetch(url, cors_headers).then(rsp => rsp.json());
    },

    getLutBackgroundPosition: function(lutName) {
        var lutIndex = this.lut_names.indexOf(lutName);
        if (lutIndex > -1) {
            return '0px -' + ((lutIndex * 50) +2) + 'px';
        } else {
            return '0px 100px';  // hides background
        }
    },

    formatLutName: function(lutName) {
        lutName = lutName.replace(".lut", "");
        lutName = lutName.replace(/_/g, " ");
        // Title case
        lutName = lutName[0].toUpperCase() + lutName.slice(1);
        return lutName;
    },

    show: function(options) {

        showModal("lutpickerModal");

        // save callback to use on submit
        if (options.success) {
            this.success = options.success;
        }

        this.loadLuts().then((data) => {
            console.log('data', data);
            this.luts = data.luts;
            this.lut_names = data.png_luts;
            var is_dynamic_lut = ("png_luts_new" in this.data);
            if (is_dynamic_lut){
                this.luts = this.luts.map(function(lut) {
                    lut.png_index = lut.png_index_new;
                    return lut;
                });
                this.lut_names = data.png_luts_new;
            }

            this.render();
        });
    },

    render:function() {
        var html = "",
            luts;
        if (!this.luts) {
            html = "<p>Loading Lookup Tables failed.</p>";
            html += "<p>Your OMERO version does not support LUTs. Please upgrade.</p>";
        } else {
            luts = this.luts.map(function(lut) {
                // Add css background-position to each lut to offset luts_10.png
                return {'bgPos': this.getLutBackgroundPosition(lut.name),
                        'name': lut.name,
                        'displayName': this.formatLutName(lut.name)};
            }.bind(this));
            html = this.template({'luts': luts, lutsPngUrl});
        }
        $(".modal-body", this.el).html(html);
    }
});

const FigureLutPicker = new LutPickerView();

export default FigureLutPicker
