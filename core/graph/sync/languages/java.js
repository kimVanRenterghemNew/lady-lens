/**
 * Java language configuration for the multi-language graph extractor.
 * Supports classes, interfaces, records, enums, methods, constructors, and imports.
 */

export const JAVA_CONFIG = Object.freeze({
    language: 'java',
    extensions: ['.java'],
    typeNameGroup: 2,
    methodNameGroup: 2,
    methodParamsGroup: 3,
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.*]+)\s*;/gm,
    typePattern: /(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(class|interface|enum|record)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)+([A-Za-z0-9_<>[\],.?\s]+?)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:throws[^{]+)?\{/g,
    constructorPattern: /(?:(?:public|protected|private)\s+)+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:throws[^{]+)?\{/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/@(?:Test|ParameterizedTest|RepeatedTest)\b/, /import\s+org\.junit\b/],

    extractPurpose(source) {
        const javadoc = source.match(/\/\*\*([\s\S]*?)\*\//);
        if (javadoc) {
            return javadoc[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/[\\/]src[\\/]test[\\/]/i.test(filePath) || /(?:Test|Tests|TestCase)\.java$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
