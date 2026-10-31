/**
 * Multi-language graph registry and detection (Story 23.11, inspired by graphify/detect.py).
 * Centralized, data-driven file type classification and language dispatch.
 */
import path from 'path';
import { extractWithConfig } from './engine.js';
import { CSHARP_CONFIG } from './csharp.js';

export const CODE_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    '.cs',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.scala',
    '.lua',
    '.sh', '.bash',
    '.sql', '.ps1'
]);

export const DOC_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.rst', '.html'
]);

export const CONFIG_EXTENSIONS = new Set([
    '.yaml', '.yml',
    '.csproj', '.sln', '.props', '.targets',
    '.xml', '.toml', '.ini'
]);

const CONFIGS_BY_EXT = new Map();

export function registerLanguageConfig(config) {
    for (const ext of config.extensions || []) {
        const normalized = ext.toLowerCase();
        CONFIGS_BY_EXT.set(normalized, config);
        CODE_EXTENSIONS.add(normalized);
    }
}

registerLanguageConfig(CSHARP_CONFIG);

export function isCodeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
}

export function isDocFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return DOC_EXTENSIONS.has(ext);
}

export function isConfigFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (CONFIG_EXTENSIONS.has(ext)) return true;
    const base = path.basename(filePath).toLowerCase();
    return base === 'package.json';
}

export function configForExtension(extOrPath) {
    const ext = extOrPath.startsWith('.') ? extOrPath.toLowerCase() : path.extname(extOrPath).toLowerCase();
    return CONFIGS_BY_EXT.get(ext) || null;
}

export function isLanguageSupported(extOrPath) {
    return Boolean(configForExtension(extOrPath));
}

export function analyzeSourceForLanguage(source, extOrPath) {
    const config = configForExtension(extOrPath);
    if (!config) {
        return {
            purpose: '',
            exports: [],
            symbols: [],
            symbolRanges: {},
            imports: [],
            calls: [],
            functions: [],
            parseError: null
        };
    }
    return extractWithConfig(source, config, extOrPath);
}

export { extractWithConfig, CSHARP_CONFIG };
