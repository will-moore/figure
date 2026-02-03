import $ from "jquery";
import _ from "underscore";

/**
 * LabelSuggestions - Manages smart label suggestions based on cursor position and context
 * Provides type-specific options when cursor is inside brackets, general suggestions otherwise
 */

const LABEL_DICTIONARY = {
    "image": {
        label: "Image",
        keywords: ["image", "name", "id", "filename"],
        options: [
            { label: "Image ID", value: "[image.id]" },
            { label: "Image Name", value: "[image.name]" }
        ]
    },
    "dataset": {
        label: "Dataset",
        keywords: ["dataset", "name", "id"],
        options: [
            { label: "Dataset ID", value: "[dataset.id]" },
            { label: "Dataset Name", value: "[dataset.name]" }
        ]
    },
    "channels": {
        label: "Channels",
        keywords: ["channels", "labels", "separate", "single"],
        options: [
            { label: "Single label", value: "[channels]" },
            { label: "Separate labels", value: "[channels labels]" }
        ]
    },
    "tags": {
        label: "Tags",
        keywords: ["tags"],
        value: "[tags]"
    },
    /*"key-values": {
        label: "Key-Value Pairs",
        keywords: ["key", "value", "kv", "map", "annotation"],
        value: "[key-values]",
        type: "key-values"
    },*/
    "time": {
        label: "Time",
        keywords: ["time", "t", "timestamp"],
        type: "time",
        options: [
            { label: "Index", value: "[time.index]" },
            { label: "Milliseconds", value: "[time.milliseconds]" },
            { label: "Seconds", value: "[time.secs]" },
            { label: "Minutes", value: "[time.mins]" },
            { label: "m:s", value: "[time.mins:secs]" },
            { label: "h:m", value: "[time.hrs:mins]" },
            { label: "h:m:s", value: "[time.hrs:mins:secs]" }
        ]
    },
    "x": {
        label: "X Coordinate",
        keywords: ["x", "position", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[x.pixel]" },
            { label: "Unit", value: "[x.unit]" }
        ]
    },
    "y": {
        label: "Y Coordinate",
        keywords: ["y", "position", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[y.pixel]" },
            { label: "Unit", value: "[y.unit]" }
        ]
    },
    "z": {
        label: "Z Coordinate",
        keywords: ["z", "stack", "slice", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[z.pixel]" },
            { label: "Unit", value: "[z.unit]" }
        ]
    },
    "zoom": {
        label: "Zoom level (%)",
        keywords: ["zoom", "scale", "percent"],
        value: "[zoom]"
    }
};

export class LabelSuggestions {
    constructor($container, options) {
        this.$container = $container;
        this.have_time = options && options.have_time ? options.have_time : false;
        this.$menu = $container.find('.label-suggestions');
        this.$input = $container.find('.label-text');
        this.preventBlurHide = false;
    }

    /**
     * Get the last label segment separated by comma or newline
     */
    getLastSegment(text) {
        var match = text.match(/[,\s;:](?!.*[,\s;:])/);
        if (!match) {
            return { prefix: "", segment: text };
        }
        var idx = match.index;
        return { prefix: text.slice(0, idx + 1), segment: text.slice(idx + 1) };
    }

    /**
     * Get cursor position relative to the current segment
     */
    getCursorPositionInSegment(fullText, cursorPos) {
        var parts = this.getLastSegment(fullText);
        var prefix = parts.prefix;
        var relativePos = cursorPos - prefix.length;
        return Math.max(0, relativePos);
    }

    /**
     * Check if cursor is inside brackets [ ]
     */
    isCursorInBrackets(segment, relativePos) {
        var beforeCursor = segment.slice(0, relativePos);
        var openCount = (beforeCursor.match(/\[/g) || []).length - (beforeCursor.match(/\]/g) || []).length;
        return openCount > 0;
    }

    /**
     * Extract the label type from inside brackets
     * e.g., "[time.index]" -> "time"
     */
    getLabelTypeFromBracket(segment) {
        var match = segment.match(/\[([^\];]+)/);
        if (!match) return null;
        var inner = match[1].trim().split(";")[0].trim();
        var prop_nf = inner.split(".");
        return prop_nf[0].toLowerCase();
    }

    /**
     * Find the label right before the cursor position
     * e.g., "[time.index]|" -> "time"
     */
    getLabelTypeBeforeCursor(segment, relativePos) {
        // Look backwards from cursor to find the last complete label
        var beforeCursor = segment.slice(0, relativePos);
        // Match the last complete label [xxx]
        var matches = beforeCursor.match(/\[([^\]]+)\](?=[^\[]*$)/);
        if (!matches) return null;
        var inner = matches[1].trim().split(";")[0].trim();
        var prop_nf = inner.split(".");
        return prop_nf[0].toLowerCase();
    }

