import path from 'path';
import { buildLineOffsets, lineAt } from './engine.js';

const emptyResult = () => ({ purpose: '', exports: [], symbols: [], symbolRanges: {}, imports: [], calls: [], functions: [], parseError: null });
const unique = result => {
    result.symbols = [...new Set(result.symbols)];
    result.exports = [...new Set(result.exports)];
    result.imports = [...new Set(result.imports)];
    return result;
};

export const YAML_CONFIG = Object.freeze({
    language: 'yaml', extensions: ['.yaml', '.yml'], commentPrefixes: ['#'],
    matchesFile(filePath) {
        const base = path.basename(filePath).toLowerCase();
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.yaml' && ext !== '.yml') return false;
        return !['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(base);
    },
    extract(source) {
        const result = emptyResult();
        const lines = source.split('\n');
        const isK8s = source.includes('apiVersion:') && source.includes('kind:');
        const isAnsible = /(?:hosts|tasks|plays):/.test(source);
        const isServerless = source.includes('service:') && source.includes('provider:');
        const offsets = buildLineOffsets(source);
        const top = source.match(/^(?:\s*#[^\n]*\n)+/);
        if (top) result.purpose = top[0].split('\n').map(line => line.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i], trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const indent = (line.match(/^[ \t]*/) || [''])[0].length;
            const key = trimmed.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1];
            if (indent === 0 && key && !trimmed.startsWith('-')) {
                result.symbols.push(key); result.exports.push(key); result.symbolRanges[key] = [i + 1, i + 1];
                if (isK8s && key === 'kind') { const value = trimmed.match(/kind:\s*([A-Za-z0-9]+)/)?.[1]; if (value) result.symbols.push(value); }
                if (isK8s && key === 'metadata') { const name = lines[i + 1]?.match(/^\s+name:\s*([A-Za-z0-9_-]+)/)?.[1]; if (name) result.symbols.push(name); }
            }
            if (indent === 2 && isK8s && key && !trimmed.startsWith('-')) result.symbols.push(key);
            if (trimmed.startsWith('- ') && !trimmed.startsWith('- #')) {
                const item = trimmed.slice(2).trim();
                if (isAnsible && indent === 2 && lines[i - 1]?.trim() === 'tasks:') result.symbols.push(item);
                if (item.includes(':') || item.includes('/')) result.imports.push(item);
            }
            const image = trimmed.match(/image:\s*['"]?([A-Za-z0-9_./:-]+)/)?.[1];
            if (image) result.imports.push(image);
            const container = indent > 0 ? trimmed.match(/name:\s*['"]?([A-Za-z0-9_-]+)/)?.[1] : null;
            if (container) result.symbols.push(container);
            if (isAnsible) {
                const role = trimmed.match(/^\s*-\s*(?:\{role:\s*)?['"]?([A-Za-z0-9_-]+)/)?.[1];
                if (role) result.imports.push(role);
                const hosts = trimmed.match(/^\s*(?:-\s*)?(?:hosts|inventory):\s*([A-Za-z0-9_\-,\s]+)/)?.[1];
                if (hosts) result.imports.push(...hosts.split(',').map(host => host.trim()).filter(Boolean));
            }
            if (isServerless && trimmed === 'functions:') for (let j = i + 1; j < lines.length && lines[j].trim(); j++) { const fn = lines[j].match(/^\s+([A-Za-z0-9_-]+):\s*$/)?.[1]; if (fn) { result.symbols.push(fn); result.exports.push(fn); } }
        }
        for (const match of source.matchAll(/containerPort:\s*([0-9]+)/g)) { const name = `port:${match[1]}`; result.symbols.push(name); const line = lineAt(source, match.index, offsets); result.symbolRanges[name] = [line, line]; }
        return unique(result);
    }
});

export const TOML_CONFIG = Object.freeze({
    language: 'toml', extensions: ['.toml'], commentPrefixes: ['#'],
    extract(source) {
        const result = emptyResult();
        const top = source.match(/^\s*#[^\n]*/);
        if (top) result.purpose = top[0].replace(/^\s*#\s?/, '').trim();
        for (const [index, raw] of source.split('\n').entries()) {
            const line = raw.trim(); if (!line || line.startsWith('#')) continue;
            const table = line.match(/^\[([^\]]+)\]/)?.[1];
            if (table) { result.symbols.push(table); result.exports.push(table); result.symbolRanges[table] = [index + 1, index + 1]; continue; }
            const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)/); if (!pair) continue;
            const value = pair[2].trim(); result.symbols.push(pair[1]); result.symbolRanges[pair[1]] = [index + 1, index + 1];
            const clean = value.replace(/^['"]|['"]$/g, ''); if (clean.includes('/') || clean.startsWith('http')) result.imports.push(clean);
        }
        return unique(result);
    }
});

export const TERRAFORM_CONFIG = Object.freeze({
    language: 'terraform', extensions: ['.tf'], commentPrefixes: ['#', '//'],
    extract(source) {
        const result = emptyResult();
        const top = source.match(/^\s*(?:#|\/\/)[^\n]*/);
        if (top) result.purpose = top[0].replace(/^\s*(?:#|\/\/)\s?/, '').trim();
        for (const [index, raw] of source.split('\n').entries()) {
            const line = raw.trim(); if (!line || line.startsWith('#') || line.startsWith('//')) continue;
            const block = line.match(/^(\w+)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/);
            if (block) { const name = block[3] || block[2]; result.symbols.push(name); result.symbolRanges[name] = [index + 1, index + 1]; if (block[1] === 'resource') result.symbols.push(`${block[1]}:${block[2]}:${name}`); if (['resource', 'module', 'output'].includes(block[1])) result.exports.push(name); continue; }
            const provider = line.match(/^provider\s+"([^"]+)"/)?.[1]; if (provider) result.imports.push(provider);
            const sourceValue = line.match(/^source\s*=\s*["']([^"']+)/)?.[1]; if (sourceValue) result.imports.push(sourceValue);
            const call = line.match(/\$\{([A-Za-z0-9_]+)\s*\(/)?.[1]; if (call) result.calls.push(['terraform', call, index + 1]);
        }
        return unique(result);
    }
});

export const JSON_CONFIG = Object.freeze({
    language: 'json', extensions: ['.json'], commentPrefixes: [],
    matchesFile(filePath) {
        const base = filePath.toLowerCase().split(/[\\/]/).pop();
        return /^(package|tsconfig|webpack\.config|babel\.config|composer|\.eslintrc|\.prettierrc|package-lock|docker-compose|kustomization|cdk|sst\.config|wrangler|netlify|vercel|firebase|nuxt\.config|next\.config|vite\.config|angular|capacitor\.config|ionic\.config)\.json$/.test(base);
    },
    extract(source) {
        const result = emptyResult();
        try {
            const json = JSON.parse(source);
            for (const key of Object.keys(json || {})) { result.symbols.push(key); result.exports.push(key); result.symbolRanges[key] = [1, 1]; }
            if (json?.name) result.symbols.push(json.name);
            if (json?.version) result.symbols.push(`v${json.version}`);
            for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'providers']) if (json?.[group]) result.imports.push(...Object.keys(json[group]));
            if (json?.scripts) for (const name of Object.keys(json.scripts)) { result.symbols.push(name); result.exports.push(name); result.functions.push({ name, loc: [1, 1], lines: 1, params: 0, cyclomaticComplexity: 1, issues: [] }); }
        } catch (error) { result.parseError = error.message; }
        return unique(result);
    }
});