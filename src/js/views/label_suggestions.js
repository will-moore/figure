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
        keywords: ["labels", "separate", "single", "color"],
        options: [
            { label: "Single label", value: "[channels]", hint: "All active channel labels together in one line" },
            { label: "Separate labels - ⚠ overwrites input", value: "[channels labels]", hint: "Will generate one label per active channel.", preformatted: true } // an exceptional label format
        ],
        hint: "The name of the active channels."
    },
    "time": {
        label: "Time",
        keywords: ["t", "timestamp", "frame", "hours", "minutes", "seconds", "milliseconds"],
        options: [
            { label: "Index", value: "[time.index]", hint: "The timepoint index (1-based) of the current frame" },
            { label: "Milliseconds", value: "[time.ms]", hint: "The time in milliseconds for the current frame" },
            { label: "Seconds", value: "[time.s]", hint: "The time in seconds for the current frame" },
            { label: "Minutes", value: "[time.m]", hint: "The time in minutes for the current frame" },
            { label: "min:sec", value: "[time.m:s]", hint: "The time in minutes and seconds for the current frame" },
            { label: "hrs:min", value: "[time.h:m]", hint: "The time in hours and minutes for the current frame" },
            { label: "hrs:min:sec", value: "[time.h:m:s]", hint: "The time in hours, minutes and seconds for the current frame" }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Number of decimal places to show." },
            { key: "offset", default: "0", hint: "Frame index reference (1-based) to offset the displayed time." }
        ],
        hint: "The time metadata for the current frame."
    },
    "z": {
        label: "Z Coordinate",
        keywords: ["stack", "slice", "pixel", "unit", "coordinate"],
        options: [
            { label: "Pixel", value: "[z.pixel]", hint: "The Z coordinate in pixels for the current slice." },
            { label: "Unit", value: "[z.unit]", hint: "The Z coordinate in physical size units for the current slice." }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Unit only. Number of decimal places to show." },
        ],
        hint: "The Z coordinate of the current slice."
    },
    "x": {
        label: "X Coordinate",
        keywords: ["position", "pixel", "unit", "coordinate"],
        options: [
            { label: "Pixel", value: "[x.pixel]", hint: "The X coordinate in pixels." },
            { label: "Unit", value: "[x.unit]", hint: "The X coordinate in physical size." }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Unit only. Number of decimal places to show." },
        ],
        hint: "The X coordinate of the current position."
    },
    "y": {
        label: "Y Coordinate",
        keywords: ["position", "pixel", "unit", "coordinate"],
        options: [
            { label: "Pixel", value: "[y.pixel]", hint: "The Y coordinate in pixels." },
            { label: "Unit", value: "[y.unit]", hint: "The Y coordinate in physical size." }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Unit only. Number of decimal places to show." },
        ],
        hint: "The Y coordinate of the current position."
    },
    "width": {
        label: "Width",
        keywords: ["length", "size", "pixel", "unit", "coordinate"],
        options: [
            { label: "Pixel", value: "[width.pixel]", hint: "The width in pixels" },
            { label: "Unit", value: "[width.unit]", hint: "The width in physical size." }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Unit only. Number of decimal places to show." },
        ],
        hint: "The width of the current field of view."
    },
    "height": {
        label: "Height",
        keywords: ["length", "size", "pixel", "unit", "coordinate"],
        options: [
            { label: "Pixel", value: "[height.pixel]", hint: "The height in pixels" },
            { label: "Unit", value: "[height.unit]", hint: "The height in physical size." }
        ],
        extraOptions: [
            { key: "precision", default: "2", hint: "Unit only. Number of decimal places to show." },
        ],
        hint: "The height of the current field of view."
    },
    "tags": {
        label: "Tags - ⚠ overwrites input",
        keywords: ["annotation"],
        hint: "⚠ Clears other inputs. All tags for the current image as separate labels (including the tags of the parent objects).",
        preformatted: true
    },
    "key-values": {
        label: "Key-Value Pairs - ⚠ overwrites input",
        keywords: ["kv", "keyvalue", "map", "annotation"],
        hint: "⚠ Clears other inputs. Opens a menu to select a key-value pair on the image or its parent objects.",
        preformatted: true
    },
    "zoom": {
        label: "Zoom level (%)",
        keywords: ["scale", "percent"],
        hint: "The current zoom level percentage."
    },
    "rotation": {
        label: "Rotation (°)",
        keywords: ["degree", "angle"],
        hint: "The current rotation in degrees."
    },
    "image": {
        label: "Image",
        keywords: ["name", "id", "filename"],
        options: [
            { label: "Image ID", value: "[image.id]", hint: "The ID of the image." },
            { label: "Image Name", value: "[image.name]", hint: "The name of the image." }
        ],
        hint: "The name or ID of the image."
    },
    "dataset": {
        label: "Dataset",
        keywords: ["name", "id"],
        options: [
            { label: "Dataset ID", value: "[dataset.id]", hint: "The ID of the image's dataset." },
            { label: "Dataset Name", value: "[dataset.name]", hint: "The name of the image's dataset." }
        ],
        hint: "The name or ID of the image's dataset."
    },
    "project": {
        label: "Project",
        keywords: ["name", "id"],
        options: [
            { label: "Project ID", value: "[project.id]", hint: "The ID of the image's project." },
            { label: "Project Name", value: "[project.name]", hint: "The name of the image's project." }
        ],
        hint: "The name or ID of the image's project."
    },
    "field": {
        label: "Field / Well Sample",
        keywords: ["index", "id", "sample", "wellsample"],
        options: [
            { label: "Field ID", value: "[field.id]", hint: "Field ID of the image." },
            { label: "Field Index", value: "[field.index]", hint: "Field index of the image within the whole plate." },
            { label: "Field Run Index", value: "[field.index_run]", hint: "Field index of the image within its run." }
        ],
        hint: "The name or index of the image's WellSample within the whole plate or the run."
    },
    "well": {
        label: "Well",
        keywords: ["label", "id", "name"],
        options: [
            { label: "Well ID", value: "[well.id]", hint: "The ID of the image's Well." },
            { label: "Well Label", value: "[well.label]", hint: "The label of the image's Well." }
        ],
        hint: "The name or ID of the image's Well."
    },
    "run": {
        label: "Run / Plate Acquisition",
        keywords: ["plateacquisition", "name", "id", "acquisition"],
        options: [
            { label: "Run ID", value: "[run.id]", hint: "The ID of the current Run." },
            { label: "Run Name", value: "[run.name]", hint: "The name of the current Run." }
        ],
        hint: "The name or ID of the image's Run."
    },
    "plate": {
        label: "Plate",
        keywords: ["name", "id"],
        options: [
            { label: "Plate ID", value: "[plate.id]", hint: "The ID of the image's Plate." },
            { label: "Plate Name", value: "[plate.name]", hint: "The name of the image's Plate." }
        ],
        hint: "The name or ID of the image's Plate."
    },
    "screen": {
        label: "Screen",
        keywords: ["name", "id"],
        options: [
            { label: "Screen ID", value: "[screen.id]", hint: "The ID of the image's Screen." },
            { label: "Screen Name", value: "[screen.name]", hint: "The name of the image's Screen." }
        ],
        hint: "The name or ID of the image's Screen."
    }
};

