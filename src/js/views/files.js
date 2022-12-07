
//
// Copyright (C) 2014-2021 University of Dundee & Open Microscopy Environment.
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

import Backbone from "backbone";
import _ from "underscore";
import $ from "jquery";
import * as bootstrap from 'bootstrap'

import figure_file_item_template from '../../templates/files/figure_file_item.template.html?raw';

export var FigureFile = Backbone.Model.extend({

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
            if (this.get('owner').id !== filter.owner) {
                return false;
            }
        }
        if (filter.group) {
            if (this.get('group').id !== filter.group) {
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


export var FigureFileList = Backbone.Collection.extend({

    model: FigureFile,

    comparator: 'creationDate',

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

    removeFile: function(fileId) {
        var f = this.get(fileId)
        this.remove(f);
    },

    url: function() {
        return BASE_WEBFIGURE_URL + "list_web_figures/";
    }
});


export var FileListView = Backbone.View.extend({

    el: $("#openFigureModal"),

    initialize:function (options) {
        this.modal = new bootstrap.Modal("#openFigureModal");
        this.$tbody = $('tbody', this.$el);
        this.$fileFilter = $('#file-filter');
        this.owner = USER_ID;
        if (window.IS_PUBLIC_USER) {
            delete this.owner;
        }
        var self = this;
        // we automatically 'sort' on fetch, add etc.
        this.model.bind("sync remove sort", this.render, this);
        this.$fileFilter.val("");

        // we only need this to know the currently opened file
        this.figureModel = options.figureModel;

        document.getElementById('openFigureModal').addEventListener("show.bs.modal", function(){
            // When the dialog opens, we load files...
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
        "click .pick-group": "pick_group",
        "keyup #file-filter": "filter_files",
        "click .refresh-files": "refresh_files",
    },

    refresh_files: function(event) {
        // will trigger sort & render()
        var loadingHtml = `<tr><td colspan='5' style='text-align:center'>
            <h3 class='text-muted' style='opacity:0.7; margin:50px'><small>Loading Files...</small></h3>
        </td></tr>`
        this.$tbody.html(loadingHtml);
        let load_url = this.model.url();
        let cors_headers = { mode: 'cors', credentials: 'include' };
        // Manual fetch instead of this.model.fetch() - works for cross-origin CORS
        fetch(load_url, cors_headers)
            .then(rsp => rsp.json())
            .then(data => {
                this.model.reset();
                this.model.add(data);
            });
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
        var owner = $(event.target).data('id');
        if (owner != -1) {
            this.owner = owner;
        } else {
            delete this.owner;
        }
        this.render();
    },

    pick_group: function (event) {
        event.preventDefault()
        var group = $(event.target).data('id');
        if (group != -1) {
            this.group = group;
        } else {
            delete this.group;
        }
        this.render();
    },

    render:function () {
        var self = this,
            filter = {},
            filterVal = this.$fileFilter.val(),
            currentFileId = this.figureModel.get('fileId');
        if (this.owner && this.owner != -1) {
            filter.owner = this.owner;
        }
        if (this.group && this.group != -1) {
            filter.group = this.group;
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
                var e = new FileListItemView({model:file, listview:self}).render().el;
                self.$tbody.prepend(e);
            }
        });
        var owners = this.model.pluck("owner");
        var ownersByName = {};
        owners.forEach(function(o){
            let name = o.firstName + " " + o.lastName;
            ownersByName[name] = o.id;
        });
        var ownersNames = Object.keys(ownersByName);
        // Sort by last name
        ownersNames.sort(function compare(a, b) {
            var aNames = a.split(" "),
                aN = aNames[aNames.length - 1],
                bNames = b.split(" "),
                bN = bNames[bNames.length - 1];
            return aN > bN;
        });
        var ownersHtml = "<li><a class='dropdown-item pick-owner' href='#' data-id='-1'> -- Show All -- </a></li>";
            ownersHtml += "<li class='divider'></li>";
        _.each(ownersNames, function(name) {
            ownersHtml += "<li><a class='dropdown-item pick-owner' data-id='" + ownersByName[name] + "' href='#'>" + _.escape(name) + "</a></li>";
        });
        $("#owner-menu").html(ownersHtml);

        // render groups chooser
        var groups = this.model.pluck("group");
        var groupsByName = {};
        groups.forEach(function (g) {
            groupsByName[g.name] = g.id;
        })
        var groupNames = Object.keys(groupsByName);
        groupNames.sort();
        var groupsHtml = "<li><a class='dropdown-item pick-group' href='#' data-id='-1'> -- Show All -- </a></li><li class='divider'></li>";
        groupsHtml += groupNames.map(function (name) { return "<li><a class='dropdown-item pick-group' data-id='" + groupsByName[name] + "' href='#'>" + _.escape(name) + "</a></li>"}).join('\n');
        $("#group-menu").html(groupsHtml);
        return this;
    }
});

var FileListItemView = Backbone.View.extend({

    tagName:"tr",

    template: _.template(figure_file_item_template),

    initialize:function (opts) {
        this.model.bind("change", this.render, this);
        this.model.bind("destroy", this.close, this);
        this.listview = opts.listview;
    },

    events: {
        "click a": "hide_file_chooser"
    },

    hide_file_chooser: function() {
        this.listview.modal.hide();
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