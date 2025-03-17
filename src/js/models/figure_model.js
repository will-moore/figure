
    import Backbone from "backbone";
    import _ from 'underscore';
    import $ from "jquery";

    import {PanelList, Panel} from "./panel_model";
    import { recoverFigureFromStorage,
        clearFigureFromStorage,
        figureConfirmDialog,
        getJson,
        saveFigureToStorage} from "../views/util";
    import { loadZarrForPanel } from "./zarr_utils";

    // Version of the json file we're saving.
    // This only needs to increment when we make breaking changes (not linked to release versions.)
    var VERSION = 9;


    // ------------------------- Figure Model -----------------------------------
    // Has a PanelList as well as other attributes of the Figure
    var FigureModel = Backbone.Model.extend({

        defaults: {
            // 'curr_zoom': 100,
            'canEdit': true,
            'unsaved': false,
            'canvas_width': 13000,
            'canvas_height': 8000,
            // w & h from reportlab.
            'paper_width': 595,
            'paper_height': 842,
            'page_color': 'FFFFFF',
            'page_count': 1,
            'page_col_count': 1,    // pages laid out in grid
            'paper_spacing': 50,    // between each page
            'orientation': 'vertical',
            'page_size': 'A4',       // options [A4, letter, mm, pixels]
            // see http://www.a4papersize.org/a4-paper-size-in-pixels.php
            'width_mm': 210,    // A4 sizes, only used if user chooses page_size: 'mm'
            'height_mm': 297,
            'legend': '',       // Figure legend in markdown format.
            'legend_collapsed': true,   // collapse or expand legend
            'loading_count': 0,         // images being loaded (show spinner if > 0)
        },

        initialize: function() {
            this.panels = new PanelList();      //this.get("shapes"));

            // listen for new Panels added so we can pass in a reference
            // to this figureModel...
            this.panels.on('add', (panel) => {
                panel.setFigureModel(this);
            });

            // wrap selection notification in a 'debounce', so that many rapid
            // selection changes only trigger a single re-rendering
            this.notifySelectionChange = _.debounce( this.notifySelectionChange, 10);
        },

        syncOverride: function(method, model, options, error) {
            this.set("unsaved", true);
        },

        load_from_OMERO: function(fileId, success) {

            var load_url = BASE_WEBFIGURE_URL + "load_web_figure/" + fileId + "/",
                self = this;

            getJson(load_url).then(data => {
                data.fileId = fileId;
                self.load_from_JSON(data);
                self.set('unsaved', false);
            });
        },

        load_from_JSON: function(data) {
            var self = this;

            // bring older files up-to-date
            data = self.version_transform(data);

            var name = data.figureName || "UN-NAMED",
                n = {'fileId': data.fileId,
                    'figureName': name,
                    'groupId': data.group ? data.group.id : undefined,
                    'canEdit': data.canEdit,
                    'paper_width': data.paper_width,
                    'paper_height': data.paper_height,
                    'width_mm': data.width_mm,
                    'height_mm': data.height_mm,
                    'page_size': data.page_size || 'A4',
                    'page_count': data.page_count,
                    'paper_spacing': data.paper_spacing,
                    'page_col_count': data.page_col_count,
                    'orientation': data.orientation,
                    'legend': data.legend,
                    'legend_collapsed': data.legend_collapsed,
                    'page_color': data.page_color,
                };

            // For missing attributes, we fill in with defaults
            // so as to clear everything from previous figure.
            n = $.extend({}, self.defaults, n);

            self.set(n);

            _.each(data.panels, function(p){
                p.selected = false;
                self.panels.create(p);
            });

            // wait for undo/redo to handle above, then...
            setTimeout(function() {
                self.trigger("reset_undo_redo");
            }, 50);
        },

        // take Figure_JSON from a previous version,
        // and transform it to latest version
        version_transform: function(json) {
            var v = json.version || 0;
            var self = this;

            // In version 1, we have pixel_size_x and y.
            // Earlier versions only have pixel_size.
            if (v < 1) {
                _.each(json.panels, function(p){
                    var ps = p.pixel_size;
                    p.pixel_size_x = ps;
                    p.pixel_size_y = ps;
                    delete p.pixel_size;
                });
            }
            if (v < 2) {
                console.log("Transforming to VERSION 2");
                _.each(json.panels, function(p){
                    if (p.shapes) {
                        p.shapes = p.shapes.map(function(shape){
                            // Update to OMERO 5.3.0 model of Ellipse
                            if (shape.type === "Ellipse") {
                                shape.x = shape.cx;
                                shape.y = shape.cy;
                                shape.radiusX = shape.rx;
                                shape.radiusY = shape.ry;
                                delete shape.cx;
                                delete shape.cy;
                                delete shape.rx;
                                delete shape.ry;
                            }
                            return shape;
                        });
                    }
                });
            }
            if (v < 3) {
                console.log("Transforming to VERSION 3");
                _.each(json.panels, function(p){
                    if (p.export_dpi) {
                        // rename 'export_dpi' attr to 'min_export_dpi'
                        p.min_export_dpi = p.export_dpi;
                        delete p.export_dpi;
                    }
                    // update strokeWidth to page pixels/coords instead of
                    // image pixels. Scale according to size of panel and zoom
                    if (p.shapes && p.shapes.length > 0) {
                        var panel = new Panel(p);
                        var imagePixelsWidth = panel.getViewportAsRect().width;
                        var pageCoordsWidth = panel.get('width');
                        var strokeWidthScale = pageCoordsWidth/imagePixelsWidth;
                        p.shapes = p.shapes.map(function(shape){
                            var strokeWidth = shape.strokeWidth || 1;
                            strokeWidth = strokeWidth * strokeWidthScale;
                            // Set stroke-width to 0.25, 0.5, 0.75, 1 or greater
                            if (strokeWidth > 0.875) {
                                strokeWidth = parseInt(Math.round(strokeWidth));
                            } else if (strokeWidth > 0.625) {
                                strokeWidth = 0.75;
                            } else if (strokeWidth > 0.375) {
                                strokeWidth = 0.5;
                            } else {
                                strokeWidth = 0.25;
                            }
                            shape.strokeWidth = strokeWidth;
                            return shape;
                        });
                    }
                });
            }

            if (v < 4) {
                console.log("Transforming to VERSION 4");
                _.each(json.panels, function(p){
                    // rename lineWidth to strokeWidth
                    if (p.shapes && p.shapes.length > 0) {
                        p.shapes = p.shapes.map(function(shape){
                            shape.strokeWidth = shape.strokeWidth || shape.lineWidth || 1;
                            if (shape.lineWidth) {
                                delete shape.lineWidth;
                            }
                            return shape;
                        });
                    }
                });
            }

            if (v < 5) {
                console.log("Transforming to VERSION 5");
                // scalebar now has 'units' attribute.
                _.each(json.panels, function(p){
                    // rename lineWidth to strokeWidth
                    if (p.scalebar && !p.scalebar.units) {
                        var units = p.pixel_size_x_unit || "MICROMETER";
                        p.scalebar.units = units;
                    }
                });

                // Re-load timestamp info with no rounding (previous versions rounded to secs)
                // Find IDs of images with deltaT
                var iids = [];
                _.each(json.panels, function(p){
                    if (p.deltaT && iids.indexOf(p.imageId) == -1) {
                        iids.push(p.imageId)
                    }
                });
                console.log('Load timestamps for images', iids);
                if (iids.length > 0) {
                    var tsUrl = BASE_WEBFIGURE_URL + 'timestamps/';
                    tsUrl += '?image=' + iids.join('&image=');
                    $.getJSON(tsUrl, function(data){
                        // Update all panels
                        // NB: By the time that this callback runs, the panels will have been created
                        self.panels.forEach(function(p){
                            var iid = p.get('imageId');
                            if (data[iid] && data[iid].length > 0) {
                                p.set('deltaT', data[iid]);
                            }
                        });
                    });
                }
            }

            if (v < 6) {
                console.log("Transforming to VERSION 6");
                // Adding the Z scale to the model
                var iids = [];
                _.each(json.panels, function(p) {
                    if (iids.indexOf(p.imageId) == -1) {
                        iids.push(p.imageId)
                    }
                });
                if (iids.length > 0) {
                    let zUrl = BASE_WEBFIGURE_URL + 'z_scale/';
                    zUrl += '?image=' + iids.join('&image=');
                    $.getJSON(zUrl, function(data) {
                        // Update all panels
                        // NB: By the time that this callback runs, the panels will have been created
                        self.panels.forEach(function(p){
                            var iid = p.get('imageId');
                            if (data[iid]) {
                                p.set('pixel_size_z', data[iid].valueZ);
                                p.set('pixel_size_z_symbol', data[iid].symbolZ);
                                p.set('pixel_size_z_unit', data[iid].unitZ);
                            }
                        });
                    });
                }

                // Converting the time-labels to V6 syntax, all other special label were converted to text
                _.each(json.panels, function(p) {
                    for (var i=0; i<p["labels"].length; i++){
                        const label = p["labels"][i];
                        if (label["time"]) {
                            label["text"] = "[time."+label["time"]+"]";
                            delete label.time;
                        }
                    }
                });
            }

            if (v < 7) {
                console.log("Transforming to VERSION 7");
                // Adding the height parameter to the JSON
                _.each(json.panels, function(p){
                    // rename lineWidth to strokeWidth
                    if (p.scalebar && !p.scalebar.height) {
                        p.scalebar.height = 3;
                    }
                });
            }

            if (v < 8) {
                console.log("Transforming to VERSION 8");
                // need to load pixelsType.
                var iids = json.panels.map(p => p.imageId);
                console.log('Load pixelsType for images', iids);
                if (iids.length > 0) {
                    var ptUrl = BASE_WEBFIGURE_URL + 'pixels_type/';
                    ptUrl += '?image=' + iids.join('&image=');
                    getJson(ptUrl).then(data => {
                        // Update all panels
                        // NB: By the time that this callback runs, the panels will have been created
                        self.panels.forEach(function(p){
                            var iid = p.get('imageId');
                            if (data[iid]) {
                                p.set({
                                    'pixelsType': data[iid].pixelsType,
                                    'pixel_range': data[iid].pixel_range
                                });
                            }
                        });
                    });
                }
            }

            if (v < 9) {
                console.log("Transforming to VERSION 9");
                // Adding the margin parameter to the JSON
                _.each(json.panels, function(p){
                    if (p.scalebar && p.scalebar.margin == undefined) {
                        p.scalebar.margin = 10;
                    }
                });
            }

            return json;
        },

        figure_toJSON: function() {
            // Turn panels into json
            var p_json = [],
                self = this;
            this.panels.each(function(m) {
                p_json.push(m.toJSON());
            });

            var figureJSON = {
                version: VERSION,
                panels: p_json,
                paper_width: this.get('paper_width'),
                paper_height: this.get('paper_height'),
                page_size: this.get('page_size'),
                page_count: this.get('page_count'),
                paper_spacing: this.get('paper_spacing'),
                page_col_count: this.get('page_col_count'),
                height_mm: this.get('height_mm'),
                width_mm: this.get('width_mm'),
                orientation: this.get('orientation'),
                legend: this.get('legend'),
                legend_collapsed: this.get('legend_collapsed'),
                page_color: this.get('page_color'),
            };
            if (this.get('figureName')){
                figureJSON.figureName = this.get('figureName')
            }
            if (this.get('fileId')){
                figureJSON.fileId = this.get('fileId')
            }
            return figureJSON;
        },

        figure_fromJSON: function(data) {
            var parsed = JSON.parse(data);
            delete parsed.fileId;
            this.load_from_JSON(parsed);
            this.set('unsaved', true);
        },

        // handle /recover/ page
        recoverFromLocalStorage: function() {
            var figureObject = recoverFigureFromStorage();
            if (!figureObject) {
                var message = "No valid figure was found in local storage."
                figureConfirmDialog("No Figure found", message, ["OK"]);
            } else {
                this.figure_fromJSON(JSON.stringify(figureObject));
                clearFigureFromStorage();
                var html = `<p>This figure has been recovered from the browser's local storage and
                        the local storage cleared.</p>`;
                figureConfirmDialog(
                    "Figure recovered", html, ["OK"]);
            }
        },

        save_to_OMERO: function(options) {

            var self = this,
                figureJSON = this.figure_toJSON();

            var url = BASE_OMEROWEB_URL + "figure/save_web_figure/";
                // fileId = self.get('fileId'),
            var data = {};

            if (options.fileId) {
                data.fileId = options.fileId;
            }
            if (options.figureName) {
                // Include figure name in JSON saved to file
                figureJSON.figureName = options.figureName;
            }
            data.figureJSON = JSON.stringify(figureJSON);

            // Save
            $.post( url, data)
                .done(function( data ) {
                    var update = {
                        'fileId': +data,
                        'unsaved': false,
                    };
                    if (options.figureName) {
                        update.figureName = options.figureName;
                    }
                    self.set(update);

                    if (options.success) {
                        options.success(data);
                    }
                })
                .fail(function(rsp){
                    console.log('Save Error', rsp.responseText);

                    // Save to local storage to avoid data loss
                    saveFigureToStorage(figureJSON);

                    var errorTitle = `Save Error: ${rsp.status}`;
                    var message = `
                        <p>The current figure has failed to Save to OMERO.</p>
                        <p>A copy has been placed in your browser's local storage for this session
                        and can be recovered with File > Local Storage or by reloading the app.</p>
                        <p>Reloading will also check your connection to OMERO.</p>
                    `;
                    var buttons = ['Close', 'Reload in new Tab'];
                    var callback = function(btnText) {
                        if (btnText === "Reload in new Tab") {
                            var recoverUrl = BASE_WEBFIGURE_URL + 'recover/';
                            window.open(recoverUrl, '_blank')
                        }
                    }
                    figureConfirmDialog(errorTitle, message, buttons, callback);
                });
        },

        clearFigure: function() {
            var figureModel = this;
            figureModel.unset('fileId');
            figureModel.unset('groupId');
            figureModel.delete_panels();
            figureModel.unset("figureName");
            figureModel.set(figureModel.defaults);
            figureModel.trigger('reset_undo_redo');
        },

        checkSaveAndClear: function (callback, allowCancel) {
            var self = this;
            var doClear = function () {
                self.clearFigure();
                if (callback) {
                    callback();
                }
            };
            if (self.get("unsaved")) {
                var saveBtnTxt = "Save",
                    canEdit = self.get("canEdit");
                if (!canEdit) saveBtnTxt = "Save a Copy";
                // show the confirm dialog...
                let buttons = ["Don't Save", saveBtnTxt];
                if (allowCancel) {
                    buttons = ["Canel"].concat(buttons);
                }
                figureConfirmDialog(
                    "Save Changes to Figure?",
                    "Your changes will be lost if you don't save them",
                    buttons,
                    function (btnTxt) {
                        if (btnTxt === saveBtnTxt) {
                            var options = {};
                            // Save current figure or New figure...
                            var fileId = self.get("fileId");
                            if (fileId && canEdit) {
                            options.fileId = fileId;
                            } else {
                            var defaultName = self.getDefaultFigureName();
                            var figureName = prompt("Enter Figure Name", defaultName);
                            options.figureName = figureName || defaultName;
                            }
                            options.success = doClear;
                            self.save_to_OMERO(options);
                        } else if (btnTxt === "Don't Save") {
                            self.set("unsaved", false);
                            doClear();
                        }
                    }
                );
            } else {
                doClear();
            }
        },

        addImages: function(iIds) {
            this.clearSelected();

            // approx work out number of columns to layout new panels
            var paper_width = this.get('paper_width'),
                paper_height = this.get('paper_height'),
                colCount = Math.ceil(Math.sqrt(iIds.length)),
                rowCount = Math.ceil(iIds.length/colCount),
                centre = {x: paper_width/2, y: paper_height/2},
                px, py, spacer, scale,
                coords = {'px': px,
                          'py': py,
                          'c': centre,
                          'spacer': spacer,
                          'colCount': colCount,
                          'rowCount': rowCount,
                          'paper_width': paper_width};

            // This loop sets up a load of async imports.
            // The first one to return will set all the coords
            // and subsequent ones will update coords to position
            // new image panels appropriately in a grid.
            var invalidIds = [];
            for (var i=0; i<iIds.length; i++) {
                console.log("Adding image", iIds[i]);
                if (iIds[i].includes(".zarr")) {
                    this.importZarrImage(iIds[i], coords, i);
                    continue;
                }
                var imgId = iIds[i].replace("|", ""),
                    validId = parseInt(imgId, 10) + "",
                    imgDataUrl = BASE_WEBFIGURE_URL + 'imgData/' + validId + '/';
                if (validId == "NaN") {
                    invalidIds.push(imgId);
                } else {
                    this.importImage(imgDataUrl, coords, undefined, i);
                }
            }
            if (invalidIds.length > 0) {
                var plural = invalidIds.length > 1 ? "s" : "";
                alert("Could not add image with invalid ID" + plural + ": " + invalidIds.join(", "));
            }
        },

        updateCoordsAndPanelCoords(panel_json, coords, index) {
            console.log("importZarrImage coords.spacer coords:", coords.spacer, coords);
            // update panel_json and coords
            coords.spacer = coords.spacer || panel_json.orig_width/20;
            var full_width = (coords.colCount * (panel_json.orig_width + coords.spacer)) - coords.spacer,
                full_height = (coords.rowCount * (panel_json.orig_height + coords.spacer)) - coords.spacer;
            coords.scale = coords.paper_width / (full_width + (2 * coords.spacer));
            coords.scale = Math.min(coords.scale, 1);    // only scale down
            // For the FIRST IMAGE ONLY (coords.px etc undefined), we
            // need to work out where to start (px,py) now that we know size of panel
            // (assume all panels are same size)
            coords.px = coords.px || coords.c.x - (full_width * coords.scale)/2;
            coords.py = coords.py || coords.c.y - (full_height * coords.scale)/2;
            // calculate panel coordinates from index...
            var row = parseInt(index / coords.colCount, 10);
            var col = index % coords.colCount;
            var panelX = coords.px + ((panel_json.orig_width + coords.spacer) * coords.scale * col);
            var panelY = coords.py + ((panel_json.orig_height + coords.spacer) * coords.scale * row);
            
            // update panel_json
            panel_json.x = panelX;
            panel_json.y = panelY;
            panel_json.width = panel_json.orig_width * coords.scale;
            panel_json.height = panel_json.orig_height * coords.scale;
        },

        importZarrImage: async function(zarrUrl, coords, index) {
            this.set('loading_count', this.get('loading_count') + 1);

            let panel_json = await loadZarrForPanel(zarrUrl);

            // coords (px, py etc) are incremented for each panel added
            this.updateCoordsAndPanelCoords(panel_json, coords, index)

            this.set('loading_count', this.get('loading_count') - 1);
            // create Panel (and select it)
            // We do some additional processing in Panel.parse()
            this.panels.create(panel_json, {'parse': true}).set('selected', true);
            this.notifySelectionChange();
        },

        importImage: function(imgDataUrl, coords, baseUrl, index) {

            var self = this,
                callback,
                dataType = "json";

            if (baseUrl) {
                callback = "callback";
                dataType = "jsonp";
            }
            if (index == undefined) {
                index = 0;
            }

            this.set('loading_count', this.get('loading_count') + 1);

            // Get the json data for the image...
            let cors_headers = { mode: 'cors', credentials: 'include', headers: {"Content-Type": "application/json"
              }, };
            fetch(imgDataUrl, cors_headers)
                .then(rsp => rsp.json())
                .then(data => {
                    console.log("data", data);
                    self.set('loading_count', self.get('loading_count') - 1);

                    if (data.Exception || data.ConcurrencyException) {
                        // If something went wrong, show error and don't add to figure
                        message = data.Exception || "ConcurrencyException"
                        alert(`Image loading from ${imgDataUrl} included an Error: ${message}`);
                        return;
                    }

                    // coords.spacer = coords.spacer || data.size.width/20;
                    // var full_width = (coords.colCount * (data.size.width + coords.spacer)) - coords.spacer,
                    //     full_height = (coords.rowCount * (data.size.height + coords.spacer)) - coords.spacer;
                    // coords.scale = coords.paper_width / (full_width + (2 * coords.spacer));
                    // coords.scale = Math.min(coords.scale, 1);    // only scale down
                    // // For the FIRST IMAGE ONLY (coords.px etc undefined), we
                    // // need to work out where to start (px,py) now that we know size of panel
                    // // (assume all panels are same size)
                    // coords.px = coords.px || coords.c.x - (full_width * coords.scale)/2;
                    // coords.py = coords.py || coords.c.y - (full_height * coords.scale)/2;

                    // // calculate panel coordinates from index...
                    // var row = parseInt(index / coords.colCount, 10);
                    // var col = index % coords.colCount;
                    // var panelX = coords.px + ((data.size.width + coords.spacer) * coords.scale * col);
                    // var panelY = coords.py + ((data.size.height + coords.spacer) * coords.scale * row);

                    // ****** This is the Data Model ******
                    //-------------------------------------
                    // Any changes here will create a new version
                    // of the model and will also have to be applied
                    // to the 'version_transform()' function so that
                    // older files can be brought up to date.
                    // Also check 'previewSetId()' for changes.
                    var n = {
                        'imageId': data.id,
                        'name': data.meta.imageName,
                        'width': data.size.width * coords.scale,
                        'height': data.size.height * coords.scale,
                        'sizeZ': data.size.z,
                        'theZ': data.rdefs.defaultZ,
                        'sizeT': data.size.t,
                        'theT': data.rdefs.defaultT,
                        'rdefs': {'model': data.rdefs.model},
                        'channels': data.channels,
                        'orig_width': data.size.width,
                        'orig_height': data.size.height,
                        'x': 0,
                        'y': 0,
                        'datasetName': data.meta.datasetName,
                        'datasetId': data.meta.datasetId,
                        'pixel_size_x': data.pixel_size.valueX,
                        'pixel_size_y': data.pixel_size.valueY,
                        'pixel_size_z': data.pixel_size.valueZ,
                        'pixel_size_x_symbol': data.pixel_size.symbolX,
                        'pixel_size_z_symbol': data.pixel_size.symbolZ,
                        'pixel_size_x_unit': data.pixel_size.unitX,
                        'pixel_size_z_unit': data.pixel_size.unitZ,
                        'deltaT': data.deltaT,
                        'pixelsType': data.meta.pixelsType,
                        'pixel_range': data.pixel_range,
                    };
                    if (baseUrl) {
                        n.baseUrl = baseUrl;
                    }

                    // coords (px, py etc) are incremented for each panel added
                    self.updateCoordsAndPanelCoords(n, coords, index);

                    // create Panel (and select it)
                    // We do some additional processing in Panel.parse()
                    self.panels.create(n, {'parse': true}).set('selected', true);
                    self.notifySelectionChange();
                })
                .catch(err => {
                    alert("Image not found on the server, " +
                        "or you don't have permission to access it at " + imgDataUrl);
                });
        },

        // Used to position the #figure within canvas and also to coordinate svg layout.
        getFigureSize: function() {
            var pc = this.get('page_count'),
                cols = this.get('page_col_count'),
                gap = this.get('paper_spacing'),
                pw = this.get('paper_width'),
                ph = this.get('paper_height'),
                rows;
            rows = Math.ceil(pc / cols);
            var w = cols * pw + (cols - 1) * gap,
                h = rows * ph + (rows - 1) * gap;
            return {'w': w, 'h': h, 'cols': cols, 'rows': rows}
        },

        getPageOffset: function(coords) {
            var gap = this.get('paper_spacing'),
                pw = this.get('paper_width'),
                ph = this.get('paper_height');
            var xspacing = gap + pw;
            var yspacing = gap + ph;
            var offset = {};
            if (coords.x !== undefined){
                offset.x = coords.x % xspacing;
            }
            if (coords.y !== undefined){
                offset.y = coords.y % yspacing;
            }
            return offset;
        },

        getDefaultFigureName: function() {
            const padL = (nr) => `${nr}`.padStart(2, '0');
            var d = new Date(),
                dt = [d.getFullYear(),
                      padL(d.getMonth()+1),
                      padL(d.getDate())].join('-'),
                tm = [padL(d.getHours()),
                      padL(d.getMinutes()),
                      padL(d.getSeconds())].join('-');
            return "Figure_" + dt + "_" + tm;
        },

        nudge_right: function() {
            this.nudge('x', 10);
        },

        nudge_left: function() {
            this.nudge('x', -10);
        },

        nudge_down: function() {
            this.nudge('y', 10);
        },

        nudge_up: function() {
            this.nudge('y', -10);
        },

        nudge: function(axis, delta) {
            var selected = this.getSelected(),
                pos;

            selected.forEach(function(p){
                pos = p.get(axis);
                p.save(axis, pos + delta);
            });
        },

        align_left: function() {
            var selected = this.getSelected(),
                x_vals = [];
            selected.forEach(function(p){
                x_vals.push(p.get('x'));
            });
            var min_x = Math.min.apply(window, x_vals);

            selected.forEach(function(p){
                p.save('x', min_x);
            });
        },


        align_right: function() {
            var selected = this.getSelected(),
                x_vals = [];
            selected.forEach(function(p){
                x_vals.push(p.get('x') + p.get('width'));
            });
            var max_x = Math.max.apply(window, x_vals);

            selected.forEach(function(p){
                p.save('x', max_x - p.get('width'));
            });
        },

        align_top: function() {
            var selected = this.getSelected(),
                y_vals = [];
            selected.forEach(function(p){
                y_vals.push(p.get('y'));
            });
            var min_y = Math.min.apply(window, y_vals);

            selected.forEach(function(p){
                p.save('y', min_y);
            });
        },

        align_bottom: function() {
            var selected = this.getSelected(),
                y_vals = [];
            selected.forEach(function(p){
                y_vals.push(p.get('y') + p.get('height'));
            });
            var max_y = Math.max.apply(window, y_vals);

            selected.forEach(function(p){
                p.save('y', max_y - p.get('height'));
            });
        },

         align_grid: function(gridGap) {
            var sel = this.getSelected(),
                top = this.get_top_panel(sel),
                left = this.get_left_panel(sel),
                right = this.get_right_panel(sel),
                bottom = this.get_bottom_panel(sel),
                left_x = left.get('x'),
                right_x = right.get('x') + right.get('width'), 
                top_y = top.get('y'),
                bottom_y = bottom.get('y') + bottom.get('height'),
                grid = [],
                row = [],
                next_panel,
                checkedPanels = [],
                c = {'x': left_x + left.get('width')/2, 'y': top_y + top.get('height')/2};

            // loop over the rows, starting by the top panel row
            while(c.y < bottom_y){
                row = []
                // loop over the columns, starting by the left panel column
                while(c.x < right_x){
                    next_panel = this.get_panel_at(c.x , c.y, sel);
                    if(checkedPanels.includes(next_panel)){
                        next_panel = undefined
                    }

                    // if a panel doesn't exist at the current position c
                    // just go to the next position until it reaches the selection boundaries
                    if (next_panel) {
                        row.push(next_panel);
                        checkedPanels.push(next_panel)
                        c = next_panel.get_centre();
                    }else{
                        next_panel = next_panel == undefined ? left : next_panel
                    }
                    c = {'x': c.x + next_panel.get('width'), 'y': c.y}
                }

                // check that there is effecitvely a panel in the current row
                if(row.length == 0){
                    c = {'x': left_x + left.get('width')/2, 'y': c.y + left.get('height')}
                }else{
                    c = {'x': left_x + left.get('width')/2, 'y': c.y + row[0].get('height')}
                    grid.push(row);
                }               
            }

            // get the row id of the most left panel
            var left_panel_row = 0;
            grid.forEach((row, i) => {
                if (row.some(panel => panel.cid === left.cid)) {
                    left_panel_row = i;
                }
            });
            
            // define the spacer between images
            var spacer = left.get('width')/20;
            if (!isNaN(parseFloat(gridGap))) {
                spacer = parseFloat(gridGap);
            }

            var new_x = left_x,
                new_y = left.get('y'),
                max_h = 0,
                ref_row = grid[left_panel_row],
                last_panel_width = 0,
                reference_grid = {};

            // start aligning the row with the most left panel
            // This row is considered as a reference to align
            // the rest of the panels
            var global_index = 0
            for (var c = 0; c < ref_row.length; c++) {
                let panel = ref_row[c];
                var current_x = panel.get('x')
                var gap = Math.floor(Math.abs(current_x - new_x) / last_panel_width);
                // first loop, when last_panel_width is 0, gap will be NaN or Infinity - skip
                if (c > 0) {
                    for(var i = 0; i < gap; i++){
                        reference_grid[global_index] = new_x
                        new_x = new_x + spacer + last_panel_width;
                        global_index++
                    }
                }
                // in case we got invalid x or y, don't save
                if (!isNaN(new_x) && !isNaN(new_y)) {
                    panel.save({'x':new_x, 'y':new_y});
                }
                reference_grid[global_index] = new_x
                max_h = Math.max(max_h, panel.get('height'));
                new_x = new_x + spacer + panel.get('width');
                last_panel_width = panel.get('width')
                global_index++
            }

            // set the row position (i.e. y coordinate) of each row
            var ref_y_offset = max_h    
            var rows_position = {}
            max_h = 0
            // for rows above the reference row
            for (var r = left_panel_row - 1; r >= 0; r--) {
                var row = grid[r];
                for (var c = 0; c < row.length; c++) {
                    max_h = Math.max(max_h,  row[c].get('height'));
                }
                new_y = new_y - spacer - max_h;
                rows_position[r] = new_y
            }
            max_h = ref_y_offset
            new_y = left.get('y')
            // for rows below the reference row
            for (var r = left_panel_row + 1; r < grid.length; r++) {
                var row = grid[r];
                new_y = new_y + spacer + max_h;
                rows_position[r] = new_y
                for (var c = 0; c < row.length; c++) {
                    max_h = Math.max(max_h,  row[c].get('height'));
                }
            }
            
            // update position of panels 
            for (var [r, y] of Object.entries(rows_position)){
                var row = grid[r];
                var last_column_id = -1
                for (var c=0; c<row.length; c++) {
                    let panel = row[c];
                    var closest_column = this.get_closest_column(panel, reference_grid, last_panel_width)
										
                    if(closest_column >= 0){
                        // update closest_column id to take into account spare panel positions
						if(last_column_id == closest_column){
							closest_column = last_column_id + 1
							if(closest_column == reference_grid.length){
								new_x = reference_grid[closest_column-1] + last_panel_width + spacer
							}else{
								new_x = reference_grid[closest_column]
							}
						}else{
							new_x = reference_grid[closest_column]
						}
                    }else{
                        // update closest_column id to take into account spare panel positions
						if(last_column_id == reference_grid.length - 1 - closest_column){
							closest_column--
						}
                        var lastRefColumn = Object.keys(reference_grid).length - 1
                        new_x = reference_grid[lastRefColumn] -closest_column*(last_panel_width + spacer)
                    }
					last_column_id++
                    if (!isNaN(new_x) && !isNaN(y)) {
                        panel.save({'x':new_x, 'y':y});
                    }
                    new_x = new_x + spacer + panel.get('width');
                }
            }
        },

        get_closest_column: function(panel, reference_row, last_ref_panel_width){
            // look at the reference row (i.e. the one with the most left panel)
            // and find the closest column to the current panel
            var closest_col = 0;
            var min_x_distance = Number.MAX_VALUE
            for (var [col_id, col_x] of Object.entries(reference_row)){
                var current_distance = Math.abs(col_x - panel.get('x'))
                if(current_distance < min_x_distance){
                    closest_col = col_id
                    min_x_distance = current_distance
                } 
            }

            // if the panel is located far away from the last reference column,
            // return the number of extra columns where to put the panel as a negative number
            if(closest_col == Object.keys(reference_row).length - 1 && min_x_distance > last_ref_panel_width){
                closest_col = - Math.floor(min_x_distance/last_ref_panel_width)
            }
            return closest_col
        },

        get_panel_at: function(x, y, panels) {
            return panels.find(function(p) {
                return ((p.get('x') < x && (p.get('x')+p.get('width')) > x) &&
                        (p.get('y') < y && (p.get('y')+p.get('height')) > y));
            });
        },

        get_top_left_panel: function(panels) {
            // top-left panel is one where x + y is least
            return panels.reduce(function(top_left, p){
                if ((p.get('x') + p.get('y')) < (top_left.get('x') + top_left.get('y'))) {
                    return p;
                } else {
                    return top_left;
                }                
            });
        },

        get_top_panel: function(panels) {
            // top panel is one where y is least
            return panels.reduce(function(top, p){
                if (p.get('y') < top.get('y')) {
                    return p;
                } else {
                    return top;
                }
            });
        },

        get_bottom_panel: function(panels) {
            // bottom panel is one where y is greater
            return panels.reduce(function(bottom, p){
                if (p.get('y') > bottom.get('y')) {
                    return p;
                } else {
                    return bottom;
                }
            });
        },

        get_left_panel: function(panels) {
            // left panel is one where x is least
            return panels.reduce(function(left, p){
                if (p.get('x') < left.get('x')) {
                    return p;
                } else {
                    return left;
                }
            });
        },

        get_right_panel: function(panels) {
            // right panel is one where x is greater
            return panels.reduce(function(right, p){
                if (p.get('x') > right.get('x')) {
                    return p;
                } else {
                    return right;
                }
            });
        },

        align_size: function(width, height) {
            var sel = this.getSelected(),
                ref = this.get_top_left_panel(sel),
                ref_width = width ? ref.get('width') : false,
                ref_height = height ? ref.get('height') : false,
                new_w, new_h,
                p;

            sel.forEach(function(p){
                if (ref_width && ref_height) {
                    new_w = ref_width;
                    new_h = ref_height;
                } else if (ref_width) {
                    new_w = ref_width;
                    new_h = (ref_width/p.get('width')) * p.get('height');
                } else if (ref_height) {
                    new_h = ref_height;
                    new_w = (ref_height/p.get('height')) * p.get('width');
                }
                p.set({'width':new_w, 'height':new_h});
            });
        },

        // Resize panels so they all show same magnification
        align_magnification: function() {
            var sel = this.getSelected(),
                ref = this.get_top_left_panel(sel),
                ref_pixSize = ref.get('pixel_size_x'),
                targetMag;
            if (!ref_pixSize) {
                alert('Top-left panel has no pixel size set');
                return;
            }

            // This could return an AJAX call if we need to convert units.
            // Whenever we use this below, wrap it with $.when().then()
            var getPixSizeInMicrons = function(m) {
                var unit = m.get("pixel_size_x_unit"),
                    size = m.get("pixel_size_x");
                if (unit === "MICROMETER") {
                    return {'value':size};
                }
                if (!size) {
                    return {'value': size}
                }
                // convert to MICROMETER
                var url = BASE_WEBFIGURE_URL + "unit_conversion/" + size + "/" + unit + "/MICROMETER/";
                return $.getJSON(url);
            }

            // First, get reference pixel size...
            $.when( getPixSizeInMicrons(ref) ).then(function(data){
                ref_pixSize = data.value;
                // E.g. 10 microns / inch
                targetMag = ref_pixSize * ref.getPanelDpi();

                // Loop through all selected, updating size of each...
                sel.forEach(function(p){

                    // ignore the ref panel
                    if (p.cid === ref.cid) return;

                    $.when( getPixSizeInMicrons(p) ).then(function(data){

                        var dpi = p.getPanelDpi(),
                            pixSize = data.value;
                        if (!pixSize) {
                            return;
                        }
                        var panelMag = dpi * pixSize,
                            scale = panelMag / targetMag,
                            new_w = p.get('width') * scale,
                            new_h = p.get('height') * scale;
                        p.set({'width':new_w, 'height':new_h});
                    });
                });
            });
        },

        // This can come from multi-select Rect OR any selected Panel
        // Need to notify ALL panels and Multi-select Rect.
        drag_xy: function(dx, dy, save) {
            if (dx === 0 && dy === 0) return;

            var minX = 10000,
                minY = 10000,
                xy;
            // First we notidy all Panels
            var selected = this.getSelected();
            selected.forEach(function(m){
                xy = m.drag_xy(dx, dy, save);
                minX = Math.min(minX, xy.x);
                minY = Math.min(minY, xy.y);
            });
            // Notify the Multi-select Rect of it's new X and Y
            this.trigger('drag_xy', [minX, minY, save]);
        },


        // This comes from the Multi-Select Rect.
        // Simply delegate to all the Panels
        multiselectdrag: function(x1, y1, w1, h1, x2, y2, w2, h2, save) {
            var selected = this.getSelected();
            selected.forEach(function(m){
                m.multiselectdrag(x1, y1, w1, h1, x2, y2, w2, h2, save);
            });
        },

        // If already selected, do nothing (unless clearOthers is true)
        setSelected: function(item, clearOthers) {
            if ((!item.get('selected')) || clearOthers) {
                this.clearSelected(false);
                item.set('selected', true);
                this.notifySelectionChange();
            }
        },

        select_all:function() {
            this.panels.each(function(p){
                p.set('selected', true);
            });
            this.notifySelectionChange();
        },

        addSelected: function(item) {
            item.set('selected', true);
            this.notifySelectionChange();
        },

        clearSelected: function(trigger) {
            this.panels.each(function(p){
                p.set('selected', false);
            });
            if (trigger !== false) {
                this.notifySelectionChange();
            }
        },

        selectByRegion: function(coords) {
            this.panels.each(function(p){
                if (p.regionOverlaps(coords)) {
                    p.set('selected', true);
                }
            });
            this.notifySelectionChange();
        },

        getSelected: function() {
            return this.panels.getSelected();
        },

        // Go through all selected and destroy them - trigger selection change
        deleteSelected: function() {
            var selected = this.getSelected();
            var model;
            while (model = selected.first()) {
                model.destroy();
            }
            this.notifySelectionChange();
        },

        delete_panels: function() {
            // make list that won't change as we destroy
            var ps = [];
            this.panels.each(function(p){
                ps.push(p);
            });
            for (var i=ps.length-1; i>=0; i--) {
                ps[i].destroy();
            }
            this.notifySelectionChange();
        },

        getCropCoordinates: function() {
            // Get paper size and panel offsets (move to top-left) for cropping
            // returns {'paper_width', 'paper_height', 'dx', 'dy'}
            var margin = 10;

            // get range of all panel coordinates
            var top = Math.min.apply(window, this.panels.map(
                function(p){return p.getBoundingBoxTop();}));
            var left = Math.min.apply(window, this.panels.map(
                function(p){return p.getBoundingBoxLeft();}));
            var right = Math.max.apply(window, this.panels.map(
                function(p){return p.getBoundingBoxRight()}));
            var bottom = Math.max.apply(window, this.panels.map(
                function(p){return p.getBoundingBoxBottom()}));

            // Shift panels to top-left corner
            var dx = margin - left;
            var dy = margin - top;

            return {
                    'paper_width': right - left + (2 * margin),
                    'paper_height': bottom - top + (2 * margin),
                    'dx': dx,
                    'dy': dy
                   };
        },

        notifySelectionChange: function() {
            this.trigger('change:selection');
        }

    });


export default FigureModel