const PREFORMATTED_OPTIONS = [
    { label: "Well name and Field index", value: "[well.label], Field#[field.index]", hint: "Preformatted option.", applies_to: ["field", "well", "run"] },
    { label: "Viewport coordinates (x, y, w, h)", value: "X: [x.pixel] Y: [y.pixel] Width: [width] Height: [height]", hint: "Preformatted X & Y coordinates in pixels.", applies_to: ["x", "y", "width", "height"] }
]

var preformatted_label_options = new Set();
Object.keys(LABEL_DICTIONARY).forEach(function(key) {
    var entry = LABEL_DICTIONARY[key];
    if (entry.preformatted) {
        preformatted_label_options.add("[" + key + "]");
    } else if (entry.options) {
        entry.options.forEach(function(opt) {
            if (opt.preformatted) {
                preformatted_label_options.add(opt.value);
            }
        });
    }
});
PREFORMATTED_OPTIONS.forEach(function(entry) {
    preformatted_label_options.add(entry.value);
});

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
        this.have_time = true;
        this.parents_flags = {
            project: true,
            dataset: true,
            screen: true,
            plate: true
        };
        this.$menu = $container.find('.label-suggestions');
        this.$input = $container.find('.label-text');
        this.$suggestions_toggle = $container.find('.suggestions-toggle');
        this.prevent_blur_hide = false;
        this.suggestions_enabled = true;
        // Cached state about the current input cursor/segment to avoid
        // re-parsing when handling suggestion clicks.
        this._cursor_state = null;

        // Set up event listeners
        this._setup_event_listeners();
    }

    /**
     * Set up event listeners for the suggestions toggle button
     */
    _setup_event_listeners() {
        var self = this;
        if (this.$suggestions_toggle.length) {
            this.$suggestions_toggle.on('click', function(e) {
                e.preventDefault();
                self.toggle_suggestions();
            });
        }
    }

    /**
     * Toggle suggestions enabled/disabled state
     * Updates the button appearance and hides/shows the menu accordingly
     */
    toggle_suggestions() {
        this.suggestions_enabled = !this.suggestions_enabled;

        // Update button and icon appearance
        var $icon = this.$suggestions_toggle.find('i');
        if (this.suggestions_enabled) {
            this.$suggestions_toggle.removeClass('suggestions-disabled');
            $icon.removeClass('opacity-50');
            this.$suggestions_toggle.attr('title', 'Suggestions appear as you type. Click to disable.');
        } else {
            this.$suggestions_toggle.addClass('suggestions-disabled');
            $icon.addClass('opacity-50');
            this.$suggestions_toggle.attr('title', 'Click to enable suggestions.');
            this.$menu.removeClass('show').empty();
        }

        // Remove focus to hide selection state
        this.$suggestions_toggle[0].blur();
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
        if (!this.suggestions_enabled) {
            return;
        }

        var entry = LABEL_DICTIONARY[label_type];
        if (!entry || !entry.options) {
            this.$menu.removeClass('show').empty();
            return;
        }

        var html = "<div class='dropdown-header'>Options for " + _.escape(entry.label) + "</div>";
        html += entry.options.map(function(opt) {
            var title = " title='"+_.escape(opt.hint || "")+"'";
            return "<button type='button' class='dropdown-item' data-value='" + _.escape(opt.value) + "' " + title + ">" + _.escape(opt.label) + "</button>";
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
                var title = " title='"+_.escape(extra_opt.hint || "")+"'";
                return "<button type='button' class='dropdown-item'" + disabled + title + " data-extra-option='" + _.escape(extra_opt.key) + "' data-default-value='" + _.escape(extra_opt.default) + "'>" + _.escape(opt_label) + "</button>";
            }).join("");
        }

        // Add preformatted options if available
        var preformatted_for_type = PREFORMATTED_OPTIONS.filter(function(opt) {
            return opt.applies_to && opt.applies_to.indexOf(label_type) !== -1;
        });

        if (preformatted_for_type.length > 0) {
            html += "<div class='dropdown-divider'></div>";
            html += "<div class='dropdown-header'>Preformatted Options - ⚠ overwrites input</div>";
            html += preformatted_for_type.map(function(opt) {
                var title = " title='"+_.escape(opt.hint || "")+"'";
                return "<button type='button' class='dropdown-item' data-value='" + _.escape(opt.value) + "' " + title + ">" + _.escape(opt.label) + "</button>";
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
        if (!this.suggestions_enabled) {
            return;
        }

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
                } else if (entry.label.toLowerCase().startsWith(lower)) {
                    filtered.push({ key: key, entry: entry });
                } else if ((entry.keywords || []).some(function(k) { return k.startsWith(lower); })) {
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
        if (preformatted_label_options.has(value)) {
            this.$input.val(value);
            return;
        }

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
