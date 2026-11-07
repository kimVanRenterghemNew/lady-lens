/**
 * Ruby language configuration for the multi-language graph extractor.
 * Supports classes, modules, def methods, require, and require_relative.
 */

export const RUBY_CONFIG = Object.freeze({
    language: 'ruby',
    extensions: ['.rb'],
    commentPrefixes: ['#'],
    importPattern: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm,
    typePattern: /^\s*(class|module)\s+([A-Za-z0-9_:]+)/gm,
    methodPattern: /^\s*def\s+([A-Za-z0-9_!?=]+)\s*(?:\(([^)]*)\))?/gm,
    callPattern: /\b([A-Za-z0-9_!?]+)\s*\(/g,
    testIndicators: [/RSpec\.describe\b/, /\bdescribe\s+['"][^'"]+['"]\s+do/, /class\s+[A-Za-z0-9_]+\s*<\s*Test::Unit::TestCase/],

    extractPurpose(source) {
        const topComments = source.match(/^(?:\s*#[^\n]*\n)+/);
        if (topComments) {
            return topComments[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/(?:spec|test)s?[\\/]/i.test(filePath) || /_(?:spec|test)\.rb$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
