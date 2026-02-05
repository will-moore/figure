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
        this.prevent_blur_hide = false;
        // Cached state about the current input cursor/segment to avoid
        // re-parsing when handling suggestion clicks.
        this._cursor_state = null;
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
     * @param {number} cursor_pos - The current cursor position (0-based index)
     * @returns {Object} An object with:
     *   - prefix: Text before the segment (including delimiter)
     *   - segment: The segment containing the cursor (bracket expr or plain text)
     *   - suffix: Text after the segment (including delimiter)
     *   - hasBracket: Boolean flag - true if segment is a bracket expression, false otherwise
     *
     * Examples:
     *   text = "[image.name], [time.secs|], [tags]", cursor_pos = 20 (inside time.secs)
     *   returns: { prefix: "[image.name], ", segment: "[time.secs]", suffix: ", [tags]", hasBracket: true }
     *
     *   text = "hello| world", cursor_pos = 5
     *   returns: { prefix: "", segment: "hello world", suffix: "", hasBracket: false }
     */
    get_current_segment(text, cursor_pos) {
        if (!text) {
            return { prefix: "", segment: "", suffix: "", hasBracket: false };
        }

        var safe_cursor_pos = Math.min(Math.max(cursor_pos, 0), text.length);
        var is_separator = function(ch) {
            return SEPARATOR_CHARS.indexOf(ch) !== -1;
        };

        // Find last separator before cursor, ignoring separators inside brackets
        var last_sep_before = -1;
        var depth = 0;
        for (var i = 0; i < safe_cursor_pos; i++) {
            var ch = text[i];
            if (ch === "[") {
                depth += 1;
            } else if (ch === "]" && depth > 0) {
                depth -= 1;
            }
            if (depth === 0 && is_separator(ch)) {
                last_sep_before = i;
            }
        }
        var segment_start = last_sep_before === -1 ? 0 : last_sep_before + 1;

        // Find first separator after cursor, ignoring separators inside brackets
        var next_sep_after = -1;
        var depth_after = depth;
        for (var j = safe_cursor_pos; j < text.length; j++) {
            var next_ch = text[j];
            if (next_ch === "[") {
                depth_after += 1;
            } else if (next_ch === "]" && depth_after > 0) {
                depth_after -= 1;
            }
            if (depth_after === 0 && is_separator(next_ch)) {
                next_sep_after = j;
                break;
            }
        }
        var segment_end = next_sep_after === -1 ? text.length : next_sep_after;

        var full_segment = text.slice(segment_start, segment_end);
        var relative_pos = safe_cursor_pos - segment_start;


        if (relative_pos > 0 && full_segment[relative_pos - 1] === "]") {
            relative_pos -= 1;  // Count as it could be inside bracket
        }

        // Check if cursor is inside a bracket expression
        var before_cursor = full_segment.slice(0, relative_pos);
        var after_cursor = full_segment.slice(relative_pos);
        var open_idx = before_cursor.lastIndexOf('[');
        var close_idx = after_cursor.indexOf(']');
        if (open_idx !== -1 && close_idx !== -1) {
            var bracket_expr = full_segment.slice(open_idx, relative_pos + close_idx + 1);
            var suffix_part = full_segment.slice(relative_pos + close_idx + 1);
            return {
                prefix: text.slice(0, segment_start + open_idx),
                segment: bracket_expr,
                suffix: suffix_part + text.slice(segment_end),
                hasBracket: true
            };
        } else if (open_idx !== -1 && close_idx === -1) {
            // Cursor is inside an unclosed bracket - extract from opening bracket onwards
            var partial_segment = full_segment.slice(open_idx);
            return {
                prefix: text.slice(0, segment_start + open_idx),
                segment: partial_segment,
                suffix: text.slice(segment_end),
                hasBracket: false
            };
        } else {
            return {
                prefix: text.slice(0, segment_start),
                segment: full_segment,
                suffix: text.slice(segment_end),
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
    get_label_type(segment) {  // LIKELY SHOULD BE KEPT
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
     *
     * Examples:
     *   "[time.secs]" -> { base: "time.secs", options: {} }
     *   "[time.secs; precision=2; offset=3]" -> { base: "time.secs", options: {precision: "2", offset: "3"} }
     */
    parse_bracket_expr(segment) {
        var match = segment.match(/\[([^\]]+)\]/);
        if (!match) {
            return { base: "", options: {}, raw: segment };
        }

        var inner = match[1].trim();
        var parts = inner.split(";").map(function(p) { return p.trim(); });
        var base = parts[0];
        var options = {};

        for (var i = 1; i < parts.length; i++) {
            var key_value = parts[i].split("=");
            if (key_value.length === 2) {
                var key = key_value[0].trim();
                var value = key_value[1].trim();
                options[key] = value;
            }
        }

        return { base: base, options: options };
    }

    /**
     * Render type-specific options for a label type
     *
     * Displays a dropdown menu with all available options for a specific label type.
     * For example, when cursor is in "[time]", shows options like "Index", "Milliseconds", etc.
     * If the label type has no options or doesn't exist, hides the menu.
     */
    render_type_options(label_type, current_segment) {
        var entry = LABEL_DICTIONARY[label_type];
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
            var parsed = current_segment ? this.parse_bracket_expr(current_segment) : { options: {} };
            var existing_options = parsed.options;

            html += "<div class='dropdown-divider'></div>";
            html += "<div class='dropdown-header'>Extra Options</div>";
            var self = this;
            html += entry.extraOptions.map(function(extra_opt) {
                var opt_label = extra_opt.key + "=" + extra_opt.default;
                var already_added = existing_options.hasOwnProperty(extra_opt.key);
                var disabled = already_added ? " disabled" : "";
                var title = already_added ? " title='Already added'" : "";
                return "<button type='button' class='dropdown-item'" + disabled + title + " data-extra-option='" + _.escape(extra_opt.key) + "' data-default-value='" + _.escape(extra_opt.default) + "'>" + _.escape(opt_label) + "</button>";
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
     */
    render_suggestions(query) {
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
            var data_attrs = "";

            return "<button type='button' class='dropdown-item'" + data_attrs + " data-value='" + _.escape(value) + "' title='" + _.escape(hint) + "'>" + _.escape(entry.label) + "</button>";
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
     */
    handle_input() {
        var current = this.$input.val();
        var cursor_pos = this.$input[0].selectionStart || 0;
        var parts = this.get_current_segment(current, cursor_pos);

        // Cache the cursor/segment state so click handlers can reuse it
        this._cursor_state = {
            current: current,
            cursor_pos: cursor_pos,
            parts: parts
        };

        // If the cursor is inside brackets, suggest options for that label type
        if (parts.hasBracket) {
            var label_type = this.get_label_type(parts.segment);
            if (label_type && LABEL_DICTIONARY[label_type]) {
                this.render_type_options(label_type, parts.segment);
                return;
            }
        }

        // Otherwise, show general suggestions
        var cleaned = parts.segment.replace(/^\[/, "").replace(/\]/, "");
        this.render_suggestions(cleaned);
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
    build_bracket_expr(base, options) {
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
     */
    merge_option(options, key, value) {
        if (!options.hasOwnProperty(key)) {
            options[key] = value;
        }
        return options;
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
     */
    handle_suggestion_click(value, extra_option, default_value) {
        var current = this.$input.val();
        var cursor_pos = this.$input[0].selectionStart || 0;

        // Prevent blur from hiding the menu
        this.prevent_blur_hide = true;
        var self = this;
        setTimeout(function() {
            self.prevent_blur_hide = false;
        }, 200);

        // Reuse cached cursor state if it matches the current input/caret,
        // otherwise fall back to recomputing the segment/bracket info from get_current_segment.
        var state = (this._cursor_state && this._cursor_state.current === current && this._cursor_state.cursor_pos === cursor_pos) ? this._cursor_state : null;
        var parts = state ? state.parts : this.get_current_segment(current, cursor_pos);
        var start_pos = parts.prefix.length;
        var end_pos = start_pos + parts.segment.length;
        var existing_parsed = (parts.hasBracket && parts.segment) ? this.parse_bracket_expr(parts.segment) : null;

        var final_value;
        var new_text;
        var new_cursor_pos;

        if (extra_option) {
            // Adding an extra option to existing bracket
            if (parts.segment) {
                this.merge_option(existing_parsed.options, extra_option, default_value);
                final_value = this.build_bracket_expr(existing_parsed.base, existing_parsed.options);

                new_text = current.slice(0, start_pos) + final_value + current.slice(end_pos);
                new_cursor_pos = start_pos + final_value.length;
            }
        } else if (parts.hasBracket && parts.segment) {
            // Replacing existing bracket expression with new value, preserving options
            var new_parsed = this.parse_bracket_expr(value);
            final_value = this.build_bracket_expr(new_parsed.base, existing_parsed.options);

            new_text = current.slice(0, start_pos) + final_value + current.slice(end_pos);
            new_cursor_pos = start_pos + final_value.length;
        } else {
            // No bracket at cursor - insert new value at cursor position
            final_value = value;
            new_text = parts.prefix + final_value + parts.suffix;
            new_cursor_pos = parts.prefix.length + final_value.length;
        }

        this.$input.val(new_text);
        this.$input[0].setSelectionRange(new_cursor_pos, new_cursor_pos);
        this.$input.trigger('input').focus();
    }

    /**
     * Hide the suggestions dropdown menu
     *
     * Called when the input loses focus (blur event). Respects the prevent_blur_hide
     * flag to avoid hiding the menu during suggestion clicks, which would prevent
     * the click from being registered.
     *
     * Side effects:
     *   - Removes 'show' class from menu if not prevented
     *   - Does nothing if prevent_blur_hide is true
     */
    hide() {
        if (this.prevent_blur_hide) {
            return;
        }
        this.$menu.removeClass('show');
    }
}

export default LabelSuggestions;
