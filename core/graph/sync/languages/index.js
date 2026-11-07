/**
 * Multi-language graph registry and detection (Story 23.11, inspired by graphify/detect.py).
 * Centralized, data-driven file type classification and language dispatch for top 10+ languages,
 * web files, database scripts, containers, and infrastructure.
 */
import path from 'path';
import { extractWithConfig } from './engine.js';
import { JAVASCRIPT_CONFIG } from './javascript.js';
import { CSHARP_CONFIG } from './csharp.js';
import { PYTHON_CONFIG } from './python.js';
import { TYPESCRIPT_CONFIG } from './typescript.js';
import { JAVA_CONFIG } from './java.js';
import { CPP_CONFIG } from './cpp.js';
import { GO_CONFIG } from './go.js';
import { RUST_CONFIG } from './rust.js';
import { PHP_CONFIG } from './php.js';
import { RUBY_CONFIG } from './ruby.js';
import { KOTLIN_CONFIG, SWIFT_CONFIG } from './kotlinSwift.js';
import { SQL_CONFIG } from './sql.js';
import { CSS_CONFIG, HTML_CONFIG } from './web.js';
import { DOCKER_CONFIG } from './docker.js';
import { POWERSHELL_CONFIG, BASH_CONFIG, BATCH_CONFIG } from './shell.js';
import { YAML_CONFIG, TOML_CONFIG, TERRAFORM_CONFIG, JSON_CONFIG } from './infra.js';

export const CODE_EXTENSIONS = new Set([
    // JavaScript & TypeScript
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    // C# & .NET
    '.cs',
    // Python
    '.py',
    // Java & JVM
    '.java', '.kt', '.kts', '.scala',
    // C / C++
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
    // Go & Rust
    '.go', '.rs',
    // Web backend
    '.php', '.rb',
    // Mobile
    '.swift',
    // Database & Queries
    '.sql',
    // Web frontend styling & markup
    '.css', '.scss', '.less', '.html', '.htm',
    // Shell & Scripting
    '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
    // Containers & Infra
    '.dockerfile',
    // Infrastructure as Code
    '.yaml', '.yml', '.toml', '.tf', '.json'
]);

export const DOC_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.rst'
]);

export const CONFIG_EXTENSIONS = new Set([
    '.csproj', '.sln', '.props', '.targets',
    '.xml', '.ini'
]);

const CONFIGS_BY_EXT = new Map();
const ALL_CONFIGS = [];

export function registerLanguageConfig(config) {
    ALL_CONFIGS.push(config);
    for (const ext of config.extensions || []) {
        const normalized = ext.toLowerCase();
        CONFIGS_BY_EXT.set(normalized, config);
        CODE_EXTENSIONS.add(normalized);
    }
}

// Register Top 10 + Web + SQL + Containers + Scripting + Infrastructure
registerLanguageConfig(CSHARP_CONFIG);
registerLanguageConfig(JAVASCRIPT_CONFIG);
registerLanguageConfig(PYTHON_CONFIG);
registerLanguageConfig(TYPESCRIPT_CONFIG);
registerLanguageConfig(JAVA_CONFIG);
registerLanguageConfig(CPP_CONFIG);
registerLanguageConfig(GO_CONFIG);
registerLanguageConfig(RUST_CONFIG);
registerLanguageConfig(PHP_CONFIG);
registerLanguageConfig(RUBY_CONFIG);
registerLanguageConfig(KOTLIN_CONFIG);
registerLanguageConfig(SWIFT_CONFIG);
registerLanguageConfig(SQL_CONFIG);
registerLanguageConfig(CSS_CONFIG);
registerLanguageConfig(HTML_CONFIG);
registerLanguageConfig(DOCKER_CONFIG);
registerLanguageConfig(POWERSHELL_CONFIG);
registerLanguageConfig(BASH_CONFIG);
registerLanguageConfig(BATCH_CONFIG);
// Infrastructure as Code
registerLanguageConfig(YAML_CONFIG);
registerLanguageConfig(TOML_CONFIG);
registerLanguageConfig(TERRAFORM_CONFIG);
registerLanguageConfig(JSON_CONFIG);

export function isCodeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') return path.basename(filePath).toLowerCase() === 'package.json';
    if (CODE_EXTENSIONS.has(ext)) return true;
    const base = path.basename(filePath).toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) return true;
    return false;
}

export function isDocFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return DOC_EXTENSIONS.has(ext);
}

export function isConfigFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (CONFIG_EXTENSIONS.has(ext) || ['.yaml', '.yml', '.toml'].includes(ext)) return true;
    const base = path.basename(filePath).toLowerCase();
    // These are now handled by code parsers (YAML_CONFIG, JSON_CONFIG, DOCKER_CONFIG)
    return base === 'package.json' || base === 'packages.reference' || base === 'docker-compose.yml' || base === 'docker-compose.yaml';
}

export function configForExtension(extOrPath) {
    const ext = extOrPath.startsWith('.') ? extOrPath.toLowerCase() : path.extname(extOrPath).toLowerCase();
    // First check custom matchesFile for all configs (to handle special cases like docker-compose.yml)
    for (const cfg of ALL_CONFIGS) {
        if (typeof cfg.matchesFile === 'function' && cfg.matchesFile(extOrPath)) {
            return cfg;
        }
    }
    // Then check by extension
    if (ext && CONFIGS_BY_EXT.has(ext)) {
        return CONFIGS_BY_EXT.get(ext);
    }
    return null;
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

export {
    extractWithConfig,
    JAVASCRIPT_CONFIG,
    CSHARP_CONFIG,
    PYTHON_CONFIG,
    TYPESCRIPT_CONFIG,
    JAVA_CONFIG,
    CPP_CONFIG,
    GO_CONFIG,
    RUST_CONFIG,
    PHP_CONFIG,
    RUBY_CONFIG,
    KOTLIN_CONFIG,
    SWIFT_CONFIG,
    SQL_CONFIG,
    CSS_CONFIG,
    HTML_CONFIG,
    DOCKER_CONFIG,
    POWERSHELL_CONFIG,
    BASH_CONFIG,
    BATCH_CONFIG,
    // Infrastructure as Code
    YAML_CONFIG,
    TOML_CONFIG,
    TERRAFORM_CONFIG,
    JSON_CONFIG
};
