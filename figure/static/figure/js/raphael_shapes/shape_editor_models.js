
// Editor Model to coordinate State of Editor (drawing mode, colour etc)

var ShapeEditor = Backbone.Model.extend({

    defaults: {
        state: "SELECT",
        color: "FF0000",
        lineWidth: 2,
        zoom: 100,
    },

    initialize: function(options) {

        // Create collection to store shapes
        // TODO: will need to populate this!
        this.shapeList = options.shapeList;
        this.listenTo(this.shapeList, 'selectionChange', this.selectionChanged);
    },

    // New shape selected - update toolbar color accordingly
    selectionChanged: function() {
        var sel = this.shapeList.getSelected();
        if (sel.length > 0) {
            if (sel[0].get('color')) {
                this.set('color', sel[0].get('color'));
            }
            if (sel[0].get('stroke-width')) {
                this.set('lineWidth', sel[0].get('stroke-width'));
            }
        }
    },

    setState: function(state) {

        var states = ["SELECT", "PAN", "RECT", "LINE", "ARROW", "ELLIPSE"];  //etc
        if (states.indexOf(state) > -1) {
            this.set('state', state);
        } else {
            throw new Error("Not valid state: " + state);
        }

        // If we're creating new shapes, deselect existing ones
        if(["RECT", "LINE", "ARROW", "ELLIPSE"].indexOf(state) > -1) {
            this.shapeList.clearSelected();
        }
    },

    deleteSelectedShapes: function() {

        var sel = this.shapeList.getSelected();
        sel.forEach(function(m){
            m.destroy();
        });
    },

    // when toolbar color is changed, update any selected shapes
    setColor: function(color) {
        this.set('color', color);
        var sel = this.shapeList.getSelected();
        sel.forEach(function(m){
            m.set('color', color);
        });
    },

    // when toolbar lineWidth is changed, update any selected shapes
    setLineWidth: function(lineWidth) {
        this.set('lineWidth', lineWidth);
        var sel = this.shapeList.getSelected();
        sel.forEach(function(m){
            m.set('stroke-width', lineWidth);
        });
    },

    setZoom: function(zoom) {
        console.log("setZoom", zoom);
        this.set('zoom', zoom);
        this.shapeList.forEach(function(m){
            console.log('shape.set(zoom)');
            m.set('zoom', zoom);
        });
    },
});


// Shape Models & List

var Shape = Backbone.Model.extend({

    initialize: function() {
        this.listenTo(this, 'drag_xy_stop', function(args) {
            this.set({'x': args[0] + this.get('x'), 'y': args[1] + this.get('y')});
        });
        this.listenTo(this, 'drag_resize_stop', function(args) {
            this.set({'x': args[0], 'y': args[1], 'width': args[2], 'height': args[3]});
        });
    }
});


var ShapeList = Backbone.Collection.extend({

    model: Shape,

    initialize: function() {
        var self = this;
        this.listenTo(this, 'add', function(model, list, event) {
            this.listenTo(model, 'clicked', function(m){
                self.clearSelected();
                model.set('selected', true);
                self.trigger('selectionChange');
            });
        });
    },

    clearSelected: function() {
        this.forEach(function(m){
            m.set('selected', false);
        });
    },

    getSelected: function() {
        return this.filter(function(panel){
            return panel.get('selected');
        });
    }

});

