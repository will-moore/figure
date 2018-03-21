    
    // Version of the json file we're saving.
    // This only needs to increment when we make breaking changes (not linked to release versions.)
    var VERSION = 3;


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
        },

        initialize: function() {
            this.panels = new PanelList();      //this.get("shapes"));

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


            $.getJSON(load_url, function(data){
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
                    'canEdit': data.canEdit,
                    'paper_width': data.paper_width,
                    'paper_height': data.paper_height,
                    'width_mm': data.width_mm,
                    'height_mm': data.height_mm,
                    'page_size': data.page_size || 'letter',
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

        save_to_OMERO: function(options) {

            var self = this,
                figureJSON = this.figure_toJSON();

            var url = window.SAVE_WEBFIGURE_URL,
                // fileId = self.get('fileId'),
                data = {};

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
                });
        },

        clearFigure: function() {
            var figureModel = this;
            figureModel.unset('fileId');
            figureModel.delete_panels();
            figureModel.unset("figureName");
            figureModel.set(figureModel.defaults);
            figureModel.trigger('reset_undo_redo');
        },

        addImages: function(iIds) {
            this.clearSelected();

            // approx work out number of columns to layout new panels
            var paper_width = this.get('paper_width'),
                paper_height = this.get('paper_height'),
                colCount = Math.ceil(Math.sqrt(iIds.length)),
                rowCount = Math.ceil(iIds.length/colCount),
                centre = {x: paper_width/2, y: paper_height/2},
                col = 0,
                row = 0,
                px, py, spacer, scale,
                coords = {'px': px,
                          'py': py,
                          'c': centre,
                          'spacer': spacer,
                          'colCount': colCount,
                          'rowCount': rowCount,
                          'col': col,
                          'row': row,
                          'paper_width': paper_width};

            // This loop sets up a load of async imports.
            // The first one to return will set all the coords
            // and subsequent ones will update coords to position
            // new image panels appropriately in a grid.
            var invalidIds = [];
            for (var i=0; i<iIds.length; i++) {
                var imgId = iIds[i].replace("|", ""),
                    validId = parseInt(imgId, 10) + "",
                    imgDataUrl = BASE_WEBFIGURE_URL + 'imgData/' + validId + '/';
                if (validId == "NaN") {
                    invalidIds.push(imgId);
                } else {
                    this.importImage(imgDataUrl, coords);
                }
            }
            if (invalidIds.length > 0) {
                var plural = invalidIds.length > 1 ? "s" : "";
                alert("Could not add image with invalid ID" + plural + ": " + invalidIds.join(", "));
            }
        },

        importImage: function(imgDataUrl, coords, baseUrl) {

            var self = this,
                callback,
                dataType = "json";

            if (baseUrl) {
                callback = "callback";
                dataType = "jsonp";
            }

            // Get the json data for the image...
            $.ajax({
                url: imgDataUrl,
                jsonp: callback, // 'callback'
                dataType: dataType,
                // work with the response
                success: function( data ) {

                    coords.spacer = coords.spacer || data.size.width/20;
                    var full_width = (coords.colCount * (data.size.width + coords.spacer)) - coords.spacer,
                        full_height = (coords.rowCount * (data.size.height + coords.spacer)) - coords.spacer;
                    coords.scale = coords.paper_width / (full_width + (2 * coords.spacer));
                    coords.scale = Math.min(coords.scale, 1);    // only scale down
                    // For the FIRST IMAGE ONLY (coords.px etc undefined), we
                    // need to work out where to start (px,py) now that we know size of panel
                    // (assume all panels are same size)
                    coords.px = coords.px || coords.c.x - (full_width * coords.scale)/2;
                    coords.py = coords.py || coords.c.y - (full_height * coords.scale)/2;

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
                        'x': coords.px,
                        'y': coords.py,
                        'datasetName': data.meta.datasetName,
                        'datasetId': data.meta.datasetId,
                        'pixel_size_x': data.pixel_size.valueX,
                        'pixel_size_y': data.pixel_size.valueY,
                        'pixel_size_x_symbol': data.pixel_size.symbolX,
                        'pixel_size_x_unit': data.pixel_size.unitX,
                        'deltaT': data.deltaT,
                    };
                    if (baseUrl) {
                        n.baseUrl = baseUrl;
                    }
                    // create Panel (and select it)
                    // We do some additional processing in Panel.parse()
                    self.panels.create(n, {'parse': true}).set('selected', true);
                    self.notifySelectionChange();

                    // update px, py for next panel
                    coords.col += 1;
                    coords.px += (data.size.width + coords.spacer) * coords.scale;
                    if (coords.col == coords.colCount) {
                        coords.row += 1;
                        coords.col = 0;
                        coords.py += (data.size.height + coords.spacer) * coords.scale;
                        coords.px = undefined; // recalculate next time
                    }
                },

                error: function(event) {
                    alert("Image not found on the server, " +
                        "or you don't have permission to access it at " + imgDataUrl);
                },
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
            var d = new Date(),
                dt = d.getFullYear() + "-" + (d.getMonth()+1) + "-" +d.getDate(),
                tm = d.getHours() + ":" + d.getMinutes() + ":" + d.getSeconds();
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
                p.set(axis, pos + delta);
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
                p.set('x', min_x);
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
                p.set('y', min_y);
            });
        },

        align_grid: function() {
            var sel = this.getSelected(),
                top_left = this.get_top_left_panel(sel),
                top_x = top_left.get('x'),
                top_y = top_left.get('y'),
                grid = [],
                row = [top_left],
                next_panel = top_left;

            // populate the grid, getting neighbouring panel each time
            while (next_panel) {
                c = next_panel.get_centre();
                next_panel = this.get_panel_at(c.x + next_panel.get('width'), c.y, sel);

                // if next_panel is not found, reached end of row. Try start new row...
                if (typeof next_panel == 'undefined') {
                    grid.push(row);
                    // next_panel is below the first of the current row
                    c = row[0].get_centre();
                    next_panel = this.get_panel_at(c.x, c.y + row[0].get('height'), sel);
                    row = [];
                }
                if (next_panel) {
                    row.push(next_panel);
                }
            }

            var spacer = top_left.get('width')/20,
                new_x = top_x,
                new_y = top_y,
                max_h = 0;
            for (var r=0; r<grid.length; r++) {
                row = grid[r];
                for (var c=0; c<row.length; c++) {
                    panel = row[c];
                    panel.save({'x':new_x, 'y':new_y});
                    max_h = Math.max(max_h, panel.get('height'));
                    new_x = new_x + spacer + panel.get('width');
                }
                new_y = new_y + spacer + max_h;
                new_x = top_x;
            }
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

