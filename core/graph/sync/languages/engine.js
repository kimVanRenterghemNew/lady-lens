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

function scanLineNumber(source, index) {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) {
        if (source[i] === '\n') line++;
    }
    return line;
}

export function lineAt(source, index, lineOffsets = null) {
    if (!lineOffsets) return scanLineNumber(source, index);
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

const BRACE_DELTA = { '{': 1, '}': -1 };

export function findBlockEnd(source, openBraceIndex) {
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
        depth += BRACE_DELTA[source[i]] || 0;
        if (depth === 0 && source[i] === '}') return i;
    }
    return source.length - 1;
}

const CC_KEYWORDS = /\b(if|while|for|foreach|catch|case)\b|(?:\?[\s\S]*?:)|(?:&&|\|\||\?\?)/g;

export function countDecisionsInBody(bodyText) {
    const matches = bodyText.match(CC_KEYWORDS);
    return matches ? matches.length : 0;
}

function extractImports(source, config, result) {
    if (!config.importPattern) return;
    for (const match of source.matchAll(config.importPattern)) {
        if (match[1]) result.imports.push(match[1].trim());
        if (match[2]) match[2].split(',').forEach(imp => result.imports.push(imp.trim()));
    }
    result.imports = [...new Set(result.imports)];
}

function matchTypeName(source, match, commentPrefixes) {
    if (isCommentLine(source, match.index, commentPrefixes)) return null;
    return match[match.length - 1] || match[1] || null;
}

function addTypeSymbol(name, index, getLine, result) {
    result.symbols.push(name);
    result.exports.push(name);
    const startLine = getLine(index);
    result.symbolRanges[name] = [startLine, startLine];
}

function extractTypes(source, config, commentPrefixes, getLine, result) {
    if (!config.typePattern) return;
    for (const match of source.matchAll(config.typePattern)) {
        const name = matchTypeName(source, match, commentPrefixes);
        if (name) addTypeSymbol(name, match.index, getLine, result);
    }
}

function extractPatternItem(source, match, commentPrefixes) {
    if (isCommentLine(source, match.index, commentPrefixes)) return null;
    const name = match[match.length - 2] || match[1];
    if (!name) return null;
    const params = match[match.length - 1] || '';
    return { name, params, index: match.index };
}

function matchSinglePattern(source, pattern, commentPrefixes, matches) {
    for (const match of source.matchAll(pattern)) {
        const item = extractPatternItem(source, match, commentPrefixes);
        if (item) matches.push(item);
    }
}

function matchMethodPatterns(source, patterns, commentPrefixes, matches) {
    patterns.forEach(pattern => matchSinglePattern(source, pattern, commentPrefixes, matches));
}

function resolveMethodBody(source, item, config, getLine) {
    if (config.indentationBased) {
        const endIndex = findIndentedBlockEnd(source, item.index);
        return { endLine: getLine(endIndex), bodyText: source.slice(item.index, endIndex + 1) };
    }
    const openBrace = source.indexOf('{', item.index);
    if (openBrace === -1) return { endLine: undefined, bodyText: '' };
    const closeIndex = findBlockEnd(source, openBrace);
    return { endLine: getLine(closeIndex), bodyText: source.slice(openBrace, closeIndex + 1) };
}

const KEYWORDS = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'typeof', 'sizeof', 'elif', 'except', 'def', 'class', 'return', 'import', 'from']);

function isValidCallee(callee, callerName) {
    if (callee === callerName) return false;
    return !KEYWORDS.has(callee);
}

function extractCalls(bodyText, callPattern, callerName, startLine, calls) {
    if (!callPattern) return;
    if (!bodyText) return;
    for (const match of bodyText.matchAll(callPattern)) {
        const callee = match[1];
        if (isValidCallee(callee, callerName)) {
            calls.push([callerName, callee, startLine]);
        }
    }
}

function processMethodItem(item, source, config, getLine, result) {
    const { name, params: rawParams, index } = item;
    if (!name) return;
    const startLine = getLine(index);
    const { endLine, bodyText } = resolveMethodBody(source, item, config, getLine);

    if (!result.symbolRanges[name]) {
        result.symbols.push(name);
        result.exports.push(name);
        result.symbolRanges[name] = [startLine, endLine];
    }

    const lines = endLine - startLine + 1;
    const params = rawParams ? rawParams.split(',').filter(p => p.trim()).length : 0;
    const cc = 1 + countDecisionsInBody(bodyText);

    extractCalls(bodyText, config.callPattern, name, startLine, result.calls);
    result.functions.push({ name, startLine, endLine, lines, params, cc, issues: [] });
}

function createExtractionResult(config, source) {
    const purpose = config.extractPurpose ? config.extractPurpose(source) : '';
    return {
        purpose, exports: [], symbols: [], symbolRanges: {},
        imports: [], calls: [], functions: [], parseError: null
    };
}

function collectExtractionPatterns(config) {
    const methods = config.methodPatterns || [config.methodPattern].filter(Boolean);
    const ctors = config.constructorPatterns || [config.constructorPattern].filter(Boolean);
    return [...methods, ...ctors];
}

export function extractWithConfig(source, config, filePath) {
    if (typeof config.extract === 'function') {
        const custom = config.extract(source, filePath || '');
        return { ...createExtractionResult(config, source), ...custom };
    }

    const lineOffsets = buildLineOffsets(source);
    const getLine = (index) => lineAt(source, index, lineOffsets);
    const commentPrefixes = config.commentPrefixes || DEFAULT_COMMENT_PREFIXES;
    const result = createExtractionResult(config, source);

    extractImports(source, config, result);
    extractTypes(source, config, commentPrefixes, getLine, result);

    const methodMatches = [];
    matchMethodPatterns(source, collectExtractionPatterns(config), commentPrefixes, methodMatches);
    methodMatches.forEach(item => processMethodItem(item, source, config, getLine, result));

    result.exports = [...new Set(result.exports)];
    result.symbols = [...new Set(result.symbols)];
    result.calls = [...new Set(result.calls)];
    return result;
}
