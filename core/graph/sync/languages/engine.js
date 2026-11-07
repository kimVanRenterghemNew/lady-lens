/**
 * Generic multi-language extractor engine (Story 23.11).
 * Extracts symbols, ranges, exports, imports, calls and complexity using data-driven language configs.
 */
import { findIndentedBlockEnd } from './blocks.js';

export function buildLineOffsets(source) {
    const offsets = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}

export function lineAt(source, index, lineOffsets = null) {
    if (!lineOffsets) {
        let line = 1;
        for (let i = 0; i < index && i < source.length; i++) {
            if (source[i] === '\n') line++;
        }
        return line;
    }
    let low = 0, high = lineOffsets.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lineOffsets[mid] <= index) low = mid + 1;
        else high = mid - 1;
    }
    return low;
}

const DEFAULT_COMMENT_PREFIXES = ['//', '/*', '*', '#', '--'];

export function isCommentLine(source, index, prefixes = DEFAULT_COMMENT_PREFIXES) {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const prefix = source.slice(lineStart, index).trimStart();
    return prefixes.some(p => prefix.startsWith(p));
}

export function findBlockEnd(source, openBraceIndex) {
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return source.length - 1;
}

const CC_KEYWORDS = /\b(if|while|for|foreach|catch|case)\b|(?:\?[\s\S]*?:)|(?:&&|\|\||\?\?)/g;

export function countDecisionsInBody(bodyText) {
    const matches = bodyText.match(CC_KEYWORDS);
    return matches ? matches.length : 0;
}

export function extractWithConfig(source, config, filePath = '') {
    if (typeof config.extract === 'function') {
        const custom = config.extract(source, filePath);
        return {
            purpose: '',
            exports: [],
            symbols: [],
            symbolRanges: {},
            imports: [],
            calls: [],
            functions: [],
            parseError: null,
            ...custom
        };
    }

    const lineOffsets = buildLineOffsets(source);
    const getLine = (index) => lineAt(source, index, lineOffsets);
    const commentPrefixes = config.commentPrefixes || DEFAULT_COMMENT_PREFIXES;

    const result = {
        purpose: config.extractPurpose ? config.extractPurpose(source) : '',
        exports: [],
        symbols: [],
        symbolRanges: {},
        imports: [],
        calls: [],
        functions: [],
        parseError: null
    };

    // 1. Imports / Usings / Requires
    if (config.importPattern) {
        for (const match of source.matchAll(config.importPattern)) {
            if (match[1]) result.imports.push(match[1].trim());
            if (match[2]) {
                match[2].split(',').forEach(imp => result.imports.push(imp.trim()));
            }
        }
        result.imports = [...new Set(result.imports)];
    }

    // 2. Types (Classes, Interfaces, Structs, Records)
    if (config.typePattern) {
        for (const match of source.matchAll(config.typePattern)) {
            if (isCommentLine(source, match.index, commentPrefixes)) continue;
            const name = match[match.length - 1] || match[1];
            if (name) {
                result.symbols.push(name);
                result.exports.push(name);
                const startLine = getLine(match.index);
                result.symbolRanges[name] = [startLine, startLine];
            }
        }
    }

    // 3. Methods, Functions & Constructors
    const methodMatches = [];
    const methodPatterns = config.methodPatterns || [config.methodPattern].filter(Boolean);
    for (const methodPattern of methodPatterns) {
        for (const match of source.matchAll(methodPattern)) {
            if (isCommentLine(source, match.index, commentPrefixes)) continue;
            const name = match[match.length - 2] || match[1];
            const params = match[match.length - 1] || '';
            if (name) methodMatches.push({ name, params, index: match.index });
        }
    }
    const constructorPatterns = config.constructorPatterns || [config.constructorPattern].filter(Boolean);
    for (const constructorPattern of constructorPatterns) {
        for (const match of source.matchAll(constructorPattern)) {
            if (isCommentLine(source, match.index, commentPrefixes)) continue;
            const name = match[match.length - 2] || match[1];
            const params = match[match.length - 1] || '';
            if (name) methodMatches.push({ name, params, index: match.index });
        }
    }

    for (const item of methodMatches) {
        const name = item.name;
        if (!name) continue;
        const startLine = getLine(item.index);
        let endLine;
        let bodyText = '';

        if (config.indentationBased) {
            const endIndex = findIndentedBlockEnd(source, item.index);
            endLine = getLine(endIndex);
            bodyText = source.slice(item.index, endIndex + 1);
        } else {
            const openBrace = source.indexOf('{', item.index);
            if (openBrace !== -1) {
                const closeIndex = findBlockEnd(source, openBrace);
                endLine = getLine(closeIndex);
                bodyText = source.slice(openBrace, closeIndex + 1);
            }
        }

        if (!result.symbolRanges[name]) {
            result.symbols.push(name);
            result.exports.push(name);
            result.symbolRanges[name] = [startLine, endLine];
        }

        const lines = endLine - startLine + 1;
        const params = item.params ? item.params.split(',').filter(p => p.trim()).length : 0;
        const cc = 1 + countDecisionsInBody(bodyText);

        const issues = [];

        // Extract calls
        if (config.callPattern && bodyText) {
            for (const callMatch of bodyText.matchAll(config.callPattern)) {
                const callee = callMatch[1];
                if (callee !== name && !['if', 'for', 'foreach', 'while', 'switch', 'catch', 'typeof', 'sizeof', 'elif', 'except', 'def', 'class', 'return', 'import', 'from'].includes(callee)) {
                    result.calls.push([name, callee, startLine]);
                }
            }
        }

        result.functions.push({ name, startLine, endLine, lines, params, cc, issues });
    }

    result.exports = [...new Set(result.exports)];
    result.symbols = [...new Set(result.symbols)];
    result.calls = [...new Set(result.calls)];
    return result;
}
