// Import our custom CSS
import "../scss/styles.scss";

// Import all of Bootstrap's JS
import * as bootstrap from "bootstrap";

import Backbone from "backbone";

var FigureRouter = Backbone.Router.extend({
  routes: {
    "": "index",
    "new(/)": "newFigure",
    "recover(/)": "recoverFigure",
    "open(/)": "openFigure",
    "file/:id(/)": "loadFigure",
  },

  checkSaveAndClear: function (callback) {
    var doClear = function () {
      figureModel.clearFigure();
      if (callback) {
        callback();
      }
    };
    if (figureModel.get("unsaved")) {
      var saveBtnTxt = "Save",
        canEdit = figureModel.get("canEdit");
      if (!canEdit) saveBtnTxt = "Save a Copy";
      // show the confirm dialog...
      figureConfirmDialog(
        "Save Changes to Figure?",
        "Your changes will be lost if you don't save them",
        ["Don't Save", saveBtnTxt],
        function (btnTxt) {
          if (btnTxt === saveBtnTxt) {
            var options = {};
            // Save current figure or New figure...
            var fileId = figureModel.get("fileId");
            if (fileId && canEdit) {
              options.fileId = fileId;
            } else {
              var defaultName = figureModel.getDefaultFigureName();
              var figureName = prompt("Enter Figure Name", defaultName);
              options.figureName = figureName || defaultName;
            }
            options.success = doClear;
            figureModel.save_to_OMERO(options);
          } else if (btnTxt === "Don't Save") {
            figureModel.set("unsaved", false);
            doClear();
          } else {
            doClear();
          }
        }
      );
    } else {
      doClear();
    }
  },

  index: function () {
    console.log("index");
    // $(".modal").modal("hide"); // hide any existing dialogs
    var cb = function () {
      // $("#welcomeModal").modal();
    };
    this.checkSaveAndClear(cb);
  },

  openFigure: function () {
    console.log("openFigure...");
    // $(".modal").modal("hide"); // hide any existing dialogs
    var cb = function () {
      // $("#openFigureModal").modal();
    };
    this.checkSaveAndClear(cb);
  },

  recoverFigure: function () {
    // $(".modal").modal("hide"); // hide any existing dialogs
    figureModel.recoverFromLocalStorage();
  },

  newFigure: function () {
    console.log("newFigure");
    // $(".modal").modal("hide"); // hide any existing dialogs
    var cb = function () {
      // $("#addImagesModal").modal();
    };
    // Check for ?image=1&image=2
    if (window.location.search.length > 1) {
      var params = window.location.search.substring(1).split("&");
      var iids = params.reduce(function (prev, param) {
        if (param.split("=")[0] === "image") {
          prev.push(param.split("=")[1]);
        }
        return prev;
      }, []);
      if (iids.length > 0) {
        cb = function () {
          figureModel.addImages(iids);
        };
      }
    }
    this.checkSaveAndClear(cb);
  },

  loadFigure: function (id) {
    console.log("LoadFigure", id);
    // $(".modal").modal("hide"); // hide any existing dialogs
    var fileId = parseInt(id, 10);
    var cb = function () {
      figureModel.load_from_OMERO(fileId);
    };
    this.checkSaveAndClear(cb);
  },
});

let config = { pushState: true };
// when deployed from omero-web...
if (BASE_WEBFIGURE_URL) {
  config.root = BASE_WEBFIGURE_URL;
}

const app = new FigureRouter();
Backbone.history.start(config);


// We want 'a' links (E.g. to open_figure) to use app.navigate
$(document).on("click", "a", function (ev) {
  var href = $(this).attr("href");
  // check that links are 'internal' to this app
  if (href.substring(0, BASE_WEBFIGURE_URL.length) === BASE_WEBFIGURE_URL) {
    ev.preventDefault();
    href = href.replace(BASE_WEBFIGURE_URL, "/");
    app.navigate(href, { trigger: true });
  }
});
