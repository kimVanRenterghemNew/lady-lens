/**
 * C# language configuration for the multi-language graph extractor (Story 23.11).
 * Data-driven pattern definitions for classes, interfaces, records, methods, usings, and doc comments.
 */

export const CSHARP_CONFIG = Object.freeze({
    language: 'csharp',
    extensions: ['.cs'],
    importPattern: /^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm,
    typePattern: /(?:(?:public|internal|protected|private|static|sealed|abstract|partial)\s+)*(class|interface|struct|record|enum)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:public|internal|protected|private|static|virtual|override|async|abstract|sealed|partial)\s+)+([A-Za-z0-9_<>[\],.?\s]+?)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:where[^{]+)?\{/g,
    constructorPattern: /(?:(?:public|internal|protected|private)\s+)+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?::\s*(?:base|this)\([^)]*\)\s*)?\{/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/\[\s*(?:Test|Fact|TestMethod|Theory|TestCase)\b/, /\.(?:Unit)?Tests\b/i],

    extractPurpose(source) {
        const xmlDoc = source.match(/<summary>([\s\S]*?)<\/summary>/i);
        if (xmlDoc) {
            return xmlDoc[1].split('\n').map(l => l.replace(/^\s*\/\/\/?\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/\.(?:Unit)?Tests[\\/]/i.test(filePath) || /Test\.cs$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
