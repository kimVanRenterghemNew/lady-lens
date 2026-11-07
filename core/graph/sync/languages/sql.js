/**
 * SQL language configuration for the multi-language graph extractor.
 * Extracts tables, views, stored procedures, functions, indexes, triggers, and table references.
 */
import { buildLineOffsets, lineAt } from './engine.js';

export const SQL_CONFIG = Object.freeze({
    language: 'sql',
    extensions: ['.sql'],
    commentPrefixes: ['--', '/*'],

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

        // Purpose from header comments
        const topComments = source.match(/^(?:\s*(?:--[^\n]*|\/\*[\s\S]*?\*\/)\n)+/);
        if (topComments) {
            result.purpose = topComments[0]
                .split('\n')
                .map(l => l.replace(/^\s*(?:--|\/\*|\*|\*\/)\s?/, '').trim())
                .filter(Boolean)
                .join(' ')
                .slice(0, 240);
        }

        // Schema Objects: CREATE [OR REPLACE] [TABLE|VIEW|PROCEDURE|FUNCTION|INDEX|TRIGGER] [IF NOT EXISTS] name
        const ddlPattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+|TEMP\s+)?(TABLE|VIEW|PROCEDURE|FUNCTION|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`]?([A-Za-z0-9_]+)["`]?\.)?["`]?([A-Za-z0-9_]+)["`]?/gi;
        for (const match of source.matchAll(ddlPattern)) {
            const kind = match[1].toUpperCase();
            const name = match[3];
            if (!name) continue;

            const startLine = getLine(match.index);
            // Search for end of DDL (semicolon or GO or next CREATE/slash)
            const rest = source.slice(match.index);
            const semiIndex = rest.search(/;\s*(?:\n|$)|(?:\n\s*GO\b)/i);
            const endOffset = semiIndex !== -1 ? match.index + semiIndex : match.index + Math.min(rest.length, 300);
            const endLine = getLine(endOffset);

            result.symbols.push(name);
            result.exports.push(name);
            result.symbolRanges[name] = [startLine, endLine];

            if (kind === 'PROCEDURE' || kind === 'FUNCTION') {
                const bodySlice = source.slice(match.index, endOffset);
                const lines = endLine - startLine + 1;
                result.functions.push({
                    name,
                    loc: [startLine, endLine],
                    lines,
                    params: (bodySlice.match(/@?[A-Za-z0-9_]+\s+(?:INT|VARCHAR|TEXT|DATE|FLOAT|BOOLEAN|BIGINT|CHAR)/gi) || []).length,
                    cyclomaticComplexity: 1 + (bodySlice.match(/\b(IF|WHILE|CASE|ELSEIF)\b/gi) || []).length,
                    issues: lines > 80 ? ['large-function'] : []
                });
            }
        }

        // Dependencies / References: FROM {table}, JOIN {table}, REFERENCES {table}
        const refPattern = /\b(?:FROM|JOIN|REFERENCES|INTO|UPDATE)\s+["`]?([A-Za-z0-9_]+)["`]?/gi;
        const keywords = new Set(['select', 'where', 'set', 'table', 'values', 'null', 'dual']);
        for (const match of source.matchAll(refPattern)) {
            const target = match[1];
            if (target && !keywords.has(target.toLowerCase())) {
                result.imports.push(target);
            }
        }

        // Calls: EXEC {proc}, CALL {proc}
        const callPattern = /\b(?:EXEC|EXECUTE|CALL)\s+["`]?([A-Za-z0-9_]+)["`]?/gi;
        for (const match of source.matchAll(callPattern)) {
            const callee = match[1];
            if (callee) {
                result.calls.push(['query', callee, getLine(match.index)]);
            }
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});
