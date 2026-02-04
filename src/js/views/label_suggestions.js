import $ from "jquery";
import _ from "underscore";

const LIMIT_SUGGESTIONS = 8;  // Max number of suggestions to show
const SEPARATOR_CHARS = ",\\s;:";  // Characters that separate label segments

/**
 * LabelSuggestions - Manages smart label suggestions based on cursor position and context
 * Provides type-specific options when cursor is inside brackets, general suggestions otherwise
 * Topmost items are listed first, limited to LIMIT_SUGGESTIONS.
 */
const LABEL_DICTIONARY = {
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
    },
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
    "project": {
        label: "Project",
        keywords: ["project", "name", "id"],
        options: [
            { label: "Project ID", value: "[project.id]" },
            { label: "Project Name", value: "[project.name]" }
        ]
    },
    "wellsample": {
        label: "WellSample",
        keywords: ["wellsample", "index", "id"],
        options: [
            { label: "WellSample ID", value: "[wellsample.id]" },
            { label: "WellSample Index", value: "[wellsample.index]" },
            { label: "WellSample Run Index", value: "[wellsample.index_run]" }
        ]
    },
    "well": {
        label: "Well",
        keywords: ["well", "label", "id"],
        options: [
            { label: "Well ID", value: "[well.id]" },
            { label: "Well Name", value: "[well.name]" }
        ]
    },
    "Run": {
        label: "Run",
        keywords: ["run", "acquisition", "plateacquisition", "name", "id"],
        options: [
            { label: "Run ID", value: "[run.id]" },
            { label: "Run Name", value: "[run.name]" }
        ]
    },
    "plate": {
        label: "Plate",
        keywords: ["plate", "name", "id"],
        options: [
            { label: "Plate ID", value: "[plate.id]" },
            { label: "Plate Name", value: "[plate.name]" }
        ]
    },
    "screen": {
        label: "Screen",
        keywords: ["screen", "name", "id"],
        options: [
            { label: "Screen ID", value: "[screen.id]" },
            { label: "Screen Name", value: "[screen.name]" }
        ]
    }
};

export class LabelSuggestions {
    /**
     * Initialize the LabelSuggestions component
     *
     * @param {jQuery} $container - The container element that holds both the input and suggestion menu
     * @param {Object} options - Configuration options
     * @param {boolean} options.have_time - Whether the current data supports time-based labels
     *
     * Sets up references to the input field and dropdown menu, and initializes state for
     * preventing blur events from hiding the menu during suggestion clicks.
     */
    constructor($container, options) {
        this.$container = $container;
        this.have_time = options && options.have_time ? options.have_time : false;
        this.$menu = $container.find('.label-suggestions');
        this.$input = $container.find('.label-text');
        this.preventBlurHide = false;
    }

    /**
     * Get the current label segment where the cursor is positioned
     *
     * Segments are text portions separated by delimiters (comma, newline, semicolon, or colon).
     * This function identifies which segment contains the cursor and returns it along with
     * the text before (prefix) and after (suffix) the segment.
     *
     * @param {string} text - The full text content
     * @param {number} cursorPos - The current cursor position (0-based index)
     * @returns {Object} An object with three properties:
     *   - prefix: Text before the current segment (including delimiter)
     *   - segment: The segment containing the cursor
     *   - suffix: Text after the current segment (including delimiter)
     *
     * Example:
     *   text = "[image.name], [time.index], [tags]"
     *   cursorPos = 20 (inside "time.index")
     *   returns: { prefix: "[image.name], ", segment: "[time.index]", suffix: ", [tags]" }
     */
    getCurrentSegment(text, cursorPos) {
        if (!text) {
            return { prefix: "", segment: "", suffix: "" };
        }

        // Find separators before and after cursor
        var beforeCursor = text.slice(0, cursorPos);
        var afterCursor = text.slice(cursorPos);

        // Find last separator before cursor
        var lastSepBefore = beforeCursor.search(new RegExp("[" + SEPARATOR_CHARS + "](?!.*[" + SEPARATOR_CHARS + "])"));
        var startIdx = lastSepBefore === -1 ? 0 : lastSepBefore + 1;

        // Find first separator after cursor
        var firstSepAfter = afterCursor.search(new RegExp("[" + SEPARATOR_CHARS + "]"));
        var endIdx = firstSepAfter === -1 ? text.length : cursorPos + firstSepAfter;

        return {
            prefix: text.slice(0, startIdx),
            segment: text.slice(startIdx, endIdx),
            suffix: text.slice(endIdx)
        };
    }

