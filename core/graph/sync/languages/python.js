/**
 * Python language configuration for the multi-language graph extractor.
 * Indentation-based parsing for classes, defs, async defs, imports, docstrings and calls.
 */

export const PYTHON_CONFIG = Object.freeze({
    language: 'python',
    extensions: ['.py'],
    commentPrefixes: ['#'],
    indentationBased: true,
    importPattern: /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import\s+[A-Za-z0-9_., ]+|import\s+([A-Za-z0-9_., ]+))\s*$/gm,
    typePattern: /^\s*class\s+([A-Za-z0-9_]+)(?:\s*\([^)]*\))?\s*:/gm,
    methodPattern: /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:->[^:]+)?\s*:/gm,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/^def test_/m, /import pytest\b/, /import unittest\b/, /class Test[A-Za-z0-9_]*\(/],

    extractPurpose(source) {
        // Docstrings at top: """...""" or '''...'''
        const docMatch = source.match(/^(?:\s*#[^\n]*\n)*\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
        if (docMatch) {
            const raw = docMatch[1] || docMatch[2] || '';
            return raw.split('\n').map(l => l.trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*#[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/([\\/]tests?[\\/]|test_[^\\/]+\.py$|[^\\/]+_test\.py$)/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
