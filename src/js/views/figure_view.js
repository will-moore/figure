
    // -------------------------- Backbone VIEWS -----------------------------------------
    import Backbone from "backbone";
    import $ from "jquery";
    import * as bootstrap from 'bootstrap'

    import FigureModel from "../models/figure_model";
    import {FigureFileList, FileListView} from "./files";

    import {AddImagesModalView, DpiModalView, PaperSetupModalView, SetIdModalView } from "./modal_views";

    import {CropModalView} from "./crop_modal_view";
    import {ChgrpModalView} from "./chgrp_modal_view";
    import {RoiModalView} from "./roi_modal_view";
    import {LegendView} from "./legend_view";
    import {LabelFromMapsModal} from "./labels_from_maps_modal";
    import PanelView from "./panel_view";

    // var SelectionView = Backbone.View.extend({
    var FigureView = Backbone.View.extend({

        el: $("#body"),

        initialize: function(opts) {

            // Delegate some responsibility to other views
            new AlignmentToolbarView({model: this.model});
            new AddImagesModalView({model: this.model, figureView: this});
            new SetIdModalView({model: this.model});
            new PaperSetupModalView({model: this.model});
            new CropModalView({model: this.model});
            new ChgrpModalView({ model: this.model });
            new RoiModalView({model: this.model});
            new DpiModalView({model: this.model});
            new LegendView({model: this.model});
            new LabelFromMapsModal({model: this.model});

            this.figureFiles = new FigureFileList();
            new FileListView({model:this.figureFiles, figureModel: this.model});

            // set up various elements and we need repeatedly
            this.$main = $('main');
            this.$canvas = $("#canvas");
            this.$canvas_wrapper = $("#canvas_wrapper");
            this.$figure = $("#figure");
            this.$copyBtn = $(".copy");
            this.$pasteBtn = $(".paste");
            this.$saveBtn = $(".save_figure.btn");
            this.$saveOption = $("li.save_figure");
            this.$saveAsOption = $("li.save_as");
            this.$deleteOption = $("li.delete_figure");

            this.aboutModal = new bootstrap.Modal('#aboutModal');

            var self = this;

            // Render on changes to the model
            this.model.on('change:paper_width change:paper_height change:page_count', this.render, this);

            // If a panel is added...
            this.model.panels.on("add", this.addOne, this);

            // Don't leave the page with unsaved changes!
            window.onbeforeunload = function() {
                var canEdit = self.model.get('canEdit');
                if (self.model.get("unsaved")) {
                    return "Leave page with unsaved changes?";
                }
            };

            // $("#zoom_slider").slider({
            //     max: 400,
            //     min: 10,
            //     value: 75,
            //     slide: function(event, ui) {
            //         self.model.set('curr_zoom', ui.value);
            //     }
            // });

            // respond to zoom changes
            this.listenTo(this.model, 'change:curr_zoom', this.renderZoom);
            this.listenTo(this.model, 'change:selection', this.renderSelectionChange);
            this.listenTo(this.model, 'change:unsaved', this.renderSaveBtn);
            this.listenTo(this.model, 'change:figureName', this.renderFigureName);

            // Full render if page_color changes (might need to update labels etc)
            this.listenTo(this.model, 'change:page_color', this.render);
            this.listenTo(this.model, 'change:page_color', this.renderPanels);

            this.listenTo(this.model, 'change:loading_count', this.renderLoadingSpinner);

            // refresh current UI
            this.renderZoom();

            // 'Auto-render' on init.
            this.render();
            this.renderSelectionChange();

        },

        events: {
            "click .export_pdf": "export_pdf",
            "click .export_options li": "export_options",
            "click .add_panel": "addPanel",
            "click .delete_panel": "deleteSelectedPanels",
            "click .copy": "copy_selected_panels",
            "click .paste": "paste_panels",
            "click .save_figure": "save_figure_event",
            "click .save_as": "save_as_event",
            "click .new_figure": "goto_newfigure",
            "click .open_figure": "open_figure",
            "click .export_json": "export_json",
            "click .import_json": "import_json",
            "click .delete_figure": "delete_figure",
            "click .chgrp_figure": "chgrp_figure",
            "click .local_storage": "local_storage",
            "click .paper_setup": "paper_setup",
            "click .export-options a": "select_export_option",
            "click .zoom-paper-to-fit": "zoom_paper_to_fit",
            "click .about_figure": "show_about_dialog",
            "click .figure-title": "start_editing_name",
            "keyup .figure-title input": "figuretitle_keyup",
            "blur .figure-title input": "stop_editing_name",
            "submit .importJsonForm": "import_json_form"
        },

        keyboardEvents: {
            'backspace': 'deleteSelectedPanels',
            'del': 'deleteSelectedPanels',
            'mod+a': 'select_all',
            'mod+c': 'copy_selected_panels',
            'mod+v': 'paste_panels',
            'mod+s': 'save_figure_event',
            'mod+n': 'goto_newfigure',
            'mod+o': 'open_figure',
            'down' : 'nudge_down',
            'up' : 'nudge_up',
            'left' : 'nudge_left',
            'right' : 'nudge_right',
        },

        // If any modal is visible, we want to ignore keyboard events above
        // All those methods should use this
        modal_visible: function() {
            return $("div.modal.show").length > 0;
        },

        // choose an export option from the drop-down list
        export_options: function(event) {
            event.preventDefault();

            var $target = $(event.target);

            // Only show check mark on the selected item.
            $(".export_options .glyphicon-ok").css('visibility', 'hidden');
            $(".glyphicon-ok", $target).css('visibility', 'visible');

            // Update text of main export_pdf button.
            var txt = $target.attr('data-export-option');
            $('.export_pdf').text("Export " + txt).attr('data-export-option', txt);

            // Hide download button
            $("#pdf_download").hide();
        },

        paper_setup: function(event) {
            event.preventDefault();

            $("#paperSetupModal").modal();
        },

        show_about_dialog: function(event) {
            event.preventDefault();
            console.log("show....")
            this.aboutModal.show();
        },

        // Editing name workflow...
        start_editing_name: function(event) {
            var $this = $(event.target);
            var name = $this.text();
            // escape any double-quotes
            name = name.replace(/"/g, '&quot;');
            $this.html('<input value="' + name + '"/>');
            $('input', $this).focus();
        },
        figuretitle_keyup: function(event) {
            // If user hit Enter, stop editing...
            if (event.which === 13) {
                event.preventDefault();
                this.stop_editing_name();
            }
        },
        stop_editing_name: function() {
            var $this = $(".figure-title input");
            var new_name = $this.val().trim();
            if (new_name.length === 0) {
                alert("Can't have empty name.")
                return;
            }
            $(".figure-title").html(_.escape(new_name));
            // Save name... will renderFigureName only if name changed
            this.model.save('figureName', new_name);

            // clear file list (will be re-fetched when needed)
            this.figureFiles.reset();
        },

        // Heavy lifting of PDF generation handled by OMERO.script...
        export_pdf: function(event){

            event.preventDefault();

            // Status is indicated by showing / hiding 3 buttons
            var figureModel = this.model,
                $create_figure_pdf = $(event.target),
                export_opt = $create_figure_pdf.attr('data-export-option'),
                $pdf_inprogress = $("#pdf_inprogress"),
                $pdf_download = $("#pdf_download"),
                $script_error = $("#script_error"),
                exportOption = "PDF";
            $create_figure_pdf.hide();
            $pdf_download.hide();
            $script_error.hide();
            $pdf_inprogress.show();

            // Map from HTML to script options
            opts = {"PDF": "PDF",
                "PDF & images": "PDF_IMAGES",
                "TIFF": "TIFF",
                "TIFF & images": "TIFF_IMAGES",
                "to OMERO": "OMERO"};
            exportOption = opts[export_opt];

            // Get figure as json
            var figureJSON = this.model.figure_toJSON();

            var url = MAKE_WEBFIGURE_URL,
                data = {
                    figureJSON: JSON.stringify(figureJSON),
                    exportOption: exportOption,
                };

            // Start the Figure_To_Pdf.py script
            $.post( url, data).done(function( data ) {

                // {"status": "in progress", "jobId": "ProcessCallback/64be7a9e-2abb-4a48-9c5e-6d0938e1a3e2 -t:tcp -h 192.168.1.64 -p 64592"}
                var jobId = data.jobId;

                // E.g. Handle 'No Processor Available';
                if (!jobId) {
                    if (data.error) {
                        alert(data.error);
                    } else {
                        alert("Error exporting figure");
                    }
                    $create_figure_pdf.show();
                    $pdf_inprogress.hide();
                    return;
                }

                // Now we keep polling for script completion, every second...

                var i = setInterval(function (){

                    $.getJSON(ACTIVITIES_JSON_URL, function(act_data) {

                            var pdf_job = act_data[jobId];

                            // We're waiting for this flag...
                            if (pdf_job.status == "finished") {
                                clearInterval(i);

                                $create_figure_pdf.show();
                                $pdf_inprogress.hide();

                                // Show result
                                if (pdf_job.results.New_Figure) {
                                    var fa_id = pdf_job.results.New_Figure.id;
                                    if (pdf_job.results.New_Figure.type === "FileAnnotation") {
                                        var fa_download = WEBINDEX_URL + "annotation/" + fa_id + "/";
                                        $pdf_download
                                            .attr({'href': fa_download, 'data-original-title': 'Download Figure'})
                                            .show()
                                            .children('span').prop('class', 'glyphicon glyphicon-download-alt');
                                    } else if (pdf_job.results.New_Figure.type === "Image") {
                                        var fa_download = pdf_job.results.New_Figure.browse_url;
                                        $pdf_download
                                            .attr({'href': fa_download, 'data-original-title': 'Go to Figure Image'})
                                            .show()
                                            .tooltip()
                                            .children('span').prop('class', 'glyphicon glyphicon-share');
                                    }
                                } else if (pdf_job.stderr) {
                                    // Only show any errors if NO result
                                    var stderr_url = WEBINDEX_URL + "get_original_file/" + pdf_job.stderr + "/";
                                    $script_error.attr('href', stderr_url).show();
                                }
                            }

                            if (act_data.inprogress === 0) {
                                clearInterval(i);
                            }

                        }).error(function() {
                            clearInterval(i);
                        });

                }, 1000);
            });
        },

        select_export_option: function(event) {
            event.preventDefault();
            var $a = $(event.target),
                $span = $a.children('span.glyphicon');
            // We take the <span> from the <a> and place it in the <button>
            if ($span.length === 0) $span = $a;  // in case we clicked on <span>
            var $li = $span.parent().parent(),
                $button = $li.parent().prev().prev(),
                option = $span.attr("data-option");
            var $flag = $button.find("span[data-option='" + option + "']");
            if ($flag.length > 0) {
                $flag.remove();
            } else {
                $span = $span.clone();
                $button.append($span);
            }
            $button.trigger('change');      // can listen for this if we want to 'submit' etc
        },

        nudge_right: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.nudge_right();
        },

        nudge_left: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.nudge_left();
        },

        nudge_down: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.nudge_down();
        },

        nudge_up: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.nudge_up();
        },

        local_storage: function (event) {
            var buttons = ['Close'];
            let figureObject = recoverFigureFromStorage();
            var message = `<p>Any figure that fails to Save is stored in the browser's local storage.</p>`;
            if (figureObject) {
                buttons = buttons.concat(['Clear Storage', 'Recover Figure']);
                message += `<p>You can Clear local storage or Recover the figure from local storage with the options below:</p>`;
            } else {
                message += `<p>No Figure currently found.</p>`;
            }
            var callback = function (btnText) {
                if (btnText === "Clear Storage") {
                    clearFigureFromStorage();
                } else if (btnText === "Recover Figure") {
                    window.location = BASE_WEBFIGURE_URL + 'recover/';
                }
            }
            figureConfirmDialog("Local Storage", message, buttons, callback);
        },

        goto_newfigure: function(event) {
            if (event) event.preventDefault();
            $(".modal").modal('hide');

            var self = this;
            var callback = function() {
                self.model.clearFigure();
                $('#addImagesModal').modal();
                // navigate will be ignored if we're already on /new
                app.navigate("new/", {trigger: true});
            };

            if (this.model.get("unsaved")) {
                var saveBtnTxt = "Save",
                    canEdit = this.model.get('canEdit');
                if (!canEdit) saveBtnTxt = "Save a Copy";

                figureConfirmDialog("Save Changes to Figure?",
                    "Your changes will be lost if you don't save them",
                    ["Cancel", "Don't Save", saveBtnTxt],
                    function(btnTxt){
                        if (btnTxt === saveBtnTxt) {
                            self.save_figure({success: callback});
                        } else if (btnTxt === "Don't Save") {
                            callback();
                        }
                    });
            } else {
                callback();
            }
        },

        delete_figure: function(event) {
            event.preventDefault();
            var fileId = this.model.get('fileId'),
                figName = this.model.get('figureName');
            if(fileId) {
                this.model.set("unsaved", false);   // prevent "Save?" dialog
                this.figureFiles.deleteFile(fileId, figName);
            }
        },

        chgrp_figure: function (event) {
            event.preventDefault();
            $(".modal").modal('hide');
            $("#chgrpModal").modal('show');
        },

        open_figure: function(event) {
            event.preventDefault();
            $(".modal").modal('hide');

            var self = this,
                currentFileId = self.model.get('fileId');
            var callback = function() {
                // Opening modal will trigger fetch of files
                // Handled in FileListView
                $("#openFigureModal").modal();
            };

            if (this.model.get("unsaved")) {
                var saveBtnTxt = "Save",
                    canEdit = this.model.get('canEdit');
                if (!canEdit) saveBtnTxt = "Save a Copy";

                figureConfirmDialog("Save Changes to Figure?",
                    "Your changes will be lost if you don't save them",
                    ["Cancel", "Don't Save", saveBtnTxt],
                    function(btnTxt){
                        if (btnTxt === saveBtnTxt) {
                            // List files after saving current file
                            self.save_figure({success: callback});
                        } else if (btnTxt === "Don't Save") {
                            self.model.set("unsaved", false);
                            callback();
                        }
                    });
            } else {
                callback();
            }
        },

        save_figure_event: function(event) {
            if (event) {
                event.preventDefault();
            }
            this.$saveBtn.tooltip('hide');
            this.save_figure();
        },

        save_figure: function(options) {
            options = options || {};

            var fileId = this.model.get('fileId'),
                canEdit = this.model.get('canEdit');
            if (fileId && canEdit) {
                // Prevent double-click
                this.$saveBtn.attr('disabled', 'disabled');
                // Save
                options.fileId = fileId;
                this.model.save_to_OMERO(options);
            } else {
                this.save_as(options);
            }

        },

        save_as_event: function(event) {
            if (event) {
                event.preventDefault();
            }
            this.save_as();
        },

        save_as: function(options) {

            // clear file list (will be re-fetched when needed)
            this.figureFiles.reset();

            var self = this;
            options = options || {};
            var defaultName = this.model.get('figureName');
            if (!defaultName) {
                defaultName = this.model.getDefaultFigureName();
            }
            var figureName = prompt("Enter Figure Name", defaultName);

            var nav = function(data){
                app.navigate("file/"+data);
                // in case you've Saved a copy of a file you can't edit
                self.model.set('canEdit', true);
            };
            if (figureName) {
                options.figureName = figureName;
                // On save, go to newly saved page, unless we have callback already
                options.success = options.success || nav;
                // Save
                this.model.save_to_OMERO(options);
            }

        },

        export_json: function(event) {
            event.preventDefault();
            showExportAsJsonModal(this.model.figure_toJSON());
        },
        
        import_json: function(event) {
            event.preventDefault();

            var showImport = function() {
              $('#importJsonModal').modal('show');
            };
            
            app.checkSaveAndClear(function() { showImport()} );
        },

        import_json_form: function(event) {
          event.preventDefault();
          
          var $form = $('.importJsonForm'),
              figureJSON = $('.form-control', $form).val();
          this.model.figure_fromJSON(figureJSON);
            
          $('#importJsonModal').modal('hide');
          $('#importJsonModal textarea').val('');
          this.render();
        },
        
        copy_selected_panels: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            var s = this.model.getSelected();
            var cd = [];
            s.forEach(function(m) {
                var copy = m.toJSON();
                delete copy.id;
                cd.push(copy);
            });
            this.model.set('clipboard', {'PANELS': cd});
            this.$pasteBtn.removeClass("disabled");
        },

        paste_panels: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            var clipboard_data = this.model.get('clipboard'),
                clipboard_panels;
            if (clipboard_data && 'PANELS' in clipboard_data){
                clipboard_panels = clipboard_data.PANELS;
            } else if (clipboard_data && 'SHAPES' in clipboard_data) {

                // If we've actually got SHAPES in the clipboard,
                // paste them onto each selected panel...
                clipboard_panels = clipboard_data.SHAPES;
                var sel = this.model.getSelected();
                var allOK = true;
                sel.forEach(function(p){
                    var ok = p.add_shapes(clipboard_panels);
                    if (!ok) {allOK = false;}
                });
                // If any shapes were outside viewport, show message
                var plural = sel.length > 1 ? "s" : "";
                if (!allOK) {
                    figureConfirmDialog("Paste Failure",
                        "Some shapes may be outside the visible 'viewport' of panel" + plural + ". " +
                        "Target image" + plural + " may be too small or zoomed in too much. " +
                        "Try zooming out before pasting again, or paste to a bigger image.",
                        ["OK"]);
                }
                // And we're done...
                return;
            } else {
                return;
            }

            var self = this;
            this.model.clearSelected();

            // first work out the bounding box of clipboard panels
            var top, left, bottom, right;
            _.each(clipboard_panels, function(m, i) {
                var t = m.y,
                    l = m.x,
                    b = t + m.height,
                    r = l + m.width;
                if (i === 0) {
                    top = t; left = l; bottom = b; right = r;
                } else {
                    top = Math.min(top, t);
                    left = Math.min(left, l);
                    bottom = Math.max(bottom, b);
                    right = Math.max(right, r);
                }
            });
            var height = bottom - top,
                width = right - left,
                offset_x = 0,
                offset_y = 0;

            // if pasting a 'row', paste below. Paste 'column' to right.
            if (width > height) {
                offset_y = height + height/20;  // add a spacer
            } else {
                offset_x = width + width/20;
            }

            // apply offset to clipboard data & paste
            // NB: we are modifying the list that is in the clipboard
            _.each(clipboard_panels, function(m) {
                m.x = m.x + offset_x;
                m.y = m.y + offset_y;
                self.model.panels.create(m);
            });
            // only pasted panels are selected - simply trigger...
            this.model.notifySelectionChange();
        },

        select_all: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.select_all();
        },

        deleteSelectedPanels: function(event) {
            event.preventDefault();
            if (this.modal_visible()) return true;
            this.model.deleteSelected();
        },

        // User has zoomed the UI - work out new sizes etc...
        // We zoom the main content 'canvas' using css transform: scale()
        // But also need to resize the canvas_wrapper manually.
        renderZoom: function() {
            var curr_zoom = this.model.get('curr_zoom'),
                zoom = curr_zoom * 0.01,
                newWidth = parseInt(this.orig_width * zoom, 10),
                newHeight = parseInt(this.orig_height * zoom, 10),
                scale = "scale("+zoom+", "+zoom+")";

            // We want to stay centered on the same spot...
            var curr_centre = this.getCentre(true);

            // Scale canvas via css
            this.$canvas.css({"transform": scale, "-webkit-transform": scale, "-ms-transform": scale});

            // Scale canvas wrapper manually
            var canvas_w = this.model.get('canvas_width'),
                canvas_h = this.model.get('canvas_height');
            var scaled_w = canvas_w * zoom,
                scaled_h = canvas_h * zoom;
            this.$canvas_wrapper.css({'width':scaled_w+"px", 'height': scaled_h+"px"});
            // and offset the canvas to stay visible
            var margin_top = (scaled_h - canvas_h)/2,
                margin_left = (scaled_w - canvas_w)/2;
            this.$canvas.css({'top': margin_top+"px", "left": margin_left+"px"});

            // ...apply centre from before zooming
            if (curr_centre) {
                this.setCentre(curr_centre);
            }

            // Show zoom level in UI
            $("#zoom_input").val(curr_zoom);
        },

        // Centre the viewport on the middle of the paper
        reCentre: function() {
            var size = this.model.getFigureSize();
            this.setCentre( {'x':size.w/2, 'y':size.h/2} );
        },

        // Get the coordinates on the paper of the viewport center.
        // Used after zoom update (but BEFORE the UI has changed)
        getCentre: function(previous) {
            // Need to know the zoom BEFORE the update
            var m = this.model,
                curr_zoom = m.get('curr_zoom');
            if (previous) {
                curr_zoom = m.previous('curr_zoom');
            }
            if (curr_zoom === undefined) {
                return;
            }
            var viewport_w = this.$main.width(),
                viewport_h = this.$main.height(),
                co = this.$canvas_wrapper.offset(),
                mo = this.$main.offset(),
                offst_left = co.left - mo.left,
                offst_top = co.top - mo.top,
                cx = -offst_left + viewport_w/2,
                cy = -offst_top + viewport_h/2,
                zm_fraction = curr_zoom * 0.01;

            var size = this.model.getFigureSize();
            var paper_left = (m.get('canvas_width') - size.w)/2,
                paper_top = (m.get('canvas_height') - size.h)/2;
            return {'x':(cx/zm_fraction)-paper_left, 'y':(cy/zm_fraction)-paper_top};
        },

        // Scroll viewport to place a specified paper coordinate at the centre
        setCentre: function(cx_cy, speed) {
            var m = this.model,
                size = this.model.getFigureSize(),
                paper_left = (m.get('canvas_width') - size.w)/2,
                paper_top = (m.get('canvas_height') - size.h)/2;
            var curr_zoom = m.get('curr_zoom'),
                zm_fraction = curr_zoom * 0.01,
                cx = (cx_cy.x+paper_left) * zm_fraction,
                cy = (cx_cy.y+paper_top) * zm_fraction,
                viewport_w = this.$main.width(),
                viewport_h = this.$main.height(),
                offst_left = cx - viewport_w/2,
                offst_top = cy - viewport_h/2;
            speed = speed || 0;
            this.$main.animate({
                scrollLeft: offst_left,
                scrollTop: offst_top
            }, speed);
        },

        zoom_paper_to_fit: function(event) {

            var m = this.model,
                size = this.model.getFigureSize(),
                viewport_w = this.$main.width(),
                viewport_h = this.$main.height();

            var zoom_x = viewport_w/(size.w + 100),
                zoom_y = viewport_h/(size.h + 100),
                zm = Math.min(zoom_x, zoom_y);
            zm = (zm * 100) >> 0;

            m.set('curr_zoom', zm) ;
            // $("#zoom_slider").slider({ value: zm });

            // seems we sometimes need to wait to workaround bugs
            var self = this;
            setTimeout(function(){
                self.reCentre();
            }, 10);
        },

        // Add a panel to the view
        addOne: function(panel) {
            var page_color = this.model.get('page_color');
            var view = new PanelView({model:panel, page_color:page_color});
            this.$figure.append(view.render().el);
        },

        renderLoadingSpinner: function() {
            if (this.model.get('loading_count') > 0) {
                $("#addImagesSpinner").show();
            } else {
                $("#addImagesSpinner").hide();
            }
        },

        renderFigureName: function() {

            var title = "OMERO.figure",
                figureName = this.model.get('figureName');
            if ((figureName) && (figureName.length > 0)) {
                title += " - " + figureName;
            } else {
                figureName = "";
            }
            $('title').text(title);
            $(".figure-title").text(figureName);
        },

        renderSaveBtn: function() {

            var canEdit = this.model.get('canEdit'),
                noFile = (typeof this.model.get('fileId') == 'undefined'),
                btnText = (canEdit || noFile) ? "Save" : "Can't Save";
            this.$saveBtn.text(btnText);
            if (this.model.get('unsaved') && (canEdit || noFile)) {
                this.$saveBtn.addClass('btn-success').removeClass('btn-default').removeAttr('disabled');
                this.$saveOption.removeClass('disabled');
            } else {
                this.$saveBtn.addClass('btn-default').removeClass('btn-success').attr('disabled', 'disabled');
                this.$saveOption.addClass('disabled');
            }
            if (this.model.get('fileId')) {
                this.$deleteOption.removeClass('disabled');
            } else {
                this.$deleteOption.addClass('disabled');
            }
        },

        renderSelectionChange: function() {
            var $delete_panel = $('.delete_panel', this.$el);
            if (this.model.getSelected().length > 0) {
                $delete_panel.removeAttr("disabled");
                this.$copyBtn.removeClass("disabled");
            } else {
                $delete_panel.attr("disabled", "disabled");
                this.$copyBtn.addClass("disabled");
            }
        },

        renderPanels: function() {
            // Re-render all the panels...
            // Remove and re-add
            $('.imagePanel', this.$figure).remove();
            this.model.panels.forEach(function(panel){
                this.addOne(panel);
            }.bind(this));
        },

        // Render is called on init()
        // Update any changes to sizes of paper or canvas
        render: function() {
            var m = this.model,
                zoom = m.get('curr_zoom') * 0.01;

            var page_w = m.get('paper_width'),
                page_h = m.get('paper_height'),
                page_color = m.get('page_color'),
                size = this.model.getFigureSize(),
                canvas_w = Math.max(m.get('canvas_width'), size.w),
                canvas_h = Math.max(m.get('canvas_height'), size.h),
                page_count = m.get('page_count'),
                paper_spacing = m.get('paper_spacing'),
                figure_left = (canvas_w - size.w)/2,
                figure_top = (canvas_h - size.h)/2;

            var $pages = $(".paper"),
                left, top, row, col;
            if ($pages.length !== page_count) {
                $pages.remove();
                for (var p=0; p<page_count; p++) {
                    row = Math.floor(p/size.cols);
                    col = p % size.cols;
                    top = row * (page_h + paper_spacing);
                    left = col * (page_w + paper_spacing);
                    $("<div class='paper'></div>")
                        .css({'left': left, 'top': top})
                        .prependTo(this.$figure);
                }
                $pages = $(".paper");
            }

            $pages.css({'width': page_w, 'height': page_h, 'background-color': '#' + page_color});

            this.$figure.css({'width': size.w, 'height': size.h,
                    'left': figure_left, 'top': figure_top});

            $("#canvas").css({'width': canvas_w,
                    'height': canvas_h});

            // always want to do this?
            this.zoom_paper_to_fit();

            return this;
        }
    });



    var AlignmentToolbarView = Backbone.View.extend({

        el: $("#alignment-toolbars"),

        model:FigureModel,

        events: {
            "click .aleft": "align_left",
            "click .agrid": "align_grid",
            "click .atop": "align_top",

            "click .awidth": "align_width",
            "click .aheight": "align_height",
            "click .asize": "align_size",
            "click .amagnification": "align_magnification",

            "click #custom_grid_gap": "custom_grid_gap",
        },

        initialize: function() {
            this.listenTo(this.model, 'change:selection', this.render);
            this.$buttons = $(".alignment-buttons button", this.$el);
        },

        align_left: function(event) {
            event.preventDefault();
            this.model.align_left();
        },

        align_grid: function(event) {
            event.preventDefault();
            let gridGap = document.querySelector('input[name="grid_gap"]:checked').value;
            this.model.align_grid(gridGap);
        },

        align_width: function(event) {
            event.preventDefault();
            this.model.align_size(true, false);
        },

        align_height: function(event) {
            event.preventDefault();
            this.model.align_size(false, true);
        },

        align_size: function(event) {
            event.preventDefault();
            this.model.align_size(true, true);
        },

        align_magnification: function(event) {
            event.preventDefault();
            this.model.align_magnification();
        },

        align_top: function(event) {
            event.preventDefault();
            this.model.align_top();
        },

        custom_grid_gap: function() {
            let current = $("#custom_grid_gap").attr("value");
            // simple propmt to ask user for custom grid gap
            let gridGap = prompt("Enter grid gap in pixels:", current);
            gridGap = parseFloat(gridGap);
            if (isNaN(gridGap)) {
                alert("Please enter a valid number (of pixels)")
                return;
            }
            // this value will get picked up as radio grid_gap value
            $("#custom_grid_gap").attr("value", gridGap);
            // Show the value in the drop-down menu
            $("#custom_grid_gap_label").text("(" + gridGap + " px)");
        },

        render: function() {
            if (this.model.getSelected().length > 1) {
                this.$buttons.removeAttr("disabled");
            } else {
                this.$buttons.attr("disabled", "disabled");
            }
        }
    });

export default FigureView
