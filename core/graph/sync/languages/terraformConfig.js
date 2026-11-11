/**
 * Terraform language configuration for project graph facts.
 * @module core/graph/sync/languages/terraformConfig
 */

const emptyResult = () => ({ purpose: '', exports: [], symbols: [], symbolRanges: {}, imports: [], calls: [], functions: [], parseError: null });

const unique = (result) => {
    result.symbols = [...new Set(result.symbols)];
    result.exports = [...new Set(result.exports)];
    result.imports = [...new Set(result.imports)];
    return result;
};

const TF_EXPORT_BLOCKS = new Set(['resource', 'module', 'output']);

function processTerraformBlock(line, index, result) {
    const block = line.match(/^(\w+)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/);
    if (!block) return false;
    const name = block[3] || block[2];
    result.symbols.push(name);
    result.symbolRanges[name] = [index + 1, index + 1];
    if (block[1] === 'resource') result.symbols.push(`${block[1]}:${block[2]}:${name}`);
    if (TF_EXPORT_BLOCKS.has(block[1])) result.exports.push(name);
    return true;
}

function extractTerraformImports(line, result) {
    const provider = line.match(/^provider\s+"([^"]+)"/)?.[1];
    if (provider) result.imports.push(provider);
    const sourceValue = line.match(/^source\s*=\s*["']([^"']+)/)?.[1];
    if (sourceValue) result.imports.push(sourceValue);
}

function extractTerraformCalls(line, index, result) {
    const call = line.match(/\$\{([A-Za-z0-9_]+)\s*\(/)?.[1];
    if (call) result.calls.push(['terraform', call, index + 1]);
}

function processTerraformDirectives(line, index, result) {
    extractTerraformImports(line, result);
    extractTerraformCalls(line, index, result);
}

const processTerraformLine = (line, index, result) => {
    if (processTerraformBlock(line, index, result)) return;
    processTerraformDirectives(line, index, result);
};

export const TERRAFORM_CONFIG = Object.freeze({
    language: 'terraform',
    extensions: ['.tf'],
    commentPrefixes: ['#', '//'],
    extract(source) {
        const result = emptyResult();
        const top = source.match(/^\s*(?:#|\/\/)[^\n]*/);
        if (top) result.purpose = top[0].replace(/^\s*(?:#|\/\/)\s?/, '').trim();
        source.split('\n').forEach((raw, index) => {
            const line = raw.trim();
            if (line && !line.startsWith('#') && !line.startsWith('//')) {
                processTerraformLine(line, index, result);
            }
        });
        return unique(result);
    }
});
