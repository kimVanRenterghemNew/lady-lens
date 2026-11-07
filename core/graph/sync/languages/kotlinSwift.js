/**
 * Kotlin and Swift language configurations for the multi-language graph extractor.
 */

export const KOTLIN_CONFIG = Object.freeze({
    language: 'kotlin',
    extensions: ['.kt', '.kts'],
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /^\s*import\s+([A-Za-z0-9_.*]+)/gm,
    typePattern: /(?:(?:abstract|final|open|data|sealed|enum)\s+)*(class|interface|object)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:fun|suspend\s+fun)\s+(?:<[^>]*>\s+)?(?:[A-Za-z0-9_.]+\.)?([A-Za-z0-9_]+)\s*\(([^)]*)\))/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/@Test\b/, /class\s+[A-Za-z0-9_]*Test\b/],

    extractPurpose(source) {
        const kdoc = source.match(/\/\*\*([\s\S]*?)\*\//);
        if (kdoc) {
            return kdoc[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/[\\/]test[\\/]/i.test(filePath) || /Test\.kts?$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});

export const SWIFT_CONFIG = Object.freeze({
    language: 'swift',
    extensions: ['.swift'],
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /^\s*import\s+([A-Za-z0-9_]+)/gm,
    typePattern: /(?:(?:public|private|internal|fileprivate|open|final)\s+)*(class|struct|protocol|enum|extension|actor)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:func|mutating\s+func)\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\))/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/XCTestCase\b/, /func\s+test[A-Za-z0-9_]*\(\)/],

    extractPurpose(source) {
        const docComments = source.match(/^(?:\s*\/\/\/[^\n]*\n)+/);
        if (docComments) {
            return docComments[0].split('\n').map(l => l.replace(/^\s*\/\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/Tests?[\\/]/i.test(filePath) || /Tests\.swift$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
