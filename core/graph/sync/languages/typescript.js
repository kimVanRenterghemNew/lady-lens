/**
 * TypeScript language configuration for the multi-language graph extractor.
 * Supports .ts and .tsx files, interfaces, type aliases, classes, functions, and JSX components.
 */

export const TYPESCRIPT_CONFIG = Object.freeze({
    language: 'typescript',
    extensions: ['.ts', '.tsx'],
    commentPrefixes: ['//', '/*', '*'],
    typeNameGroup: 2,
    importPattern: /^\s*import\s+(?:(?:type\s+)?(?:[A-Za-z0-9_{}\s*,]+)\s+from\s+)?['"]([^'"]+)['"]/gm,
    typePattern: /(?:(?:export\s+)?(?:default\s+)?(?:abstract\s+)?)(class|interface|type|enum)\s+([A-Za-z0-9_]+)/g,
    methodPatterns: [
        /(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\))/g,
        /(?:(?:public|private|protected|static|readonly|async)\s+)+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g,
        /(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z0-9_]+))\s*(?::\s*[^=]+)?=>/g
    ],
    constructorPattern: /(?:(?:public|private|protected)\s+)?constructor\s*\(([^)]*)\)\s*\{/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g,
    testIndicators: [/\.(?:test|spec)\.tsx?$/i, /\b(?:describe|it|test|expect)\s*\(/],

    extractPurpose(source) {
        const doc = source.match(/\/\*\*([\s\S]*?)\*\//);
        if (doc) {
            return doc[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const topComments = source.match(/^(?:\s*\/\/[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/\.(?:test|spec)\.tsx?$/i.test(filePath) || /[\\/](?:__tests__|tests?)[\\/]/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
