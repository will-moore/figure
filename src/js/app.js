
//
// Copyright (C) 2014 University of Dundee & Open Microscopy Environment.
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

$(function(){

    window.figureModel = new FigureModel();

    window.FigureColorPicker = new ColorPickerView();
    window.FigureLutPicker = new LutPickerView();

    // Override 'Backbone.sync'...
    Backbone.ajaxSync = Backbone.sync;

    // TODO: - Use the undo/redo queue instead of sync to trigger figureModel.set("unsaved", true);

    // If syncOverride, then instead of actually trying to Save via ajax on model.save(attr, value)
    // We simply set the 'unsaved' flag on the figureModel.
    // This works for FigureModel and also for Panels collection.
    Backbone.getSyncMethod = function(model) {
        if(model.syncOverride || (model.collection && model.collection.syncOverride))
        {
            return function(method, model, options, error) {
                figureModel.set("unsaved", true);
            };
        }
        return Backbone.ajaxSync;
    };

    // Override 'Backbone.sync' to default to localSync,
    // the original 'Backbone.sync' is still available in 'Backbone.ajaxSync'
    Backbone.sync = function(method, model, options, error) {
        return Backbone.getSyncMethod(model).apply(this, [method, model, options, error]);
    };


    var view = new FigureView( {model: figureModel});   // uiState: uiState
    var svgView = new SvgView( {model: figureModel});
    new RightPanelView({model: figureModel});


    // Undo Model and View
    var undoManager = new UndoManager({'figureModel':figureModel}),
    undoView = new UndoView({model:undoManager});
    // Finally, start listening for changes to panels
    undoManager.listenToCollection(figureModel.panels);


    var FigureRouter = Backbone.Router.extend({

        routes: {
            "": "index",
            "new(/)": "newFigure",
            "open(/)": "openFigure",
            "file/:id(/)": "loadFigure",
        },

        checkSaveAndClear: function(callback) {

            var doClear = function() {
                figureModel.clearFigure();
                if (callback) {
                    callback();
                }
            };
            if (figureModel.get("unsaved")) {

                var saveBtnTxt = "Save",
                    canEdit = figureModel.get('canEdit');
                if (!canEdit) saveBtnTxt = "Save a Copy";
                // show the confirm dialog...
                figureConfirmDialog("Save Changes to Figure?",
                    "Your changes will be lost if you don't save them",
                    ["Don't Save", saveBtnTxt],
                    function(btnTxt){
                        if (btnTxt === saveBtnTxt) {
                             var options = {};
                            // Save current figure or New figure...
                            var fileId = figureModel.get('fileId');
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
                    });
            } else {
                doClear();
            }
        },

        index: function() {
            $(".modal").modal('hide'); // hide any existing dialogs
            var cb = function() {
                $('#welcomeModal').modal();
            };
            this.checkSaveAndClear(cb);
        },

        openFigure: function() {
            $(".modal").modal('hide'); // hide any existing dialogs
            var cb = function() {
                $("#openFigureModal").modal();
            };
            this.checkSaveAndClear(cb);
        },

        newFigure: function() {
            $(".modal").modal('hide'); // hide any existing dialogs
            var cb = function() {
                $('#addImagesModal').modal();
            };
            // Check for ?image=1&image=2
            if (window.location.search.length > 1) {
                var params = window.location.search.substring(1).split('&');
                var iids = params.reduce(function(prev, param){
                    if (param.split('=')[0] === 'image') {
                        prev.push(param.split('=')[1]);
                    }
                    return prev;
                },[]);
                if (iids.length > 0) {
                    cb = function() {
                        figureModel.addImages(iids);
                    }
                }
            }
            this.checkSaveAndClear(cb);
         },

        loadFigure: function(id) {
            $(".modal").modal('hide'); // hide any existing dialogs
            var fileId = parseInt(id, 10);
            var cb = function() {
                figureModel.load_from_OMERO(fileId);
            };
            this.checkSaveAndClear(cb);
        }
    });

    app = new FigureRouter();
    Backbone.history.start({pushState: true, root: BASE_WEBFIGURE_URL});

    // We want 'a' links (E.g. to open_figure) to use app.navigate
    $(document).on('click', 'a', function (ev) {
        var href = $(this).attr('href');
        // check that links are 'internal' to this app
        if (href.substring(0, BASE_WEBFIGURE_URL.length) === BASE_WEBFIGURE_URL) {
            ev.preventDefault();
            href = href.replace(BASE_WEBFIGURE_URL, "/");
            app.navigate(href, {trigger: true});
        }
    });

});
