
// Events, show/hide and rendering for various Modal dialogs.
import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";

import FigureModel from "../models/figure_model";
import { hideModal } from "./util";

export const OpenLocalFileModalView = Backbone.View.extend({

    el: $("#openLocalFileModal"),

    model: FigureModel,

    initialize: function(options) {

        this.app = options.app;
    
        // TEMP? show a default file to open
        let demoUrl = "https://gist.githubusercontent.com/will-moore/75a7f0de5be0f7b4202d5f0229cadcc9/raw/edf0f16c512942eb9fe347d22707a0fbcf33c917/ngff_images_figure.json";
        $(".figureFileUrl", this.el).val(demoUrl);
        this.enableSubmit();

        // when dialog is shown...
        document.getElementById('openLocalFileModal').addEventListener('shown.bs.modal', () => {
            // clear file input
            $("input[type='file']", this.el).val("");
        });
    },

    events: {
        "submit .openLocalFileForm": "handleOpenFile",
        "input .figureFileUrl": "enableSubmit",
        "input input[type='file']": "enableSubmit",
    },

    enableSubmit: function(event) {
        let figureFileUrl = $(".figureFileUrl", this.el).val();
        let localFile = $("input[type='file']", this.el).val();

        if (figureFileUrl || localFile) {
            $("button[type='submit'", this.el).prop("disabled", false);
        } else {
            $("button[type='submit'", this.el).prop("disabled", true);
        }
    },

    handleOpenFile: function(event) {
        event.preventDefault();

        let figureFileUrl = $(".figureFileUrl", this.el).val();
        let localFile = $("input[type='file']", this.el).val();
        
        if (localFile) {
            let file = $("input[type='file']", this.el)[0].files[0];
            // upload JSON file and open figure
            const reader = new FileReader();
            reader.onload = (evt) => {
                let figureData = JSON.parse(evt.target.result);
                this.model.clearFigure();
                this.model.load_from_JSON(figureData);
                this.model.set('unsaved', false);
            };
            reader.readAsBinaryString(file);
        } else if (figureFileUrl) {
            // go to ?file=figureFileUrl
            this.app.navigate(`${BASE_URL}?file=${figureFileUrl}`, {trigger: true});
        }
        hideModal("openLocalFileModal");
        return false;
    },

    render: function() {
        
    }
});
