/**
 * Generic multi-language extractor engine (Story 23.11).
 * Extracts symbols, ranges, exports, imports, calls and complexity using data-driven language configs.
 */

function buildLineOffsets(source) {
    const offsets = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}

function lineAt(source, index, lineOffsets = null) {
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

function isCommentLine(source, index) {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const prefix = source.slice(lineStart, index).trimStart();
    return prefix.startsWith('//') || prefix.startsWith('/*') || prefix.startsWith('*');
}

function findBlockEnd(source, openBraceIndex) {
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

function countDecisionsInBody(bodyText) {
    const matches = bodyText.match(CC_KEYWORDS);
    return matches ? matches.length : 0;
}

export function extractWithConfig(source, config, filePath = '') {
    const lineOffsets = buildLineOffsets(source);
    const getLine = (index) => lineAt(source, index, lineOffsets);

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

    // 1. Imports / Usings
    if (config.importPattern) {
        for (const match of source.matchAll(config.importPattern)) {
            if (match[1]) result.imports.push(match[1].trim());
        }
        result.imports = [...new Set(result.imports)];
    }

    // 2. Types (Classes, Interfaces, Structs, Records)
    if (config.typePattern) {
        for (const match of source.matchAll(config.typePattern)) {
            if (isCommentLine(source, match.index)) continue;
            const name = match[2];
            const startLine = getLine(match.index);
            const openBrace = source.indexOf('{', match.index + match[0].length);
            const endLine = openBrace !== -1 ? getLine(findBlockEnd(source, openBrace)) : startLine;

            result.symbols.push(name);
            result.exports.push(name);
            result.symbolRanges[name] = [startLine, endLine];
        }
    }

    // 3. Methods & Constructors
    const methodMatches = [];
    if (config.methodPattern) {
        for (const match of source.matchAll(config.methodPattern)) {
            if (isCommentLine(source, match.index)) continue;
            methodMatches.push({ name: match[2], params: match[3], index: match.index });
        }
    }
    if (config.constructorPattern) {
        for (const match of source.matchAll(config.constructorPattern)) {
            if (isCommentLine(source, match.index)) continue;
            methodMatches.push({ name: match[1], params: match[2], index: match.index });
        }
    }

    for (const item of methodMatches) {
        const name = item.name;
        const startLine = getLine(item.index);
        const openBrace = source.indexOf('{', item.index);
        let endLine = startLine;
        let bodyText = '';

        if (openBrace !== -1) {
            const closeIndex = findBlockEnd(source, openBrace);
            endLine = getLine(closeIndex);
            bodyText = source.slice(openBrace, closeIndex + 1);
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
        if (cc > 15) issues.push('high-cyclomatic-complexity');
        if (lines > 60) issues.push('large-function');
        if (params > 5) issues.push('too-many-params');

        result.functions.push({
            name,
            loc: [startLine, endLine],
            lines,
            params,
            cyclomaticComplexity: cc,
            issues
        });

        // Calls inside method
        if (config.callPattern && bodyText) {
            for (const callMatch of bodyText.matchAll(config.callPattern)) {
                const callee = callMatch[1];
                if (callee !== name && !['if', 'for', 'foreach', 'while', 'switch', 'catch', 'typeof', 'sizeof'].includes(callee)) {
                    result.calls.push([name, callee, startLine]);
                }
            }
        }
    }

    result.exports = [...new Set(result.exports)];
    result.symbols = [...new Set(result.symbols)];
    result.isTest = config.isTestFile ? config.isTestFile(filePath, source) : false;

    return result;
}
