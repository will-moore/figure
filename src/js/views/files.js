
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

var FigureFile = Backbone.Model.extend({

    defaults: {
        disabled: false,
    },

    initialize: function() {

        var desc = this.get('description');
        if (desc && desc.imageId) {
            this.set('imageId', desc.imageId);
        } else {
            this.set('imageId', 0);
        }
        if (desc && desc.baseUrl) {
            this.set('baseUrl', desc.baseUrl);
        }
    },

    isVisible: function(filter) {
        if (filter.owner) {
            if (this.get('ownerFullName') !== filter.owner) {
                return false;
            }
        }
        if (filter.name) {
            // Search for files that have all words in
            var name = this.get('name').toLowerCase();
            var words = $.trim(filter.name).split(" ");
            var visible = words.reduce(function(prev, t){
                return prev && name.indexOf(t) > -1
            }, true);
            return visible;
        }
        return true;
    }
});


var FileList = Backbone.Collection.extend({

    model: FigureFile,

    comparator: 'creationDate',

    initialize: function() {
    },

    disable: function(fileId) {
        // enable all first
        this.where({disabled: true}).forEach(function(f){
            f.set('disabled', false);
        });

        var f = this.get(fileId);
        if (f) {
            f.set('disabled', true);
        }
    },

    deleteFile: function(fileId, name) {
        // may not have fetched files...
        var f = this.get(fileId),   // might be undefined
            msg = "Delete '" + name + "'?",
            self = this;
        if (confirm(msg)) {
            $.post( DELETE_WEBFIGURE_URL, { fileId: fileId })
                .done(function(){
                    self.remove(f);
                    app.navigate("", {trigger: true});
                });
        }
    },

    url: function() {
        return LIST_WEBFIGURES_URL;
    }
});


var FileListView = Backbone.View.extend({

    el: $("#openFigureModal"),

    initialize:function (options) {
        this.$tbody = $('tbody', this.$el);
        this.$fileFilter = $('#file-filter');
        this.owner = USER_FULL_NAME;
        var self = this;
        // we automatically 'sort' on fetch, add etc.
        this.model.bind("sync remove sort", this.render, this);
        this.$fileFilter.val("");

        // we only need this to know the currently opened file
        this.figureModel = options.figureModel;

        $("#openFigureModal").bind("show.bs.modal", function(){
            // When the dialog opens, we load files...
            var currentFileId = self.figureModel.get('fileId');
            if (self.model.length === 0) {
                self.refresh_files();
            } else {
                self.render();
            }
        });
    },

    events: {
        "click .sort-created": "sort_created",
        "click .sort-created-reverse": "sort_created_reverse",
        "click .sort-name": "sort_name",
        "click .sort-name-reverse": "sort_name_reverse",
        "click .pick-owner": "pick_owner",
        "keyup #file-filter": "filter_files",
        "click .refresh-files": "refresh_files",
    },

    refresh_files: function(event) {
        // will trigger sort & render()
        var loadingHtml = "<tr><td colspan='4' style='text-align:center'><h1><small>Loading Files...</small></h1></td></tr>"
        this.$tbody.html(loadingHtml);
        this.model.fetch();
    },

    filter_files: function(event) {
        // render() will pick the new filter text
        this.render();
    },

    sort_created: function(event) {
        this.render_sort_btn(event);
        this.model.comparator = 'creationDate';
        this.model.sort();
    },

    sort_created_reverse: function(event) {
        this.render_sort_btn(event);
        this.model.comparator = function(left, right) {
            var l = left.get('creationDate'),
                r = right.get('creationDate');
            return l < r ? 1 : l > r ? -1 : 0;
        };
        this.model.sort();
    },

    sort_name: function(event) {
        this.render_sort_btn(event);
        this.model.comparator = 'name';
        this.model.sort();
    },

    sort_name_reverse: function(event) {
        this.render_sort_btn(event);
        this.model.comparator = function(left, right) {
            var l = left.get('name'),
                r = right.get('name');
            return l < r ? 1 : l > r ? -1 : 0;
        };
        this.model.sort();
    },

    render_sort_btn: function(event) {
        $("th .btn-sm", this.$el).addClass('muted');
        $(event.target).removeClass('muted');
    },

    pick_owner: function(event) {
        event.preventDefault()
        var owner = $(event.target).text();
        if (owner != " -- Show All -- ") {
            this.owner = owner;
        } else {
            delete this.owner;
        }
        this.render();
    },

    render:function () {
        var self = this,
            filter = {},
            filterVal = this.$fileFilter.val(),
            currentFileId = this.figureModel.get('fileId');
        if (this.owner && this.owner.length > 0) {
            filter.owner = this.owner;
        }
        if (filterVal.length > 0) {
            filter.name = filterVal.toLowerCase();
        }
        this.$tbody.empty();
        if (this.model.models.length === 0) {
            var msg = "<tr><td colspan='3'>" +
                "You have no figures. Start by <a href='" + BASE_WEBFIGURE_URL + "new'>creating a new figure</a>" +
                "</td></tr>";
            self.$tbody.html(msg);
        }
        _.each(this.model.models, function (file) {
            if (file.isVisible(filter)) {
                var disabled = currentFileId === file.get('id') ? true: false;
                file.set('disabled', disabled);
                var e = new FileListItemView({model:file}).render().el;
                self.$tbody.prepend(e);
            }
        });
        owners = this.model.pluck("ownerFullName");
        owners = _.uniq(owners, false);
        // Sort by last name
        owners.sort(function compare(a, b) {
            var aNames = a.split(" "),
                aN = aNames[aNames.length - 1],
                bNames = b.split(" "),
                bN = bNames[bNames.length - 1];
            return aN > bN;
        });
        var ownersHtml = "<li><a class='pick-owner' href='#'> -- Show All -- </a></li>";
            ownersHtml += "<li class='divider'></li>";
        _.each(owners, function(owner) {
            ownersHtml += "<li><a class='pick-owner' href='#'>" + owner + "</a></li>";
        });
        $("#owner-menu").html(ownersHtml);
        return this;
    }
});

