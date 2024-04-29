// Import our custom CSS based on bootstrap
import "../scss/styles.scss";

import "../css/figure.css";

// Import all of Bootstrap's JS
import * as bootstrap from "bootstrap";

import Backbone from "backbone";
import $ from "jquery";

import FigureModel from "./models/figure_model";
import createFigureView from "./views/figure_view";
import SvgView from "./views/svg_model_view";
import RightPanelView from "./views/right_panel_view";
import { UndoManager, UndoView } from "./models/undo";

import { ajaxSetup } from "./views/util.csrf";
import { hideModals, showModal } from "./views/util";

const figureModel = new FigureModel();
// make this global so we can access it from the browser console
window.figureModel = figureModel;

const RELEASE_VERSION = import.meta.env.VITE_VERSION;
console.log("RELEASE_VERSION", RELEASE_VERSION);
document.getElementById("release_version").innerHTML = RELEASE_VERSION;

// Override 'Backbone.sync'...
Backbone.ajaxSync = Backbone.sync;

// TODO: - Use the undo/redo queue instead of sync to trigger figureModel.set("unsaved", true);

// If syncOverride, then instead of actually trying to Save via ajax on model.save(attr, value)
// We simply set the 'unsaved' flag on the figureModel.
// This works for FigureModel and also for Panels collection.
Backbone.getSyncMethod = function (model) {
  if (
    model.syncOverride ||
    (model.collection && model.collection.syncOverride)
  ) {
    return function (method, model, options, error) {
      figureModel.set("unsaved", true);
    };
  }
  return Backbone.ajaxSync;
};

// Override 'Backbone.sync' to default to localSync,
// the original 'Backbone.sync' is still available in 'Backbone.ajaxSync'
Backbone.sync = function (method, model, options, error) {
  return Backbone.getSyncMethod(model).apply(this, [
    method,
    model,
    options,
    error,
  ]);
};

new SvgView({ model: figureModel });
new RightPanelView({ model: figureModel });

if (PING_URL) {
  // keep-alive ping every minute, so that OMERO session doesn't die
  setInterval(function () {
    fetch(PING_URL);
  }, 60000);
}

// Undo Model and View
var undoManager = new UndoManager({ figureModel: figureModel }),
  undoView = new UndoView({ model: undoManager });
// Finally, start listening for changes to panels
undoManager.listenToCollection(figureModel.panels);

var FigureRouter = Backbone.Router.extend({
  routes: {
    "": "index",
    "new(/)": "newFigure",
    "recover(/)": "recoverFigure",
    "open(/)": "openFigure",
    "file/:id(/)": "loadFigure",
  },

  index: function () {
    console.log("index");
    hideModals();
    var cb = () => {
      showModal("welcomeModal");
    };
    figureModel.checkSaveAndClear(cb);
  },

  openFigure: function () {
    console.log("openFigure...");
    hideModals();
    var cb = function () {
      showModal("openFigureModal");
    };
    figureModel.checkSaveAndClear(cb);
  },

  recoverFigure: function () {
    hideModals();
    figureModel.recoverFromLocalStorage();
  },

  newFigure: function () {
    console.log("newFigure");
    hideModals();
    var cb = function () {
      showModal("addImagesModal");
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
    figureModel.checkSaveAndClear(cb);
  },

  loadFigure: function (id) {
    console.log("LoadFigure", id);
    hideModals();
    var fileId = parseInt(id, 10);
    var cb = function () {
      figureModel.load_from_OMERO(fileId);
    };
    figureModel.checkSaveAndClear(cb);
  },
});

let config = { pushState: true };
// when deployed from omero-web...
if (APP_ROOT_URL) {
  config.root = APP_ROOT_URL;
}

// jQuery ajaxSetup for COORs
ajaxSetup();

const app = new FigureRouter();

createFigureView({ model: figureModel, app })

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
