

var ChgrpModalView = Backbone.View.extend({

    el: $("#chgrpModal"),

    model: FigureModel,

    imagesByGroup: {},
    targetGroups: [],

    initialize: function () {

        var self = this;

        this.enableSubmit(false);
        // Here we handle init of the dialog when it's shown...
        $("#chgrpModal").bind("show.bs.modal", function () {
            $('#chgrpModal .modal-body').html("");
            self.loadGroups();
            self.loadImageDetails();
        });
    },

    events: {
        "click .chgrpForm input": "inputClicked",
        "submit .chgrpForm": "handleSubmit"
    },

    loadImageDetails: function() {
        var imgIds = this.model.panels.pluck('imageId');
        console.log('imgIds', imgIds);
        var url = `${BASE_WEBFIGURE_URL}images_details/?image=${_.uniq(imgIds).join(',')}`;
        $.getJSON(url, function (data) {
            console.log(data);
            // Sort images by Group
            this.imagesByGroup = data.data.reduce(function(prev, img){
                if (!prev[img.group.id]) {
                    prev[img.group.id] = [];
                }
                prev[img.group.id].push(img);
                return prev;
            }, {});
            this.render();
        }.bind(this));
    },

    loadGroups: function() {
        var groupId = this.model.get('groupId');
        var url = `${API_BASE_URL_V0}m/experimenters/${USER_ID}/experimentergroups/`;
        $.getJSON(url, function(data){
            this.targetGroups = data.data.map(group => {return {id: group['@id'], name: group.Name}})
                .filter(group => group.id != groupId && group.name != 'user');
            this.render();
        }.bind(this));
    },

    inputClicked: function() {
        this.enableSubmit(true);
    },

    // we disable Submit when dialog is shown, enable when Group chosen
    enableSubmit: function (enabled) {
        var $okBtn = $('button[type="submit"]', this.$el);
        if (enabled) {
            $okBtn.prop('disabled', false);
            $okBtn.prop('title', 'Move to Group');
        } else {
            $okBtn.prop('disabled', 'disabled');
            $okBtn.prop('title', 'No Group selected');
        }
    },

    handleSubmit: function (event) {
        event.preventDefault();
        var group_id = parseInt($('input[name="target_group"]:checked', this.$el).val());
        var group_name = this.targetGroups.filter(group => group.id === group_id)[0].name;
        var fileId = this.model.get('fileId');
        var url = BASE_WEBFIGURE_URL + 'chgrp/';
        this.enableSubmit(false);
        setTimeout(function(){
            $('#chgrpModal .modal-body').append("<p>Moving to Group: " + group_name + "...</p>");
        }, 1000);
        $.post(url, { group_id: group_id, ann_id: fileId})
            .done(function (data) {
                $("#chgrpModal").modal('hide');
                if (data.success) {
                    this.model.set({groupId: group_id, groupName: group_name});
                    figureConfirmDialog("Success", "Figure moved to Group: " + group_name, ["OK"]);
                } else {
                    var errorMsg = data.error || "No error message available";
                    figureConfirmDialog("Move Failed", errorMsg, ["OK"]);
                }
            }.bind(this));
    },

    render: function() {
        var html = '<p>This figure is currently in Group: <strong>' + this.model.get('groupName') + '</strong>.</p>';

        var groupCount = Object.keys(this.imagesByGroup).length;
        html += `<p>Images in this figure belong to ${groupCount} Group${groupCount == 1 ? '' : 's'}: `
        html += Object.keys(this.imagesByGroup).map(groupId => {
            var imgIds = this.imagesByGroup[groupId].map(i => i.id);
            var groupName = this.imagesByGroup[groupId][0].group.name;
            return `
                <b>${groupName}</b>
                (<a target="_blank" href="${WEBINDEX_URL}?show=image-${imgIds.join('|image-')}">${imgIds.length} image${imgIds.length == 1 ? '' : 's'}</a>)`}).join(", ") + '.</p>';

        if (this.targetGroups.length === 0) {
            html += "<p>No other Groups available (You are not a member of any other groups)</p>";
        } else {
            html += "<p>Move to Group...</p>";
            html += this.targetGroups.map(group => `<div class="radio">
                <label><input type="radio" name="target_group" value="${group.id}">
                    ${group.name}
                </label></div>`)
                .join("\n");
        }
        $('.modal-body', this.$el).html(html);
    }
});