    /**
     * Get cursor position relative to the current segment
     *
     * Converts the absolute cursor position in the full text to a relative position
     * within the current segment. This is useful for determining where the cursor is
     * within a specific label segment, independent of the rest of the text.
     *
     * @param {string} fullText - The complete text content
     * @param {number} cursorPos - The absolute cursor position in the full text
     * @returns {number} The cursor position relative to the start of the current segment (0-based)
     *
     * Example:
     *   fullText = "[image.name], [time.index]"
     *   cursorPos = 20 (inside "time.index")
     *   returns: 6 (position within "[time.index]" segment)
     */
    getCursorPositionInSegment(fullText, cursorPos) {
        var parts = this.getCurrentSegment(fullText, cursorPos);
        var prefix = parts.prefix;
        var relativePos = cursorPos - prefix.length;
        return Math.max(0, relativePos);
    }

    /**
     * Check if cursor is inside an unclosed bracket pair [ ]
     *
     * Determines whether the cursor is currently positioned within an open bracket
     * by counting opening '[' and closing ']' brackets before the cursor position.
     * If there are more opening brackets than closing brackets, the cursor is inside.
     *
     * @param {string} segment - The text segment to check
     * @param {number} relativePos - Cursor position within the segment
     * @returns {boolean} True if cursor is inside brackets, false otherwise
     *
     * Example:
     *   segment = "[time.ind|ex]" (| represents cursor)
     *   relativePos = 9
     *   returns: true (cursor is between [ and ])
     */
    isCursorInBrackets(segment, relativePos) {
        var beforeCursor = segment.slice(0, relativePos);
        var openCount = (beforeCursor.match(/\[/g) || []).length - (beforeCursor.match(/\]/g) || []).length;
        return openCount > 0;
    }

    /**
     * Extract the label type from an incomplete or complete bracket expression
     *
     * Parses the content within brackets to identify the base label type.
     * Handles both complete labels like "[time.index]" and incomplete ones like "[time.
     * Ignores semicolon-separated parameters and extracts only the first part before a dot.
     *
     * @param {string} segment - The text segment containing a bracket expression
     * @returns {string|null} The label type (e.g., "time", "image", "channels") or null if not found
     *
     * Examples:
     *   "[time.index]" -> "time"
     *   "[image.name; key=value]" -> "image"
     *   "[channels" -> "channels"
     *   "no brackets" -> null
     */
    getLabelTypeFromBracket(segment) {
        var match = segment.match(/\[([^\];]+)/);
        if (!match) return null;
        var inner = match[1].trim().split(";")[0].trim();
        var prop_nf = inner.split(".");
        return prop_nf[0].toLowerCase();
    }