var FileListItemView = Backbone.View.extend({

    tagName:"tr",

    template: JST["src/templates/files/figure_file_item.html"],

    initialize:function () {
        this.model.bind("change", this.render, this);
        this.model.bind("destroy", this.close, this);
    },

    events: {
        "click a": "hide_file_chooser"
    },

    hide_file_chooser: function() {
        $("#openFigureModal").modal('hide');
    },

    formatDate: function(secs) {
        // if secs is a number, create a Date...
        if (secs * 1000) {
            var d = new Date(secs * 1000),
            s = d.toISOString();        // "2014-02-26T23:09:09.415Z"
            s = s.replace("T", " ");
            s = s.substr(0, 16);
            return s;
        }
        // handle string
        return secs;
    },

    render:function () {
        var json = this.model.toJSON(),
            baseUrl = json.baseUrl;
        if (!json.imageId){
            // Description may be json encoded...
            try {
                var d = JSON.parse(json.description);
                // ...with imageId and name (unicode supported)
                if (d.imageId) {
                    json.imageId = d.imageId;
                    // we cache this so we don't have to parse() on each render()
                    this.model.set('imageId', d.imageId);
                }
                if (d.name) {
                    json.name = _.escape(d.name);
                    this.model.set('name', json.name);
                }
            } catch (err) {
                console.log('failed to parse json', json.description);
            }
        }
        baseUrl = baseUrl || BASE_WEBFIGURE_URL.slice(0, -1);  // remove last /
        json.thumbSrc = baseUrl + "/render_thumbnail/" + json.imageId + "/";
        json.url = BASE_WEBFIGURE_URL + "file/" + json.id;
        json.formatDate = this.formatDate;
        var h = this.template(json);
        $(this.el).html(h);
        return this;
    }

});