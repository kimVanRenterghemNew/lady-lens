/**
 * C and C++ language configuration for the multi-language graph extractor.
 * Supports .c, .cpp, .cc, .cxx, .h, and .hpp files, structs, classes, functions, and #include statements.
 */

export const CPP_CONFIG = Object.freeze({
    language: 'cpp',
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
    typeNameGroup: 1,
    methodNameGroup: 2,
    methodParamsGroup: 3,
    commentPrefixes: ['//', '/*', '*'],
    importPattern: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/gm,
    typePattern: /(?:class|struct|union|enum(?:\s+class)?)\s+([A-Za-z0-9_]+)(?:\s*:[^{]+)?\s*\{/g,
    methodPattern: /(?:(?:inline|static|virtual|explicit|constexpr|const|friend)\s+)*([A-Za-z0-9_<>:*&]+(?:::)?(?:[A-Za-z0-9_<>:*&]+)*)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:const)?\s*(?:noexcept)?\s*\{/g,
    callPattern: /\b([A-Za-z0-9_]+)\s*\(/g,
    testIndicators: [/\bTEST(?:_F|_P)?\s*\(/, /#include\s+<gtest\b/],

    extractPurpose(source) {
        const topComments = source.match(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\n)+/);
        if (topComments) {
            return topComments[0]
                .split('\n')
                .map(l => l.replace(/^\s*(?:\/\/|\/\*|\*|\*\/)\s?/, '').trim())
                .filter(Boolean)
                .join(' ')
                .slice(0, 240);
        }
        return '';
    },

    isTestFile(filePath, source) {
        if (/(?:test|spec)s?[\\/]/i.test(filePath) || /_(?:test|spec)\.(?:cpp|cc|cxx|c)$/i.test(filePath)) return true;
        return this.testIndicators.some(pattern => pattern.test(source));
    }
});
