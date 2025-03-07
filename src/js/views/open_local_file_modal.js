
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
        let demoUrl = "https://gist.githubusercontent.com/will-moore/fe0e260544b46af6e1e523b288fc85bc/raw/3772939e68769e1c9d30db8d7fee528f14888ef3/OMERO.figure_NGFF_demo.json";
        $(".figureFileUrl", this.el).val(demoUrl);
        this.enableSubmit();

        // when dialog is shown, clear and render
        // document.getElementById('openLocalFileModal').addEventListener('shown.bs.modal', () => {
            // self.render();
        //});
    },

    events: {
        "submit .openLocalFileForm": "handleOpenFile",
        "input .figureFileUrl": "enableSubmit",
        "input input[type='file']": "enableSubmit",
    },

    enableSubmit: function(event) {
        let figureFileUrl = $(".figureFileUrl", this.el).val();
        let localFile = $("input[type='file']", this.el).val();
        console.log("enableSubmit", figureFileUrl, localFile);

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

        console.log("figureFileUrl", figureFileUrl);
        console.log("localFile", localFile);
        console.log("this.app", this.app);
        
        if (localFile) {
            // upload JSON file and open figure
        } else if (figureFileUrl) {
            console.log("/omero-figure/?file=" + figureFileUrl);
            // go to ?file=figureFileUrl
            this.app.navigate("/omero-figure/?file=" + figureFileUrl, {trigger: true});
        }
        hideModal("openLocalFileModal");
        return false;
    },

    render: function() {
        
    }
});
