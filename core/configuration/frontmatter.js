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
 */
export function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    try {
        const parsed = YAML.parse(match[1], { logLevel: 'error' });
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* lenient fallback below */ }
    return parseFrontmatterLenient(content);
}

function parseObjectPropertyLine(propLine, item) {
    const trimmed = propLine.trim();
    const colonPos = trimmed.indexOf(':');
    if (colonPos !== -1) {
        const propKey = trimmed.substring(0, colonPos).trim();
        const propValue = unquoteYamlString(trimmed.substring(colonPos + 1).trim());
        item[propKey] = parseYamlValue(propValue);
    }
}

function isEndOfObjectItem(trimmed, indent) {
    return trimmed.startsWith('-') || indent < 4;
}

function parseObjectItemProperties(item, lines, startIdx) {
    let i = startIdx;
    while (i < lines.length) {
        const propLine = lines[i];
        const trimmed = propLine.trim();
        const indent = (propLine.match(/^(\s+)/) || [''])[0].length;
        if (trimmed && isEndOfObjectItem(trimmed, indent)) break;
        if (trimmed) parseObjectPropertyLine(propLine, item);
        i++;
    }
    return i;
}

function parseSingleArrayItem(lines, i) {
    const itemLine = lines[i];
    const dashIdx = itemLine.indexOf('-');
    const itemPrefix = itemLine.substring(dashIdx + 1).trim();

    if (itemPrefix && !itemPrefix.includes(':')) {
        return { item: itemPrefix.replace(/^["']|["']$/g, ''), nextIdx: i + 1 };
    }

    const item = {};
    if (itemPrefix) {
        const [itemKey, ...itemValueParts] = itemPrefix.split(':');
        const itemValue = itemValueParts.join(':').trim().replace(/^["']|["']$/g, '');
        item[itemKey.trim()] = parseYamlValue(itemValue);
    }
    const nextIdx = parseObjectItemProperties(item, lines, i + 1);
    return { item, nextIdx };
}

function parseYamlArray(lines, startIdx) {
    const array = [];
    let i = startIdx;
    while (i < lines.length && lines[i].trim().startsWith('-')) {
        const { item, nextIdx } = parseSingleArrayItem(lines, i);
        array.push(item);
        i = nextIdx;
    }
    return { array, nextIdx: i };
}

function parseTopLevelField(lines, i, obj) {
    const line = lines[i];
    const colonIdx = !/^\s/.test(line) ? line.indexOf(':') : -1;
    if (colonIdx === -1) return i + 1;

    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();
    const nextIsArray = value === '' && lines[i + 1]?.trim().startsWith('-');
    if (nextIsArray) {
        const { array, nextIdx } = parseYamlArray(lines, i + 1);
        obj[key] = array;
        return nextIdx;
    }
    obj[key] = parseYamlValue(value);
    return i + 1;
}

function parseFrontmatterLenient(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};

    const lines = match[1].split('\n').map(l => l.replace('\r', ''));
    const obj = {};
    let i = 0;
    while (i < lines.length) {
        i = parseTopLevelField(lines, i, obj);
    }
    return obj;
}

const YAML_LITERALS = {
    '': null,
    null: null,
    true: true,
    false: false
};

function parseYamlValue(value) {
    const trimmed = value.trim();
    if (Object.prototype.hasOwnProperty.call(YAML_LITERALS, trimmed)) {
        return YAML_LITERALS[trimmed];
    }
    if (!isNaN(trimmed)) return Number(trimmed);
    return unquoteYamlString(trimmed);
}

function unquoteYamlString(value) {
    if (/^".*"$/.test(value)) {
        return value.slice(1, -1).replace(/\\"/g, '"');
    }
    return value.replace(/^'|'$/g, '');
}

export function stringifyFrontmatter(obj, body = '') {
    const clean = JSON.parse(JSON.stringify(obj ?? {}));
    const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
    return `---\n${yaml}\n---\n${body}`;
}
