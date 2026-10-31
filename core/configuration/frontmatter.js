/**
 * YAML Frontmatter Parser and Serializer
 * 
 * Handles parsing and serialization of YAML frontmatter blocks from Markdown files.
 * Supports:
 * - Simple key-value pairs: `key: value`
 * - Arrays: `items: [item1, item2]` or list format
 * - Nested objects: `metadata: { nested: value }`
 * - Proper indentation handling for Windows (CRLF) and Unix (LF) line endings
 */

import YAML from 'yaml';

/**
 * Parse YAML frontmatter from markdown content.
 * Supports simple key-value pairs, YAML arrays, and nested objects.
 * Handles both Unix (LF) and Windows (CRLF) line endings.
 * 
 * @param {string} content - Markdown file content with frontmatter block
 * @returns {Object} Parsed frontmatter as key-value object
 * 
 * @example
 * const content = `---\ntitle: My Document\nstatus: draft\n---\n# Body`;
 * const fm = parseFrontmatter(content);
 * // { title: 'My Document', status: 'draft' }
 */
export function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    // Real YAML first: nested objects (classificationCounts, suggestedPaths) and empty arrays round-trip.
    // Hand-written frontmatter that is not valid YAML falls back to the original lenient parser.
    try {
        // logLevel 'error': hand-written frontmatter with a stray `!` is not a YAML tag worth a stderr warning.
        const parsed = YAML.parse(match[1], { logLevel: 'error' });
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* lenient fallback below */ }
    return parseFrontmatterLenient(content);
}

function parseFrontmatterLenient(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};

    const yaml = match[1];
    const obj = {};
    const lines = yaml.split('\n');
    let i = 0;

    while (i < lines.length) {
        let line = lines[i].replace('\r', '');
        if (!line.trim()) {
            i++;
            continue;
        }

        // Check if this is a key: value line (not indented)
        if (!/^\s/.test(line)) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) {
                i++;
                continue;
            }

            const key = line.substring(0, colonIdx).trim();
            let value = line.substring(colonIdx + 1).trim();

            // Check if this key starts an array
            if (value === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('-')) {
                const array = [];
                i++;
                while (i < lines.length && lines[i].trim().startsWith('-')) {
                    let itemLine = lines[i].replace('\r', '');
                    const dashIdx = itemLine.indexOf('-');
                    const itemPrefix = itemLine.substring(dashIdx + 1).trim();

                    // Parse item (could be a scalar or start of an object)
                    if (itemPrefix && !itemPrefix.includes(':')) {
                        // Simple scalar item
                        array.push(itemPrefix.replace(/^["']|["']$/g, ''));
                        i++;
                    } else {
                        // Object item: parse properties until next item or end of array
                        const item = {};
                        if (itemPrefix) {
                            const [itemKey, ...itemValueParts] = itemPrefix.split(':');
                            const itemValue = itemValueParts.join(':').trim().replace(/^["']|["']$/g, '');
                            item[itemKey.trim()] = parseYamlValue(itemValue);
                        }
                        i++;

                        // Consume indented properties at same level or deeper (but not new array items)
                        while (i < lines.length) {
                            let propLine = lines[i].replace('\r', '');
                            if (!propLine.trim()) {
                                i++;
                                continue;
                            }
                            
                            // Check indentation - if it starts with -, it's a new array item
                            if (propLine.trim().startsWith('-')) break;
                            
                            // Check if this line is indented (part of this object)
                            const indentMatch = propLine.match(/^(\s+)/);
                            if (!indentMatch) break; // No indent = end of object
                            
                            // Must be at least indented to 4 spaces (object property level)
                            const indent = indentMatch[1].length;
                            if (indent < 4) break;
                            
                            const propContent = propLine.trim();
                            const colonPos = propContent.indexOf(':');
                            if (colonPos === -1) {
                                i++;
                                continue;
                            }
                            
                            const propKey = propContent.substring(0, colonPos).trim();
                            const propValue = unquoteYamlString(propContent.substring(colonPos + 1).trim());
                            item[propKey] = parseYamlValue(propValue);
                            i++;
                        }
                        array.push(item);
                    }
                }
                obj[key] = array;
            } else {
                // Simple scalar value
                obj[key] = parseYamlValue(value);
                i++;
            }
        } else {
            i++;
        }
    }

    return obj;
}

// Parse YAML scalar value (handle quotes, booleans, numbers, etc.)
/**
 * Parse YAML scalar value, handling quotes, booleans, numbers, and strings.
 * @param {string} value - YAML value string
 * @returns {*} Parsed value (string, number, boolean, or null)
 * @private
 */
function parseYamlValue(value) {
    value = value.trim();
    if (value === '' || value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value) && value !== '') return Number(value);
    return unquoteYamlString(value);
}

// Strip surrounding quotes and un-escape \" back to " (lenient parser for hand-written frontmatter)
function unquoteYamlString(value) {
    if (/^".*"$/.test(value)) {
        return value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value.replace(/^'|'$/g, '');
}

/**
 * Serialize an object back into a YAML frontmatter block followed by the body.
 * Handles:
 * - Simple values
 * - Arrays of scalars and objects
 * - Nested objects with proper indentation
 * 
 * @param {Object} obj - Frontmatter object to serialize
 * @param {string} body - Document body content (appended after frontmatter)
 * @returns {string} Complete markdown file content with frontmatter block
 * 
 * @example
 * const fm = { title: 'Doc', tags: ['a', 'b'], status: 'draft' };
 * const content = stringifyFrontmatter(fm, '# Body');
 * // Returns: "---\ntitle: Doc\ntags:\n - a\n - b\nstatus: draft\n---\n# Body"
 */
export function stringifyFrontmatter(obj, body = '') {
    // Drop undefined values (YAML would write them as null) and serialize with a real YAML emitter, so nested
    // objects never become "[object Object]" and what we write is what parseFrontmatter reads back.
    const clean = JSON.parse(JSON.stringify(obj ?? {}));
    const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
    return `---\n${yaml}\n---\n${body}`;
}

