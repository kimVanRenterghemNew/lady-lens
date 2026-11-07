/**
 * Web language configurations (CSS and HTML) for the multi-language graph extractor.
 * Supports .css, .scss, .less, .html, .htm.
 */
import { buildLineOffsets, lineAt, findBlockEnd } from './engine.js';

export const CSS_CONFIG = Object.freeze({
    language: 'css',
    extensions: ['.css', '.scss', '.less'],
    commentPrefixes: ['/*', '*'],

    extract(source) {
        const lineOffsets = buildLineOffsets(source);
        const getLine = (index) => lineAt(source, index, lineOffsets);

        const result = {
            purpose: '',
            exports: [],
            symbols: [],
            symbolRanges: {},
            imports: [],
            calls: [],
            functions: [],
            parseError: null
        };

        // Purpose from leading comment
        const doc = source.match(/^\s*\/\*([\s\S]*?)\*\//);
        if (doc) {
            result.purpose = doc[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }

        // Imports: @import "..." or @import url(...)
        const importPattern = /@import\s+(?:url\(['"]?([^'"()]+)['"]?\)|['"]([^'"]+)['"])/g;
        for (const match of source.matchAll(importPattern)) {
            const imp = match[1] || match[2];
            if (imp) result.imports.push(imp);
        }

        // Keyframes, mixins, custom classes, IDs
        const rulePattern = /(?:@keyframes\s+([A-Za-z0-9_-]+)|@mixin\s+([A-Za-z0-9_-]+)|([.#][A-Za-z0-9_-]+)(?:\s*,\s*[.#][A-Za-z0-9_-]+)*\s*\{)/g;
        for (const match of source.matchAll(rulePattern)) {
            const keyframe = match[1];
            const mixin = match[2];
            const selector = match[3];
            const name = keyframe || mixin || selector;
            if (!name) continue;

            const startLine = getLine(match.index);
            const openBrace = source.indexOf('{', match.index);
            const endLine = openBrace !== -1 ? getLine(findBlockEnd(source, openBrace)) : startLine;

            result.symbols.push(name);
            result.exports.push(name);
            if (!result.symbolRanges[name]) {
                result.symbolRanges[name] = [startLine, endLine];
            }
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});

export const HTML_CONFIG = Object.freeze({
    language: 'html',
    extensions: ['.html', '.htm'],
    commentPrefixes: ['<!--'],

    extract(source) {
        const lineOffsets = buildLineOffsets(source);
        const getLine = (index) => lineAt(source, index, lineOffsets);

        const result = {
            purpose: '',
            exports: [],
            symbols: [],
            symbolRanges: {},
            imports: [],
            calls: [],
            functions: [],
            parseError: null
        };

        // Purpose from leading HTML comment <!-- ... --> or <title>
        const doc = source.match(/^\s*<!--([\s\S]*?)-->/);
        if (doc) {
            result.purpose = doc[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ').slice(0, 240);
        } else {
            const titleMatch = source.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) result.purpose = titleMatch[1].trim().slice(0, 240);
        }

        // Imported scripts & stylesheets
        const scriptPattern = /<script[^>]+src=["']([^"']+)["']/gi;
        for (const match of source.matchAll(scriptPattern)) {
            if (match[1]) result.imports.push(match[1]);
        }
        const linkPattern = /<link[^>]+href=["']([^"']+)["']/gi;
        for (const match of source.matchAll(linkPattern)) {
            if (match[1] && (match[0].includes('stylesheet') || match[1].endsWith('.css'))) {
                result.imports.push(match[1]);
            }
        }

        // Key elements with id, custom web-components (<my-component>), templates (<template id="...">)
        const idPattern = /<(?:template|[a-z0-9-]+)[^>]+id=["']([A-Za-z0-9_-]+)["']/gi;
        for (const match of source.matchAll(idPattern)) {
            const id = match[1];
            if (id) {
                const line = getLine(match.index);
                result.symbols.push(`#${id}`);
                result.exports.push(`#${id}`);
                if (!result.symbolRanges[`#${id}`]) {
                    result.symbolRanges[`#${id}`] = [line, line];
                }
            }
        }

        // Custom tags: <component-name ...>
        const customTagPattern = /<([a-z][a-z0-9]*-[-a-z0-9]+)\b/gi;
        for (const match of source.matchAll(customTagPattern)) {
            const tag = match[1].toLowerCase();
            result.symbols.push(tag);
            result.exports.push(tag);
            if (!result.symbolRanges[tag]) {
                const line = getLine(match.index);
                result.symbolRanges[tag] = [line, line];
            }
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});
