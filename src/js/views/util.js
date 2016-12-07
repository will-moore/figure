
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

// http://www.sitepoint.com/javascript-json-serialization/
JSON.stringify = JSON.stringify || function (obj) {
    var t = typeof (obj);
    if (t != "object" || obj === null) {
        // simple data type
        if (t == "string") obj = '"'+obj+'"';
        return String(obj);
    }
    else {
        // recurse array or object
        var n, v, json = [], arr = (obj && obj.constructor == Array);
        for (n in obj) {
            v = obj[n]; t = typeof(v);
            if (t == "string") v = '"'+v+'"';
            else if (t == "object" && v !== null) v = JSON.stringify(v);
            json.push((arr ? "" : '"' + n + '":') + String(v));
        }
        return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
    }
};


var figureConfirmDialog = function(title, message, buttons, callback) {
    var $confirmModal = $("#confirmModal"),
        $title = $(".modal-title", $confirmModal),
        $body = $(".modal-body", $confirmModal),
        $footer = $(".modal-footer", $confirmModal),
        $btn = $(".btn:first", $footer);

    // Update modal with params
    $title.html(title);
    $body.html('<p>' + message + '<p>');
    $footer.empty();
    _.each(buttons, function(txt){
        $btn.clone().text(txt).appendTo($footer);
    });
    $(".btn", $footer).removeClass('btn-primary')
        .addClass('btn-default')
        .last()
        .removeClass('btn-default')
        .addClass('btn-primary');

    // show modal
    $confirmModal.modal('show');

    // default handler for 'cancel' or 'close'
    $confirmModal.one('hide.bs.modal', function() {
        // remove the other 'one' handler below
        $("#confirmModal .modal-footer .btn").off('click');
        if (callback) {
            callback();
        }
    });

    // handle 'Save' btn click.
    $("#confirmModal .modal-footer .btn").one('click', function(event) {
        // remove the default 'one' handler above
        $confirmModal.off('hide.bs.modal');
        var btnText = $(event.target).text();
        if (callback) {
            callback(btnText);
        }
    });
};


$(function(){


    $(".draggable-dialog").draggable();

    $('#previewInfoTabs a').click(function (e) {
        e.preventDefault();
        $(this).tab('show');
    });


    // Header button tooltips
    $('.btn-sm').tooltip({container: 'body', placement:'bottom', toggle:"tooltip"});
    // Footer button tooltips
    $('.btn-xs').tooltip({container: 'body', placement:'top', toggle:"tooltip"});


    // If we're on Windows, update tool-tips for keyboard short cuts:
    if (navigator.platform.toUpperCase().indexOf('WIN') > -1) {
        $('.btn-sm').each(function(){
            var $this = $(this),
                tooltip = $this.attr('data-original-title');
            if ($this.attr('data-original-title')) {
                $this.attr('data-original-title', tooltip.replace("⌘", "Ctrl+"));
            }
        });
        // refresh tooltips
        $('.btn-sm, .navbar-header').tooltip({container: 'body', placement:'bottom', toggle:"tooltip"});

        // Also update text in dropdown menus
        $("ul.dropdown-menu li a").each(function(){
            var $this = $(this);
                $this.text($this.text().replace("⌘", "Ctrl+"));
        });
    }

});