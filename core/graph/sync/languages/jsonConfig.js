/**
 * JSON language configuration for project graph facts.
 * @module core/graph/sync/languages/jsonConfig
 */

const emptyResult = () => ({ purpose: '', exports: [], symbols: [], symbolRanges: {}, imports: [], calls: [], functions: [], parseError: null });

const unique = (result) => {
    result.symbols = [...new Set(result.symbols)];
    result.exports = [...new Set(result.exports)];
    result.imports = [...new Set(result.imports)];
    return result;
};

const safeJsonParse = (source) => {
    try {
        return { data: JSON.parse(source), error: null };
    } catch (error) {
        return { data: null, error: error.message };
    }
};

const GROUPS = ['dependencies', 'devDependencies', 'peerDependencies', 'providers'];

function extractJsonScripts(scripts, result) {
    for (const name of Object.keys(scripts)) {
        result.symbols.push(name);
        result.exports.push(name);
        result.functions.push({ name, loc: [1, 1], lines: 1, params: 0, cyclomaticComplexity: 1, issues: [] });
    }
}

function extractJsonMetadata(json, result) {
    for (const key of Object.keys(json)) {
        result.symbols.push(key);
        result.exports.push(key);
        result.symbolRanges[key] = [1, 1];
    }
    if (json.name) result.symbols.push(json.name);
    if (json.version) result.symbols.push(`v${json.version}`);
}

function extractJsonDependencies(json, result) {
    const groupImports = GROUPS.flatMap(group => Object.keys(json[group] || {}));
    result.imports.push(...groupImports);
}

function extractJsonFacts(json, result) {
    if (!json || typeof json !== 'object') return;
    extractJsonMetadata(json, result);
    extractJsonDependencies(json, result);
    if (json.scripts) extractJsonScripts(json.scripts, result);
}

export const JSON_CONFIG = Object.freeze({
    language: 'json',
    extensions: ['.json'],
    commentPrefixes: [],
    matchesFile(filePath) {
        const base = filePath.toLowerCase().split(/[\\/]/).pop();
        return /^(package|tsconfig|webpack\.config|babel\.config|composer|\.eslintrc|\.prettierrc|package-lock|docker-compose|kustomization|cdk|sst\.config|wrangler|netlify|vercel|firebase|nuxt\.config|next\.config|vite\.config|angular|capacitor\.config|ionic\.config)\.json$/.test(base);
    },
    extract(source) {
        const result = emptyResult();
        const { data, error } = safeJsonParse(source);
        if (error) {
            result.parseError = error;
            return unique(result);
        }
        extractJsonFacts(data, result);
        return unique(result);
    }
});
