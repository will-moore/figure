
// Copyright (c) 2015 University of Dundee.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.


var LegendView = Backbone.View.extend({

        // Use 'body' to handle Menu: File > Add Figure Legend
        el: $("body"),

        model:FigureModel,

        editing: false,

        initialize: function() {

            this.listenTo(this.model,
                'change:x change:legend', this.legendChanged);

            this.render();
        },

        events: {
            "click .edit-legend": "editLegend",
            "click .cancel-legend": "cancelLegend",
            "click .save-legend": "saveLegend",
            "click .collapse-legend": "collapseLegend",
            "click .expand-legend": "expandLegend",
            "click .markdown-info": "markdownInfo",
            "click .panel-body p": "legendClick",
        },

        // Click on the legend <p>. Start editing or follow link
        legendClick: function(event) {
            event.preventDefault();
            // If link, open new window / tab
            if (event.target.nodeName.toLowerCase() == "a") {
                var href = event.target.getAttribute('href');
                window.open(href, '_blank');
                return false;
            // Click on legend text expands then edits legend
            } else {
                if (this.model.get("legend_collapsed")) {
                    this.expandLegend();
                } else {
                    this.editLegend();
                }
            }
        },

        markdownInfo: function(event) {
            event.preventDefault();
            $("#markdownInfoModal").modal('show');
        },

        collapseLegend: function(event) {
            this.renderCollapsed(true);
            this.model.set("legend_collapsed", true);
        },

        expandLegend: function(event) {
            this.renderCollapsed(false);
            this.model.set("legend_collapsed", false);
        },

        saveLegend: function(event) {
            event.preventDefault();
            var legendTxt = $("#js-legend textarea").val();
            this.model.save("legend", legendTxt);
            // This will happen anyway if legend has changed, 
            // but just in case it hasn't....
            this.editing = false;
            this.render();
        },

        editLegend: function(event) {
            if (event) event.preventDefault();
            this.editing = true;
            if (this.model.get("legend_collapsed")) {
                this.model.set("legend_collapsed", false);
            }
            this.render();
        },

        cancelLegend: function(event) {
            event.preventDefault();
            this.editing = false;
            this.render();
        },

        renderCollapsed: function(collapsed) {
            var $panel = $('.panel', self.el);
            if (collapsed) {
                $panel.addClass('legend-collapsed');
                $panel.removeClass('legend-expanded');
            } else {
                $panel.removeClass('legend-collapsed');
                $panel.addClass('legend-expanded');
            }
        },

        // May have chaned by opening a new Figure etc.
        legendChanged: function() {
            this.editing = false;
            this.render();
        },

        render: function() {

            var self = this,
                legendText = this.model.get('legend') || "",
                legendCollapsed = this.model.get('legend_collapsed'),
                $el = $("#js-legend"),
                $edit = $('.edit-legend', $el),
                $save = $('.save-legend', $el),
                $cancel = $('.cancel-legend', $el),
                $panel = $('.panel', $el),
                $legend = $('.legend', $el);

            self.renderCollapsed(legendCollapsed);

            // if we're editing...
            if (self.editing) {
                // show 'cancel' and 'save' buttons
                $edit.hide();
                $save.show();
                $cancel.show();

                $panel.addClass('editing');
                $panel.show();
                var html = '<textarea class="form-control" rows="9" style="resize:none">'
                            + legendText + '</textarea>';
                $legend.html(html);
            } else {
                // ...only show 'edit' button
                $edit.show();
                $save.hide();
                $cancel.hide();

                $panel.removeClass('editing');
                if (legendText.length === 0) {
                    $panel.hide();
                    $edit.text("Add Figure Legend");
                } else {
                    $panel.show();
                    legendText = markdown.toHTML( legendText );
                    $legend.html(legendText);
                    $edit.text("Edit Figure Legend");
                }
            }
        }
    });