    /**
     * Render type-specific options for a label type
     */
    renderTypeOptions(labelType) {
        var entry = LABEL_DICTIONARY[labelType];
        if (!entry || !entry.options) {
            this.$menu.removeClass('show').empty();
            return;
        }

        var html = "<div class='dropdown-header'>Options for " + _.escape(entry.label) + "</div>";
        html += entry.options.map(function(opt) {
            return "<button type='button' class='dropdown-item' data-value='" + _.escape(opt.value) + "'>" + _.escape(opt.label) + "</button>";
        }).join("");

        this.$menu.html(html).addClass('show');
    }

    /**
     * Filter and render general label suggestions
     */
    renderSuggestions(query) {
        var lower = query.toLowerCase();
        var filtered = [];

        // Filter dictionary entries
        for (var key in LABEL_DICTIONARY) {
            if (LABEL_DICTIONARY.hasOwnProperty(key)) {
                var entry = LABEL_DICTIONARY[key];

                // Filter out time if no time data
                if (key === "time" && !this.have_time) continue;

                // Match by label, value, or keywords
                if (!lower) {
                    filtered.push({ key: key, entry: entry });
                } else if (entry.label.toLowerCase().includes(lower)) {
                    filtered.push({ key: key, entry: entry });
                } else if ((entry.keywords || []).some(function(k) { return k.includes(lower); })) {
                    filtered.push({ key: key, entry: entry });
                }
            }
        }

        // Add dynamic key-value pair suggestion
        /*
        var dynamic = null;
        if (lower && lower.length > 1) {
            dynamic = {
                key: "key-values-dynamic",
                entry: {
                    label: "Key-Value Pair: " + query,
                    dynamicKey: query,
                    value: "[key-values; key=" + query + "]",
                    type: "key-values"
                }
            };
            filtered = [dynamic].concat(filtered);
        }*/

        filtered = filtered.slice(0, 8);  // Limit to top 8 suggestions
        if (filtered.length === 0) {
            this.$menu.removeClass('show').empty();
            return;
        }

        var html = "<div class='dropdown-header'>Suggestions</div>";
        html += filtered.map(function(item) {
            var entry = item.entry;
            var value = entry.value || "[" + item.key + "]";
            var dataAttrs = "";

            if (entry.type) {
                dataAttrs += " data-type='" + entry.type + "'";
            }
            if (entry.dynamicKey) {
                dataAttrs += " data-key='" + _.escape(entry.dynamicKey) + "'";
            }

            return "<button type='button' class='dropdown-item'" + dataAttrs + " data-value='" + _.escape(value) + "'>" + _.escape(entry.label) + "</button>";
        }).join("");

        this.$menu.html(html).addClass('show');
    }

    /**
     * Main handler for input events
     */
    handleInput() {
        var current = this.$input.val();
        var cursorPos = this.$input[0].selectionStart || 0;
        var parts = this.getLastSegment(current);
        var segment = parts.segment.trim();
        var relativePos = this.getCursorPositionInSegment(current, cursorPos);

        // Check if cursor is inside brackets
        if (this.isCursorInBrackets(segment, relativePos)) {
            var labelType = this.getLabelTypeFromBracket(segment);
            if (labelType && LABEL_DICTIONARY[labelType]) {
                this.renderTypeOptions(labelType);
                return;
            }
        }

        // Check if there's a complete label right before cursor
        var labelBeforeCursor = this.getLabelTypeBeforeCursor(segment, relativePos);
        if (labelBeforeCursor && LABEL_DICTIONARY[labelBeforeCursor] && LABEL_DICTIONARY[labelBeforeCursor].options) {
            this.renderTypeOptions(labelBeforeCursor);
            return;
        }

        // Otherwise, show general suggestions
        var cleaned = segment.replace(/^\[/, "").replace(/\]$/, "");
        this.renderSuggestions(cleaned);
    }

    /**
     * Handle suggestion click
     */
    handleSuggestionClick(value, type, key) {
        var current = this.$input.val();
        var cursorPos = this.$input[0].selectionStart || 0;
        var parts = this.getLastSegment(current);
        var prefix = parts.prefix;
        var segment = parts.segment.trim();
        var relativePos = this.getCursorPositionInSegment(current, cursorPos);

        // Prevent blur from hiding the menu
        this.preventBlurHide = true;
        var self = this;
        setTimeout(function() {
            self.preventBlurHide = false;
        }, 200);

        // Check if we're replacing a label that's right before cursor
        var labelBeforeCursor = this.getLabelTypeBeforeCursor(segment, relativePos);
        if (labelBeforeCursor) {
            // Replace the last complete label with the new value
            var beforeLabel = segment.replace(/\[[^\]]+\](?=[^\[]*$)/, value);
            var next = prefix + beforeLabel;
            this.$input.val(next);
            // Position cursor after the new label
            var newCursorPos = next.length;
            this.$input[0].setSelectionRange(newCursorPos, newCursorPos);
        } else {
            // Just append the value
            var next = prefix + value;
            this.$input.val(next);
            // Position cursor at the end
            this.$input[0].setSelectionRange(next.length, next.length);
        }

        this.$input.trigger('input').focus();
    }

    /**
     * Hide suggestions
     */
    hide() {
        if (this.preventBlurHide) {
            return;
        }
        this.$menu.removeClass('show');
    }
}

export default LabelSuggestions;
