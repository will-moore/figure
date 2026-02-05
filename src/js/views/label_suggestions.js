import $ from "jquery";
import _ from "underscore";

const LIMIT_SUGGESTIONS = 16;  // Max number of suggestions to show
const SEPARATOR_CHARS = ", ;:";  // Characters that separate label segments

/**
 * LabelSuggestions - Manages smart label suggestions based on cursor position and context
 * Provides type-specific options when cursor is inside brackets, general suggestions otherwise
 * Topmost items are listed first, limited to LIMIT_SUGGESTIONS.
 */
const LABEL_DICTIONARY = {
    "channels": {
        label: "Channels",
        keywords: ["labels", "separate", "single"],
        options: [
            { label: "Single label", value: "[channels]", hint: "All active channel labels together in one line" },
            { label: "Separate labels", value: "[channels labels]", hint: "Must be added on its own. Will generate one label per active channel." }
        ],
        hint: "Shows the name of the active channels."
    },
    "tags": {
        label: "Tags",
        keywords: [],
        options: [
            { label: "Tags", value: "[tags]" }
        ]
    },
    "key-values": {
        label: "Key-Value Pairs",
        keywords: ["kv", "map", "annotation"],
        options: [
            { label: "Key-Value pairs", value: "[key-values]" }
        ]
    },
    "time": {
        label: "Time",
        keywords: ["t", "timestamp"],
        options: [
            { label: "Index", value: "[time.index]" },
            { label: "Milliseconds", value: "[time.ms]" },
            { label: "Seconds", value: "[time.s]" },
            { label: "Minutes", value: "[time.m]" },
            { label: "min:sec", value: "[time.m:s]" },
            { label: "hrs:min", value: "[time.h:m]" },
            { label: "hrs:min:sec", value: "[time.h:m:s]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
            { key: "offset", default: "0" }
        ]
    },
    "x": {
        label: "X Coordinate",
        keywords: ["position", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[x.pixel]" },
            { label: "Unit", value: "[x.unit]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
        ]
    },
    "y": {
        label: "Y Coordinate",
        keywords: ["position", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[y.pixel]" },
            { label: "Unit", value: "[y.unit]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
        ]
    },
    "width": {
        label: "Width",
        keywords: ["length", "size", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[width.pixel]" },
            { label: "Unit", value: "[width.unit]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
        ]
    },
    "height": {
        label: "Height",
        keywords: ["length", "size", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[height.pixel]" },
            { label: "Unit", value: "[height.unit]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
        ]
    },
    "z": {
        label: "Z Coordinate",
        keywords: ["stack", "slice", "pixel", "unit"],
        options: [
            { label: "Pixel", value: "[z.pixel]" },
            { label: "Unit", value: "[z.unit]" }
        ],
        extraOptions: [
            { key: "precision", default: "2" },
        ]
    },
    "zoom": {
        label: "Zoom level (%)",
        keywords: ["scale", "percent"],
        options: [
            { label: "Zoom level", value: "[zoom]" }
        ]
    },
    "image": {
        label: "Image",
        keywords: ["name", "id", "filename"],
        options: [
            { label: "Image ID", value: "[image.id]" },
            { label: "Image Name", value: "[image.name]" }
        ]
    },
    "dataset": {
        label: "Dataset",
        keywords: ["name", "id"],
        options: [
            { label: "Dataset ID", value: "[dataset.id]" },
            { label: "Dataset Name", value: "[dataset.name]" }
        ]
    },
    "project": {
        label: "Project",
        keywords: ["name", "id"],
        options: [
            { label: "Project ID", value: "[project.id]" },
            { label: "Project Name", value: "[project.name]" }
        ]
    },
    "wellsample": {
        label: "WellSample",
        keywords: ["index", "id"],
        options: [
            { label: "WellSample ID", value: "[wellsample.id]" },
            { label: "WellSample Index", value: "[wellsample.index]" },
            { label: "WellSample Run Index", value: "[wellsample.index_run]" }
        ]
    },
    "well": {
        label: "Well",
        keywords: ["label", "id", "name"],
        options: [
            { label: "Well ID", value: "[well.id]" },
            { label: "Well Label", value: "[well.label]" }
        ]
    },
    "run": {
        label: "Run",
        keywords: ["plateacquisition", "name", "id"],
        options: [
            { label: "Run ID", value: "[run.id]" },
            { label: "Run Name", value: "[run.name]" }
        ]
    },
    "plate": {
        label: "Plate",
        keywords: ["name", "id"],
        options: [
            { label: "Plate ID", value: "[plate.id]" },
            { label: "Plate Name", value: "[plate.name]" }
        ]
    },
    "screen": {
        label: "Screen",
        keywords: ["name", "id"],
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
     *
     * Sets up references to the input field and dropdown menu, and initializes state for
     * preventing blur events from hiding the menu during suggestion clicks.
     */
    constructor($container) {
        this.$container = $container;
        this.have_time = false;
        this.parents_flags = {
            project: false,
            dataset: false,
            screen: false,
            plate: false
        };
        this.$menu = $container.find('.label-suggestions');
        this.$input = $container.find('.label-text');
        this.preventBlurHide = false;
        // Cached state about the current input cursor/segment to avoid
        // re-parsing when handling suggestion clicks.
        this._cursorState = null;
    }

    /**
     * Get the current label segment where the cursor is positioned
     *
     * Segments are text portions separated by delimiters (defined in SEPARATOR_CHARS).
     * Delimiters inside bracket expressions are ignored so that options like
     * "[time.secs; precision=2; offset=3]" remain a single segment.
     *
     * If the cursor is inside a bracket expression or right after one, extracts that
     * bracket as the segment. Otherwise, returns the full segment containing the cursor.
     *
     * @param {string} text - The full text content
     * @param {number} cursorPos - The current cursor position (0-based index)
     * @returns {Object} An object with:
     *   - prefix: Text before the segment (including delimiter)
     *   - segment: The segment containing the cursor (bracket expr or plain text)
     *   - suffix: Text after the segment (including delimiter)
     *   - hasBracket: Boolean flag - true if segment is a bracket expression, false otherwise
     *
     * Examples:
     *   text = "[image.name], [time.secs|], [tags]", cursorPos = 20 (inside time.secs)
     *   returns: { prefix: "[image.name], ", segment: "[time.secs]", suffix: ", [tags]", hasBracket: true }
     *
     *   text = "hello| world", cursorPos = 5
     *   returns: { prefix: "", segment: "hello world", suffix: "", hasBracket: false }
     */
    getCurrentSegment(text, cursorPos) {
        if (!text) {
            return { prefix: "", segment: "", suffix: "", hasBracket: false };
        }

        var safeCursorPos = Math.min(Math.max(cursorPos, 0), text.length);
        var isSeparator = function(ch) {
            return SEPARATOR_CHARS.indexOf(ch) !== -1;
        };

        // Find last separator before cursor, ignoring separators inside brackets
        var lastSepBefore = -1;
        var depth = 0;
        for (var i = 0; i < safeCursorPos; i++) {
            var ch = text[i];
            if (ch === "[") {
                depth += 1;
            } else if (ch === "]" && depth > 0) {
                depth -= 1;
            }
            if (depth === 0 && isSeparator(ch)) {
                lastSepBefore = i;
            }
        }
        var segmentStart = lastSepBefore === -1 ? 0 : lastSepBefore + 1;

        // Find first separator after cursor, ignoring separators inside brackets
        var nextSepAfter = -1;
        var depthAfter = depth;
        for (var j = safeCursorPos; j < text.length; j++) {
            var nextCh = text[j];
            if (nextCh === "[") {
                depthAfter += 1;
            } else if (nextCh === "]" && depthAfter > 0) {
                depthAfter -= 1;
            }
            if (depthAfter === 0 && isSeparator(nextCh)) {
                nextSepAfter = j;
                break;
            }
        }
        var segmentEnd = nextSepAfter === -1 ? text.length : nextSepAfter;

        var fullSegment = text.slice(segmentStart, segmentEnd);
        var relativePos = safeCursorPos - segmentStart;


        if (relativePos > 0 && fullSegment[relativePos - 1] === "]") {
            relativePos -= 1;  // Count as it could be inside bracket
        }

        // Check if cursor is inside a bracket expression
        var beforeCursor = fullSegment.slice(0, relativePos);
        var afterCursor = fullSegment.slice(relativePos);
        var openIdx = beforeCursor.lastIndexOf('[');
        var closeIdx = afterCursor.indexOf(']');
        if (openIdx !== -1 && closeIdx !== -1) {
            var bracketExpr = fullSegment.slice(openIdx, relativePos + closeIdx + 1);
            var suffixPart = fullSegment.slice(relativePos + closeIdx + 1);
            return {
                prefix: text.slice(0, segmentStart + openIdx),
                segment: bracketExpr,
                suffix: suffixPart + text.slice(segmentEnd),
                hasBracket: true
            };
        } else if (openIdx !== -1 && closeIdx === -1) {
            // Cursor is inside an unclosed bracket - extract from opening bracket onwards
            var partialSegment = fullSegment.slice(openIdx);
            return {
                prefix: text.slice(0, segmentStart + openIdx),
                segment: partialSegment,
                suffix: text.slice(segmentEnd),
                hasBracket: false
            };
        } else {
            return {
                prefix: text.slice(0, segmentStart),
                segment: fullSegment,
                suffix: text.slice(segmentEnd),
                hasBracket: false
            };
        }
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
    getLabelTypeFromBracket(segment) {  // LIKELY SHOULD BE KEPT
        var match = segment.match(/\[([^\];]+)/);
        if (!match) return null;
        var inner = match[1].trim().split(";")[0].trim();
        var prop_nf = inner.split(".");
        return prop_nf[0].toLowerCase();
    }

    /**
     * Parse a bracket expression into its components
     *
     * Extracts the base label and any semicolon-separated options from a bracket expression.
     * Options are parsed as key=value pairs and stored in a map.
     *
     * @param {string} segment - The text segment containing a bracket expression
     * @returns {Object} An object with:
     *   - base: The base label (e.g., "time.secs")
     *   - options: A map of option keys to values (e.g., {precision: "2", offset: "0"})
     *   - raw: The original segment text
     *
     * Examples:
     *   "[time.secs]" -> { base: "time.secs", options: {}, raw: "[time.secs]" }
     *   "[time.secs; precision=2; offset=3]" -> { base: "time.secs", options: {precision: "2", offset: "3"}, raw: "[time.secs; precision=2; offset=3]" }
     */
    parseBracketExpr(segment) {
        var match = segment.match(/\[([^\]]+)\]/);
        if (!match) {
            return { base: "", options: {}, raw: segment };
        }

        var inner = match[1].trim();
        var parts = inner.split(";").map(function(p) { return p.trim(); });
        var base = parts[0];
        var options = {};

        for (var i = 1; i < parts.length; i++) {
            var keyValue = parts[i].split("=");
            if (keyValue.length === 2) {
                var key = keyValue[0].trim();
                var value = keyValue[1].trim();
                options[key] = value;
            }
        }

        return { base: base, options: options, raw: segment };
    }

    /**
     * Build a bracket expression from base label and options
     *
     * Constructs a bracket expression string by combining the base label with
     * semicolon-separated key=value options.
     *
     * @param {string} base - The base label (e.g., "time.milliseconds")
     * @param {Object} options - A map of option keys to values
     * @returns {string} The complete bracket expression
     *
     * Examples:
     *   ("time.secs", {}) -> "[time.secs]"
     *   ("time.secs", {precision: "2", offset: "3"}) -> "[time.secs; precision=2; offset=3]"
     */
    buildBracketExpr(base, options) {
        var expr = "[" + base;
        for (var key in options) {
            if (options.hasOwnProperty(key)) {
                expr += "; " + key + "=" + options[key];
            }
        }
        expr += "]";
        return expr;
    }

    /**
     * Merge a new option into an existing options map
     *
     * Adds or updates an option key-value pair. If the key already exists,
     * it is not overwritten (to avoid duplicates).
     *
     * @param {Object} options - Existing options map
     * @param {string} key - The option key to add
     * @param {string} value - The option value to add
     * @returns {Object} The updated options map
     */
    mergeOption(options, key, value) {
        if (!options.hasOwnProperty(key)) {
            options[key] = value;
        }
        return options;
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
    renderTypeOptions(labelType, currentSegment) {
        var entry = LABEL_DICTIONARY[labelType];
        if (!entry || !entry.options) {
            this.$menu.removeClass('show').empty();
            return;
        }

        var html = "<div class='dropdown-header'>Options for " + _.escape(entry.label) + "</div>";
        html += entry.options.map(function(opt) {
            var hint = opt.hint || "";
            return "<button type='button' class='dropdown-item' data-value='" + _.escape(opt.value) + "' title='" + _.escape(hint) + "'>" + _.escape(opt.label) + "</button>";
        }).join("");

        // Add extra options if available
        if (entry.extraOptions && entry.extraOptions.length > 0) {
            // Parse current segment to check which options are already present
            var parsed = currentSegment ? this.parseBracketExpr(currentSegment) : { options: {} };
            var existingOptions = parsed.options;

            html += "<div class='dropdown-divider'></div>";
            html += "<div class='dropdown-header'>Extra Options</div>";
            var self = this;
            html += entry.extraOptions.map(function(extraOpt) {
                var optLabel = extraOpt.key + "=" + extraOpt.default;
                var alreadyAdded = existingOptions.hasOwnProperty(extraOpt.key);
                var disabled = alreadyAdded ? " disabled" : "";
                var title = alreadyAdded ? " title='Already added'" : "";
                return "<button type='button' class='dropdown-item'" + disabled + title + " data-extra-option='" + _.escape(extraOpt.key) + "' data-default-value='" + _.escape(extraOpt.default) + "'>" + _.escape(optLabel) + "</button>";
            }).join("");
        }

        this.$menu.html(html).addClass('show');
    }

    /**
     * Filter and render general label suggestions based on search query
     *
     * Searches through the label dictionary and displays matching suggestions.
     * Matches are found by checking if the query appears in:
     *   - The label's display name
     *   - The label's keywords
     * Shows all labels if query is empty.
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

                // Filters out labels
                if (key === "time" && !this.have_time) continue;
                if (key === "project" && !this.parents_flags.project) continue;
                if (key === "dataset" && !this.parents_flags.dataset) continue;
                if (key === "screen" && !this.parents_flags.screen) continue;
                if (["plate", "well", "wellsample", "run"].includes(key) && !this.parents_flags.plate) continue;

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

        // TODO Add dynamic key-value pair suggestion
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
            var hint = entry.hint || "";
            var dataAttrs = "";

            return "<button type='button' class='dropdown-item'" + dataAttrs + " data-value='" + _.escape(value) + "' title='" + _.escape(hint) + "'>" + _.escape(entry.label) + "</button>";
        }).join("");

        this.$menu.html(html).addClass('show');
    }

    /**
     * Main handler for input events - orchestrates suggestion display logic
     *
     * This is the primary entry point called whenever the input changes or cursor moves.
     * It determines what suggestions to show based on cursor context:
     *
     * 1. If cursor is inside brackets (e.g., "[time|]") or right after (e.g., "[time.index]|"), shows type-specific options
     * 2. Otherwise, shows general label suggestions filtered by any partial input
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

        // Cache the cursor/segment state so click handlers can reuse it
        this._cursorState = {
            current: current,
            cursorPos: cursorPos,
            parts: parts
        };

        // If the cursor is inside brackets, suggest options for that label type
        if (parts.hasBracket) {
            var labelType = this.getLabelTypeFromBracket(parts.segment);
            if (labelType && LABEL_DICTIONARY[labelType]) {
                this.renderTypeOptions(labelType, parts.segment);
                return;
            }
        }

        // Otherwise, show general suggestions
        var cleaned = parts.segment.replace(/^\[/, "").replace(/\]/, "");
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
     *
     * Side effects:
     *   - Updates input field value
     *   - Repositions cursor after inserted value
     *   - Triggers input event to refresh suggestions
     *   - Prevents blur from hiding menu during the operation
     */
    handleSuggestionClick(value, extraOption, defaultValue) {
        var current = this.$input.val();
        var cursorPos = this.$input[0].selectionStart || 0;

        // Prevent blur from hiding the menu
        this.preventBlurHide = true;
        var self = this;
        setTimeout(function() {
            self.preventBlurHide = false;
        }, 200);

        // Reuse cached cursor state if it matches the current input/caret,
        // otherwise fall back to recomputing the segment/bracket info from getCurrentSegment.
        var state = (this._cursorState && this._cursorState.current === current && this._cursorState.cursorPos === cursorPos) ? this._cursorState : null;
        var parts = state ? state.parts : this.getCurrentSegment(current, cursorPos);
        var startPos = parts.prefix.length;
        var endPos = startPos + parts.segment.length;
        var existingParsed = (parts.hasBracket && parts.segment) ? this.parseBracketExpr(parts.segment) : null;

        var finalValue;
        var newText;
        var newCursorPos;

        if (extraOption) {
            // Adding an extra option to existing bracket
            if (parts.segment) {
                this.mergeOption(existingParsed.options, extraOption, defaultValue);
                finalValue = this.buildBracketExpr(existingParsed.base, existingParsed.options);

                newText = current.slice(0, startPos) + finalValue + current.slice(endPos);
                newCursorPos = startPos + finalValue.length;
            }
        } else if (parts.hasBracket && parts.segment) {
            // Replacing existing bracket expression with new value, preserving options
            var newParsed = this.parseBracketExpr(value);
            finalValue = this.buildBracketExpr(newParsed.base, existingParsed.options);

            newText = current.slice(0, startPos) + finalValue + current.slice(endPos);
            newCursorPos = startPos + finalValue.length;
        } else {
            // No bracket at cursor - insert new value at cursor position
            finalValue = value;
            newText = parts.prefix + finalValue + parts.suffix;
            newCursorPos = parts.prefix.length + finalValue.length;
        }

        this.$input.val(newText);
        this.$input[0].setSelectionRange(newCursorPos, newCursorPos);
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
