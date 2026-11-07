export const JAVASCRIPT_CONFIG = Object.freeze({
    language: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    isTestFile(filePath) {
        return /\.(?:test|spec|ablation)\.[cm]?js$/i.test(filePath) || /(^|[\\/])test[\\/]/i.test(filePath);
    }
});