/**
 * Rust language configuration for the multi-language graph extractor.
 * Supports structs, enums, traits, impl blocks, functions, macros, and use statements.
 */

export const RUST_CONFIG = Object.freeze({
    language: 'rust',
    extensions: ['.rs'],
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /^\s*use\s+([A-Za-z0-9_:{}\s*,]+)\s*;/gm,
    typePattern: /(?:(?:pub(?:\([^)]*\))?\s+)?)(struct|enum|trait|union)\s+([A-Za-z0-9_]+)/g,
    methodPattern: /(?:(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern(?:\s+"[^"]+")?\s+)?)fn\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g,
    callPattern: /\b([A-Za-z0-9_]+)(?:!|\s*\()/g,
    testIndicators: [/#!?\[(?:cfg\()?(?:test|should_panic)/, /\bassert(?:_eq|_ne)?!/],

    extractPurpose(source) {
        // Module docs //! or item docs ///
        const modDoc = source.match(/^(?:\s*\/\/![^\n]*\n)+/);
        if (modDoc) {
            return modDoc[0].split('\n').map(l => l.replace(/^\s*\/\/!\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        const docComments = source.match(/^(?:\s*\/\/\/[^\n]*\n)+/);
        if (docComments) {
            return docComments[0].split('\n').map(l => l.replace(/^\s*\/\/\/\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/(?:^|[\\/])tests?[\\/]/i.test(filePath) || /_test\.rs$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
