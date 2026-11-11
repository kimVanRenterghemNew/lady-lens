/**
 * TOML language configuration for project graph facts.
 * @module core/graph/sync/languages/tomlConfig
 */

const emptyResult = () => ({ purpose: '', exports: [], symbols: [], symbolRanges: {}, imports: [], calls: [], functions: [], parseError: null });

const unique = (result) => {
    result.symbols = [...new Set(result.symbols)];
    result.exports = [...new Set(result.exports)];
    result.imports = [...new Set(result.imports)];
    return result;
};

function processTomlTable(line, index, result) {
    const table = line.match(/^\[([^\]]+)\]/)?.[1];
    if (!table) return false;
    result.symbols.push(table);
    result.exports.push(table);
    result.symbolRanges[table] = [index + 1, index + 1];
    return true;
}

function processTomlProperty(line, index, result) {
    const pair = line.match(/^([A-Za-z0-9_]+)\s*=(.+)/);
    if (!pair) return;
    const key = pair[1].trim();
    const value = pair[2].trim();
    result.symbols.push(key);
    result.symbolRanges[key] = [index + 1, index + 1];
    const clean = value.replace(/^['"]|['"]$/g, '');
    if (clean.includes('/') || clean.startsWith('http')) result.imports.push(clean);
}

const processTomlLine = (line, index, result) => {
    if (processTomlTable(line, index, result)) return;
    processTomlProperty(line, index, result);
};

export const TOML_CONFIG = Object.freeze({
    language: 'toml',
    extensions: ['.toml'],
    commentPrefixes: ['#'],
    extract(source) {
        const result = emptyResult();
        const top = source.match(/^\s*#[^\n]*/);
        if (top) result.purpose = top[0].replace(/^\s*#\s?/, '').trim();
        source.split('\n').forEach((raw, index) => {
            const line = raw.trim();
            if (line && !line.startsWith('#')) processTomlLine(line, index, result);
        });
        return unique(result);
    }
});
