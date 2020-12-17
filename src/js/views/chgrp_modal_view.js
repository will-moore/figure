

var ChgrpModalView = Backbone.View.extend({

    el: $("#chgrpModal"),

    // template: JST["src/templates/modal_dialogs/chgrp_modal.html"],

    model: FigureModel,

    targetGroups: [],

    initialize: function () {

        var self = this;

        this.enableSubmit(false);
        // Here we handle init of the dialog when it's shown...
        $("#chgrpModal").bind("show.bs.modal", function () {
            $('#chgrpModal .modal-body').html("");
            self.loadGroups();
        });
    },

    events: {
        "click .chgrpForm input": "inputClicked",
        "submit .chgrpForm": "handleSubmit"
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
        var html = '<p>This figure is currently in Group: <strong>' + this.model.get('groupName') + '</strong></p>';
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
