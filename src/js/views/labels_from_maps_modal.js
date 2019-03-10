
var LabelFromMapsModal = Backbone.View.extend({

    el: $("#labelsFromMapAnns"),

    model: FigureModel,

    // label options: position, size, color
    options: {},

    initialize: function(options) {

        // when dialog is shown, load map annotations for selected images
        $("#labelsFromMapAnns").bind("show.bs.modal", function(event){
            console.log('show', event.relatedTarget);
            this.options = event.relatedTarget;
            this.loadMapAnns();
        }.bind(this));
    },

    loadMapAnns() {

        let imageIds = this.model.getSelected().map(function(m){return m.get('imageId')});
        this.isLoading = true;
        $('select', this.el).html("<option>Loading data...</option>");

        var url = WEBINDEX_URL + "api/annotations/?type=map&image=";
        url += imageIds.join("&image=");

        $.getJSON(url, function(data) {
                this.isLoading = false;
                this.annotations = data.annotations;
                this.render();
            }.bind(this)
        );
    },

    events: {
        "submit .labelsFromMapAnnsForm": "handleForm",
    },

    handleForm: function(event) {
        event.preventDefault();
        if (this.isLoading) return;

        var key = $('select', this.el).val();
        console.log('key', key);

        var labelSize = this.options.size || "12";
        var labelPosition = this.options.position || "top";
        var labelColor = this.options.color || "000000";

        var imageValues = this.annotations.reduce(function(prev, t){
            var iid = t.link.parent.id;
            if (!prev[iid]) {
                prev[iid] = [];
            }
            t.values.forEach(function(kv) {
                if (kv[0] === key) {
                    prev[iid].push(kv[1]);
                }
            });
            return prev;
        }, {});
        console.log('imageValues', imageValues);

        this.model.getSelected().forEach(function(p){
            var iid = p.get('imageId');
            if (imageValues[iid]) {
                var labels = imageValues[iid].map(function(value){
                    return {
                        'text': key + ': ' + value,
                        'size': labelSize,
                        'position': labelPosition,
                        'color': labelColor,
                    }
                });
                p.add_labels(labels);
            }
        });
        
        $("#labelsFromMapAnns").modal('hide');
        return false;
    },

    render: function() {
        // Get keys for images {'key' : {iid: true}}
        var keys = {};
        this.annotations.forEach(function(ann) {
            let iid = ann.link.parent.id;
            ann.values.forEach(function(kv){
                var key = kv[0];
                if (!keys[key]) {
                    keys[key] = {};
                }
                keys[key][iid] = true;
            })
        });
        var keyList = [];
        var keyCounts = {};

        for (var key in keys) {
            if (keys.hasOwnProperty(key)) {
                keyList.push(key);
                keyCounts[key] = Object.keys(keys[key]).length;
            }
        }
        keyList.sort(function(a, b) {
            return (a.toUpperCase() < b.toUpperCase()) ? -1 : 1; 
        });

        var html = keyList.map(function(key) {
            return "<option value='" + key + "'>" + key + " (" + keyCounts[key] + ")</option>";
        }).join("");
        $('select', this.el).html(html);
    }
});
