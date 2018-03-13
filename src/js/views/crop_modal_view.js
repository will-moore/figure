

var CropModalView = Backbone.View.extend({

        el: $("#cropModal"),

        roiTemplate: JST["src/templates/modal_dialogs/crop_modal_roi.html"],

        model:FigureModel,

        initialize: function() {

            var self = this;

            // Here we handle init of the dialog when it's shown...
            $("#cropModal").bind("show.bs.modal", function(){
                // Clone the 'first' selected panel as our reference for everything
                self.m = self.model.getSelected().head().clone();
                self.listenTo(self.m, 'change:theZ change:theT', self.render);

                self.cropModel.set({'selected': false, 'width': 0, 'height': 0});

                // get selected area...
                var roi = self.m.getViewportAsRect();

                // Show as ROI *if* it isn't the whole image
                if (roi.x !== 0 || roi.y !== 0
                        || roi.width !== self.m.get('orig_width')
                        || roi.height !== self.m.get('orig_height')) {
                    self.currentROI = roi;
                    self.cropModel.set({
                        'selected': true
                    });
                }

                // ...now zoom out and centre to render whole image
                self.m.set({'zoom': 100, 'dx': 0, 'dy': 0});

                self.zoomToFit();   // includes render()
                // disable submit until user chooses a region/ROI
                self.enableSubmit(false);

                // Load ROIs from OMERO...
                self.loadRois();
                // ...along with ROIs from clipboard or on this image in the figure
                self.showClipboardFigureRois();
            });

            // keep track of currently selected ROI
            this.currentROI = {'x':0, 'y': 0, 'width': 0, 'height': 0}

            // used by model underlying Rect.
            // NB: values in cropModel are scaled by zoom percent
            this.cropModel = new Backbone.Model({
                'x':0, 'y': 0, 'width': 0, 'height': 0,
                'selected': false});
            // since resizes & drags don't actually update cropModel automatically, we do it...
            this.cropModel.bind('drag_resize_stop', function(args) {
                this.set({'x': args[0], 'y': args[1], 'width': args[2], 'height': args[3]});
            });
            this.cropModel.bind('drag_xy_stop', function(args) {
                this.set({'x': args[0] + this.get('x'), 'y': args[1] + this.get('y')});
            });

            // we also need to update the scaled ROI coords...
            this.listenTo(this.cropModel, 'change:x change:y change:width change:height', function(m){
                var scale = self.zoom / 100;
                self.currentROI = {
                    'x': m.get('x') / scale,
                    'y': m.get('y') / scale,
                    'width': m.get('width') / scale,
                    'height': m.get('height') / scale
                }
                // No-longer correspond to saved ROI coords
                self.currentRoiId = undefined;
                // Allow submit of dialog if valid ROI
                if (self.regionValid(self.currentROI)) {
                    self.enableSubmit(true);
                } else {
                    self.enableSubmit(false);
                }
            });

            // Now set up Raphael paper...
            this.paper = Raphael("crop_paper", 500, 500);
            this.rect = new RectView({'model':this.cropModel, 'paper': this.paper});
            this.$cropImg = $('.crop_image', this.$el);
        },

        events: {
            "click .roiPickMe": "roiPicked",
            "mousedown svg": "mousedown",
            "mousemove svg": "mousemove",
            "mouseup svg": "mouseup",
            "submit .cropModalForm": "handleRoiForm"
        },

        // we disable Submit when dialog is shown, enable when region/ROI chosen
        enableSubmit: function(enabled) {
            var $okBtn = $('button[type="submit"]', this.$el);
            if (enabled) {
                $okBtn.prop('disabled', false);
                $okBtn.prop('title', 'Crop selected images to chosen region');
            } else {
                $okBtn.prop('disabled', 'disabled');
                $okBtn.prop('title', 'No valid region selected');
            }
        },

        // Region is only valid if it has width & height > 1 and
        // is at least partially overlapping with the image
        regionValid: function(roi) {

            if (roi.width < 2 || roi.height < 2) return false;
            if (roi.x > this.m.get('orig_width')) return false;
            if (roi.y > this.m.get('orig_height')) return false;
            if (roi.x + roi.width < 0) return false;
            if (roi.y + roi.height < 0) return false;
            return true;
        },

        roiPicked: function(event) {

            var $target = $(event.target),
                $tr = $target.parent();
            // $tr might be first <td> if img clicked or <tr> if td clicked
            // but in either case it will contain the img we need.
            var $roi = $tr.find('img.roi_content'),
                x = parseInt($roi.attr('data-x'), 10),
                y = parseInt($roi.attr('data-y'), 10),
                width = parseInt($roi.attr('data-width'), 10),
                height = parseInt($roi.attr('data-height'), 10),
                theT = parseInt($roi.attr('data-theT'), 10),
                theZ = parseInt($roi.attr('data-theZ'), 10);

            this.m.set({'theT': theT, 'theZ': theZ});

            this.currentROI = {
                'x':x, 'y':y, 'width':width, 'height':height
            }

            this.render();

            this.cropModel.set({
                'selected': true
            });

            // Save ROI ID
            this.currentRoiId = $roi.attr('data-roiId');
        },

        handleRoiForm: function(event) {
            event.preventDefault();
            // var json = this.processForm();
            var self = this,
                r = this.currentROI,
                theZ = this.m.get('theZ'),
                theT = this.m.get('theT'),
                sel = this.model.getSelected(),
                sameT = sel.allEqual('theT');
                // sameZT = sel.allEqual('theT') && sel.allEqual('theT');

            var getShape = function getShape(z, t) {

                // If all on one T-index, update to the current
                // T-index that we're looking at.
                if (sameT) {
                    t = self.m.get('theT');
                }
                var rv = {'x': r.x,
                        'y': r.y,
                        'width': r.width,
                        'height': r.height,
                        'theZ': self.m.get('theZ'),
                        'theT': t,
                    }
                return rv;
            }

            // IF we have an ROI selected (instead of hand-drawn shape)
            // then try to use appropriate shape for that plane.
            if (this.currentRoiId) {

                getShape = function getShape(currZ, currT) {

                    var tzShapeMap = self.cachedRois[self.currentRoiId],
                        tkeys = _.keys(tzShapeMap).sort(),
                        zkeys, z, t, s;

                    if (tzShapeMap[currT]) {
                        t = currT;
                    } else {
                        t = tkeys[parseInt(tkeys.length/2 ,10)]
                    }
                    zkeys = _.keys(tzShapeMap[t]).sort();
                    if (tzShapeMap[t][currZ]) {
                        z = currZ;
                    } else {
                        z = zkeys[parseInt(zkeys.length/2, 10)]
                    }
                    s = tzShapeMap[t][z]

                    // if we have a range of T values, don't change T!
                    if (!sameT) {
                        t = currT;
                    }

                    return {'x': s.x,
                            'y': s.y,
                            'width': s.width,
                            'height': s.height,
                            'theZ': z,
                            'theT': t,
                        }
                };
            }

            $("#cropModal").modal('hide');

            // prepare callback for below
            function cropAndClose(deleteROIs) {
                // Don't set Z/T if we already have different Z/T indecies.
                sel.each(function(m){
                    var sh = getShape(m.get('theZ'), m.get('theT')),
                        newZ = Math.min(parseInt(sh.theZ, 10), m.get('sizeZ') - 1),
                        newT = Math.min(parseInt(sh.theT, 10), m.get('sizeT') - 1);

                    m.cropToRoi({'x': sh.x, 'y': sh.y, 'width': sh.width, 'height': sh.height});
                    if (deleteROIs) {
                        m.unset('shapes');
                    }
                    // 'save' to trigger 'unsaved': true
                    m.save({'theZ': newZ, 'theT': newT});
                });
            }

            // If we have ROIs on the image, ask if we want to delete them
            var haveROIs = false,
                plural = sel.length > 0 ? "s" : "";
            sel.each(function(p){
                if (p.get('shapes')) haveROIs = true;
            });
            if (haveROIs) {
                figureConfirmDialog("Delete ROIs?",
                                    "Delete ROIs on the image" + plural + " you are cropping?",
                                    ["Yes", "No", "Cancel"],
                                    function(btnText){
                                        if (btnText == "Cancel") return;
                                        if (btnText == "Yes") {
                                            cropAndClose(true);
                                        } else {
                                            cropAndClose();
                                        }
                                    }
                );
            } else {
                cropAndClose();
            }
        },

        mousedown: function(event) {
            this.dragging = true;
            var os = $(event.target).offset();
            this.clientX_start = event.clientX;
            this.clientY_start = event.clientY;
            this.imageX_start = this.clientX_start - os.left;
            this.imageY_start = this.clientY_start - os.top;
            this.cropModel.set({'x': this.imageX_start, 'y': this.imageY_start, 'width': 0, 'height': 0, 'selected': true})
            return false;
        },

        mouseup: function(event) {
            if (this.dragging) {
                this.dragging = false;
                return false;
            }
        },

        mousemove: function(event) {
            if (this.dragging) {
                var dx = event.clientX - this.clientX_start,
                    dy = event.clientY - this.clientY_start;
                if (event.shiftKey) {
                    // make region square!
                    if (Math.abs(dx) > Math.abs(dy)) {
                        if (dy > 0) dy = Math.abs(dx);
                        else dy = -1 * Math.abs(dx);
                    } else {
                        if (dx > 0) dx = Math.abs(dy);
                        else dx = -1 * Math.abs(dy);
                    }
                }
                var negX = Math.min(0, dx),
                    negY = Math.min(0, dy);
                this.cropModel.set({'x': this.imageX_start + negX,
                    'y': this.imageY_start + negY,
                    'width': Math.abs(dx), 'height': Math.abs(dy)});
                return false;
            }
        },

        showClipboardFigureRois: function() {
            // Show Rectangles from clipboard
            var imageRects = [],
                clipboardRects = [],
                clipboard = this.model.get('clipboard');
            if (clipboard && clipboard.CROP) {
                roi = clipboard.CROP;
                clipboardRects.push({
                    x: roi.x, y: roi.y, width: roi.width, height: roi.height
                });
            } else if (clipboard && clipboard.SHAPES) {
                clipboard.SHAPES.forEach(function(roi){
                    if (roi.type === "Rectangle") {
                        clipboardRects.push({
                            x: roi.x, y: roi.y, width: roi.width, height: roi.height
                        });
                    }
                });
            }
            var msg = "[No Regions copied to clipboard]";
            this.renderRois(clipboardRects, ".roisFromClipboard", msg);

            // Show Rectangles from panels in figure
            var figureRois = [];
            var sel = this.model.getSelected();
            sel.forEach(function(panel) {
                var panelRois = panel.get('shapes');
                if (panelRois) {
                    panelRois.forEach(function(roi){
                        if (roi.type === "Rectangle") {
                            figureRois.push({
                                x: roi.x, y: roi.y, width: roi.width, height: roi.height
                            });
                        }
                    });
                }
            });
            msg = "[No Rectangular ROIs on selected panel in figure]";
            this.renderRois(figureRois, ".roisFromFigure", msg);
        },

        // Load Rectangles from OMERO and render them
        loadRois: function() {
            var self = this,
                iid = self.m.get('imageId');
            $.getJSON(ROIS_JSON_URL + iid + "/", function(data){

                // get a representative Rect from each ROI.
                // Include a z and t index, trying to pick current z/t if ROI includes a shape there
                var currT = self.m.get('theT'),
                    currZ = self.m.get('theZ');
                var rects = [],
                    cachedRois = {},    // roiId: shapes (z/t dict)
                    roi, shape, theT, theZ, z, t, rect, tkeys, zkeys,
                    minT, maxT,
                    shapes; // dict of all shapes by z & t index

                for (var r=0; r<data.length; r++) {
                    roi = data[r];
                    shapes = {};
                    minT = undefined;
                    maxT = 0;
                    for (var s=0; s<roi.shapes.length; s++) {
                        shape = roi.shapes[s];
                        if (shape.type !== "Rectangle") continue;
                        // Handle null Z/T
                        if (shape.theZ === undefined) {
                            shape.theZ = currZ;
                        }
                        theZ = shape.theZ;
                        if (shape.theT === undefined) {
                            shape.theT = currT;
                        }
                        theT = shape.theT;
                        // Keep track of min/max T for display
                        if (minT === undefined) {minT = theT}
                        else {minT = Math.min(minT, theT)}
                        maxT = Math.max(maxT, theT);

                        // Build our map of shapes[t][z]
                        if (shapes[theT] === undefined) {
                            shapes[theT] = {};
                        }
                        shapes[theT][theZ] = shape;
                    }
                    cachedRois[roi.id] = shapes;
                    // get display shape for picking ROI
                    // on current plane or pick median T/Z...
                    tkeys = _.keys(shapes)
                            .map(function(x){return parseInt(x, 10)})
                            .sort(function(a, b){return a - b});    // sort numerically
                    if (tkeys.length === 0) continue;   // no Rectangles
                    if (shapes[currT]) {
                        t = currT;
                    } else {
                        t = tkeys[(tkeys.length/2)>>0]
                    }
                    zkeys = _.keys(shapes[t])
                            .map(function(x){return parseInt(x, 10)})
                            .sort(function(a, b){return a - b});    // sort numerically
                    if (shapes[t][currZ]) {
                        z = currZ;
                    } else {
                        z = zkeys[(zkeys.length/2)>>0]
                    }
                    shape = shapes[t][z]
                    rects.push({'theZ': shape.theZ,
                                'theT': shape.theT,
                                'x': shape.x,
                                'y': shape.y,
                                'width': shape.width,
                                'height': shape.height,
                                'roiId': roi.id,
                                'tStart': minT,
                                'tEnd': maxT,
                                'zStart': zkeys[0],
                                'zEnd': zkeys[zkeys.length-1]});
                }
                // Show ROIS from OMERO...
                var msg = "[No rectangular ROIs found on this image in OMERO]";
                self.renderRois(rects, ".roisFromOMERO", msg);

                self.cachedRois = cachedRois;
            }).error(function(){
                var msg = "[No rectangular ROIs found on this image in OMERO]";
                self.renderRois([], ".roisFromOMERO", msg);
            });
        },

        renderRois: function(rects, target, msg) {

            var orig_width = this.m.get('orig_width'),
                orig_height = this.m.get('orig_height'),
                origT = this.m.get('theT'),
                origZ = this.m.get('theZ');

            var html = "",
                size = 50,
                rect, src, zoom,
                top, left, div_w, div_h, img_w, img_h;

            // loop through ROIs, using our cloned model to generate src urls
            // first, get the current Z and T of cloned model...
            this.m.set('z_projection', false);      // in case z_projection is true

            for (var r=0; r<rects.length; r++) {
                rect = rects[r];
                if (rect.theT > -1) this.m.set('theT', rect.theT, {'silent': true});
                if (rect.theZ > -1) this.m.set('theZ', rect.theZ, {'silent': true});
                src = this.m.get_img_src();
                if (rect.width > rect.height) {
                    div_w = size;
                    div_h = (rect.height/rect.width) * div_w;
                } else {
                    div_h = size;
                    div_w = (rect.width/rect.height) * div_h;
                }
                zoom = div_w/rect.width;
                img_w = orig_width * zoom;
                img_h = orig_height * zoom;
                top = -(zoom * rect.y);
                left = -(zoom * rect.x);
                rect.theT = rect.theT !== undefined ? rect.theT : origT;
                rect.theZ = rect.theZ !== undefined ? rect.theZ : origZ;

                var json = {
                    'msg': msg,
                    'src': src,
                    'rect': rect,
                    'w': div_w,
                    'h': div_h,
                    'top': top,
                    'left': left,
                    'img_w': img_w,
                    'img_h': img_h,
                    'theZ': rect.theZ + 1,
                    'theT': rect.theT + 1,
                    'roiId': rect.roiId,
                    'tStart': false,
                    'zStart': false,
                }
                // set start/end indices (1-based) if we have them
                if (rect.tStart !== undefined) {json.tStart = (+rect.tStart) + 1}
                if (rect.tEnd !== undefined) {json.tEnd = (+rect.tEnd) + 1}
                if (rect.zStart !== undefined) {json.zStart = (+rect.zStart) + 1}
                if (rect.zEnd !== undefined) {json.zEnd = (+rect.zEnd) + 1}
                html += this.roiTemplate(json);
            }
            if (html.length === 0) {
                html = "<tr><td colspan='3'>" + msg + "</td></tr>";
            }
            $(target + " tbody", this.$el).html(html);

            // reset Z/T as before
            this.m.set({'theT': origT, 'theZ': origZ});
        },

        zoomToFit: function() {
            var max_w = 500,
                max_h = 450,
                w = this.m.get('orig_width'),
                h = this.m.get('orig_height');
                scale = Math.min(max_w/w, max_h/h);
            this.setZoom(scale * 100);
        },

        setZoom: function(percent) {
            this.zoom = percent;
            this.render();
        },

        render: function() {
            var scale = this.zoom / 100,
                roi = this.currentROI,
                w = this.m.get('orig_width'),
                h = this.m.get('orig_height');
            var newW = w * scale,
                newH = h * scale;
            this.m.set('zoom', 100);
            this.m.set('width', newW);
            this.m.set('height', newH);
            var src = this.m.get_img_src();
            var css = this.m.get_vp_img_css(100, newW, newH);

            this.paper.setSize(newW, newH);
            $("#crop_paper").css({'height': newH, 'width': newW});
            $("#cropViewer").css({'height': newH, 'width': newW});

            this.$cropImg.css(css)
                    .attr('src', src);

            var roiX = this.currentROI.x * scale,
                roiY = this.currentROI.y * scale,
                roiW = this.currentROI.width * scale,
                roiH = this.currentROI.height * scale;
            this.cropModel.set({
                'x': roiX, 'y': roiY, 'width': roiW, 'height': roiH,
                'selected': true
            });
        }
    });
