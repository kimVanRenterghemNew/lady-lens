/**
 * Shell, PowerShell and Batch scripting language configurations for the multi-language graph extractor.
 * Supports .ps1, .psm1, .psd1, .sh, .bash, .zsh, .bat, .cmd.
 */
import { buildLineOffsets, lineAt, findBlockEnd } from './engine.js';

export const POWERSHELL_CONFIG = Object.freeze({
    language: 'powershell',
    extensions: ['.ps1', '.psm1', '.psd1'],
    commentPrefixes: ['#', '<#'],

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

        // Comment-based help: <# ... .SYNOPSIS ... #> or # header
        const blockHelp = source.match(/<#([\s\S]*?)#>/);
        if (blockHelp) {
            const synopsis = blockHelp[1].match(/\.SYNOPSIS\s+([\s\S]*?)(?=\.[A-Z]+|\s*$)/i);
            result.purpose = (synopsis ? synopsis[1] : blockHelp[1]).split('\n').map(l => l.trim()).filter(Boolean).join(' ').slice(0, 240);
        } else {
            const topComments = source.match(/^(?:\s*#[^\n]*\n)+/);
            if (topComments) {
                result.purpose = topComments[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
            }
        }

        // Imports / Modules: using module ..., Import-Module ...
        const modPattern = /^\s*(?:using\s+module\s+['"]?([^'"\r\n]+)['"]?|Import-Module\s+['"]?([^'"\s]+)['"]?)/gm;
        for (const match of source.matchAll(modPattern)) {
            const mod = match[1] || match[2];
            if (mod) result.imports.push(mod);
        }

        // Functions / Filters / Workflows: function Name { ... }
        const fnPattern = /^\s*(?:function|filter|workflow)\s+([A-Za-z0-9_:-]+)\s*(?:\([^)]*\))?\s*\{/gm;
        for (const match of source.matchAll(fnPattern)) {
            const name = match[1];
            const startLine = getLine(match.index);
            const openBrace = source.indexOf('{', match.index);
            const endLine = openBrace !== -1 ? getLine(findBlockEnd(source, openBrace)) : startLine;

            result.symbols.push(name);
            result.exports.push(name);
            result.symbolRanges[name] = [startLine, endLine];

            const bodySlice = openBrace !== -1 ? source.slice(openBrace, source.indexOf('}', openBrace) + 1) : '';
            const lines = endLine - startLine + 1;
            result.functions.push({
                name,
                loc: [startLine, endLine],
                lines,
                params: (bodySlice.match(/\$[A-Za-z0-9_]+/g) || []).length,
                cyclomaticComplexity: 1 + (bodySlice.match(/\b(if|while|foreach|switch|catch)\b/gi) || []).length,
                issues: lines > 80 ? ['large-function'] : []
            });
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});

export const BASH_CONFIG = Object.freeze({
    language: 'bash',
    extensions: ['.sh', '.bash', '.zsh'],
    commentPrefixes: ['#'],

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

        // Header comments after shebang
        const topComments = source.replace(/^#![^\n]*\n/, '').match(/^(?:\s*#[^\n]*\n)+/);
        if (topComments) {
            result.purpose = topComments[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }

        // Sourced scripts: source foo.sh or . foo.sh
        const sourcePattern = /^\s*(?:source|\.)\s+['"]?([^'"\s]+)['"]?/gm;
        for (const match of source.matchAll(sourcePattern)) {
            if (match[1]) result.imports.push(match[1]);
        }

        // Functions: function name { ... } or name() { ... }
        const fnPattern = /^\s*(?:function\s+([A-Za-z0-9_-]+)(?:\s*\(\))?|([A-Za-z0-9_-]+)\s*\(\))\s*\{/gm;
        for (const match of source.matchAll(fnPattern)) {
            const name = match[1] || match[2];
            const startLine = getLine(match.index);
            const openBrace = source.indexOf('{', match.index);
            const endLine = openBrace !== -1 ? getLine(findBlockEnd(source, openBrace)) : startLine;

            result.symbols.push(name);
            result.exports.push(name);
            result.symbolRanges[name] = [startLine, endLine];

            const lines = endLine - startLine + 1;
            result.functions.push({
                name,
                loc: [startLine, endLine],
                lines,
                params: 0,
                cyclomaticComplexity: 1,
                issues: lines > 80 ? ['large-function'] : []
            });
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});

export const BATCH_CONFIG = Object.freeze({
    language: 'batch',
    extensions: ['.bat', '.cmd'],
    commentPrefixes: ['::', 'REM', 'rem'],

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

        // Header comments :: or REM
        const topComments = source.match(/^(?:\s*(?:::|REM|rem)[^\n]*\n)+/i);
        if (topComments) {
            result.purpose = topComments[0].split('\n').map(l => l.replace(/^\s*(?:::|REM|rem)\s?/i, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }

        // Labels: :label
        const labelPattern = /^\s*:([A-Za-z0-9_-]+)/gm;
        for (const match of source.matchAll(labelPattern)) {
            const name = match[1];
            if (name && !name.startsWith(':')) {
                const line = getLine(match.index);
                result.symbols.push(name);
                result.exports.push(name);
                result.symbolRanges[name] = [line, line];
            }
        }

        // Calls: call :label or call script.bat
        const callPattern = /^\s*call\s+[:]?([A-Za-z0-9_.-]+)/gim;
        for (const match of source.matchAll(callPattern)) {
            if (match[1]) result.calls.push(['batch', match[1], getLine(match.index)]);
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];

        return result;
    }
});
