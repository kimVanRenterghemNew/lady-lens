/**
 * PHP language configuration for the multi-language graph extractor.
 * Supports classes, interfaces, traits, enums, functions, namespaces, and use statements.
 */

export const PHP_CONFIG = Object.freeze({
    language: 'php',
    extensions: ['.php'],
    commentPrefixes: ['//', '/*', '*', '#'],
    importPattern: /^\s*use\s+(?:function\s+)?([A-Za-z0-9_\\]+)\s*;/gm,
    typePattern: /(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/extends\s+(?:TestCase|PHPUnit_Framework_TestCase)/, /\b(?:setUp|tearDown|test[A-Z0-9_])/],

    extractPurpose(source) {
        const docMatch = source.match(/\/\*\*([\s\S]*?)\*\//);
        if (docMatch) {
            return docMatch[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:<\?php\s*\n)?(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].replace(/^<\?php\s*/, '').split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/[\\/]tests?[\\/]/i.test(filePath) || /Test\.php$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