    /**
     * Find the label type of the last complete label before the cursor
     *
     * Searches backwards from the cursor position to find the most recent complete
     * label enclosed in brackets. This is used to provide context-aware suggestions
     * when the cursor is positioned right after a label.
     *
     * @param {string} segment - The text segment to search
     * @param {number} relativePos - Cursor position within the segment
     * @returns {string|null} The label type of the last complete label, or null if none found
     *
     * Examples:
     *   segment = "[time.index]|some text" (| represents cursor)
     *   relativePos = 12
     *   returns: "time"
     *
     *   segment = "text [image.name] [time|" (| represents cursor)
     *   relativePos = 23
     *   returns: "image" (last complete label before cursor)
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
     *
     * Displays a dropdown menu with all available options for a specific label type.
     * For example, when cursor is in "[time]", shows options like "Index", "Milliseconds", etc.
     * If the label type has no options or doesn't exist, hides the menu.
     *
     * @param {string} labelType - The label type (e.g., "time", "image", "x")
     *
     * Side effects:
     *   - Updates the dropdown menu HTML with type-specific options
     *   - Shows or hides the menu based on availability of options
     *   - Each option is rendered as a clickable button with data-value attribute
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
     * Filter and render general label suggestions based on search query
     *
     * Searches through the label dictionary and displays matching suggestions.
     * Matches are found by checking if the query appears in:
     *   - The label's display name
     *   - The label's keywords
     * Shows all labels if query is empty. Filters out time labels if have_time is false.
     * Limits results to top LIMIT_SUGGESTIONS matches.
     *
     * @param {string} query - The search query (case-insensitive)
     *
     * Side effects:
     *   - Updates the dropdown menu HTML with filtered suggestions
     *   - Shows menu if suggestions exist, hides if none found
     *   - Each suggestion includes data attributes for value, type, and dynamic keys
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

        filtered = filtered.slice(0, LIMIT_SUGGESTIONS);  // Limit to top suggestions
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
     * Main handler for input events - orchestrates suggestion display logic
     *
     * This is the primary entry point called whenever the input changes or cursor moves.
     * It determines what suggestions to show based on cursor context:
     *
     * 1. If cursor is inside brackets (e.g., "[time|]"), shows type-specific options
     * 2. If cursor is right after a complete label (e.g., "[time.index]|"), shows options for that label
     * 3. Otherwise, shows general label suggestions filtered by any partial input
     *
     * The function analyzes the current segment (where cursor is), determines context,
     * and delegates to either renderTypeOptions() or renderSuggestions().
     *
     * Side effects:
     *   - Updates the suggestion menu based on current input and cursor position
     */
    handleInput() {
        var current = this.$input.val();
        var cursorPos = this.$input[0].selectionStart || 0;
        var parts = this.getCurrentSegment(current, cursorPos);
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
     * Handle suggestion click - inserts the selected suggestion into the text
     *
     * Inserts the selected suggestion value into the input field at the appropriate position.
     * Handles two scenarios:
     *
     * 1. Replacement mode: If there's a complete label before the cursor, replaces it with the new value
     *    Example: "[time.index]|" -> click on "[time.mins]" -> "[time.mins]|"
     *
     * 2. Insertion mode: Otherwise, inserts the value at the current cursor position
     *    Example: "hello ta| world" -> click on "[tags]" -> "hello [tags]| world"
     *
     * After insertion, positions the cursor after the inserted value and preserves
     * any text that was after the cursor (suffix).
     *
     * @param {string} value - The suggestion value to insert (e.g., "[time.index]")
     * @param {string} type - Optional type information (for future use)
     * @param {string} key - Optional key for dynamic labels (for future use)
     *
     * Side effects:
     *   - Updates input field value
     *   - Repositions cursor after inserted value
     *   - Triggers input event to refresh suggestions
     *   - Prevents blur from hiding menu during the operation
     */
    handleSuggestionClick(value, type, key) {
        var current = this.$input.val();
        var cursorPos = this.$input[0].selectionStart || 0;
        var parts = this.getCurrentSegment(current, cursorPos);
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
            var next = prefix + beforeLabel + parts.suffix;
            this.$input.val(next);
            // Position cursor after the new label
            var newCursorPos = (prefix + beforeLabel).length;
            this.$input[0].setSelectionRange(newCursorPos, newCursorPos);
        } else {
            // Just append the value
            var next = prefix + value + parts.suffix;
            this.$input.val(next);
            // Position cursor at the end of the inserted value
            var newCursorPos = (prefix + value).length;
            this.$input[0].setSelectionRange(newCursorPos, newCursorPos);
        }

        this.$input.trigger('input').focus();
    }

    /**
     * Hide the suggestions dropdown menu
     *
     * Called when the input loses focus (blur event). Respects the preventBlurHide
     * flag to avoid hiding the menu during suggestion clicks, which would prevent
     * the click from being registered.
     *
     * Side effects:
     *   - Removes 'show' class from menu if not prevented
     *   - Does nothing if preventBlurHide is true
     */
    hide() {
        if (this.preventBlurHide) {
            return;
        }
        this.$menu.removeClass('show');
    }
}

export default LabelSuggestions;
