/**
 * Go language configuration for the multi-language graph extractor.
 * Supports structs, interfaces, functions, receiver methods, and imports.
 */

export const GO_CONFIG = Object.freeze({
    language: 'go',
    extensions: ['.go'],
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /(?:^\s*import\s+["']([^"']+)["']|^\s*import\s+\(([\s\S]*?)\))/gm,
    typePattern: /^\s*type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)\b/gm,
    methodPattern: /^\s*func\s+(?:\((?:[^)]+)\)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/func Test[A-Za-z0-9_]*\(\s*t\s+\*testing\.T\)/, /_test\.go$/],

    extractPurpose(source) {
        // Top package doc comment
        const packageDoc = source.match(/^(?:\s*\/\/[^\n]*\n)+(?=\s*package\b)/);
        if (packageDoc) {
            return packageDoc[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/_test\.go$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
