import path from 'path';
import { buildLineOffsets, lineAt } from './engine.js';

export { JSON_CONFIG } from './jsonConfig.js';
export { TERRAFORM_CONFIG } from './terraformConfig.js';
export { TOML_CONFIG } from './tomlConfig.js';

const emptyResult = () => ({ purpose: '', exports: [], symbols: [], symbolRanges: {}, imports: [], calls: [], functions: [], parseError: null });

const unique = (result) => {
    result.symbols = [...new Set(result.symbols)];
    result.exports = [...new Set(result.exports)];
    result.imports = [...new Set(result.imports)];
    return result;
};

function checkK8sKind(key, trimmed, result) {
    if (key !== 'kind') return;
    const kindMatch = trimmed.match(/kind:\s*([A-Za-z0-9]+)/)?.[1];
    if (kindMatch) result.symbols.push(kindMatch);
}

function checkK8sMetadata(key, nextLine, result) {
    if (key !== 'metadata') return;
    const metaMatch = nextLine?.match(/^\s+name:\s*([A-Za-z0-9_-]+)/)?.[1];
    if (metaMatch) result.symbols.push(metaMatch);
}

function processK8sRoot(key, trimmed, nextLine, result) {
    checkK8sKind(key, trimmed, result);
    checkK8sMetadata(key, nextLine, result);
}

function extractAnsibleRole(trimmed, result) {
    const role = trimmed.match(/^\s*-\s*(?:\{role:\s*)?['"]?([A-Za-z0-9_-]+)/)?.[1];
    if (role) result.imports.push(role);
}

function extractAnsibleHosts(trimmed, result) {
    const hosts = trimmed.match(/^\s*(?:-\s*)?(?:hosts|inventory):\s*([A-Za-z0-9_\-,\s]+)/)?.[1];
    if (hosts) result.imports.push(...hosts.split(',').map(h => h.trim()).filter(Boolean));
}

const processAnsibleLine = (trimmed, result) => {
    extractAnsibleRole(trimmed, result);
    extractAnsibleHosts(trimmed, result);
};

const extractServerlessFunctions = (lines, startIndex, result) => {
    for (const raw of lines.slice(startIndex + 1)) {
        if (!raw.trim()) break;
        const fn = raw.match(/^\s+([A-Za-z0-9_-]+):\s*$/)?.[1];
        if (fn) {
            result.symbols.push(fn);
            result.exports.push(fn);
        }
    }
};

function isAnsibleTask(indent, prevLine) {
    return indent === 2 && prevLine?.trim() === 'tasks:';
}

const processYamlItem = (trimmed, indent, prevLine, isAnsible, result) => {
    const item = trimmed.slice(2).trim();
    if (isAnsible && isAnsibleTask(indent, prevLine)) result.symbols.push(item);
    if (item.includes(':') || item.includes('/')) result.imports.push(item);
};

function recordRootKey(key, trimmed, nextLine, i, isK8s, result) {
    result.symbols.push(key);
    result.exports.push(key);
    result.symbolRanges[key] = [i + 1, i + 1];
    if (isK8s) processK8sRoot(key, trimmed, nextLine, result);
}

function extractYamlKey(trimmed) {
    if (trimmed.startsWith('-')) return null;
    return trimmed.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1] || null;
}

function processYamlKey(trimmed, indent, i, lines, isK8s, result) {
    const key = extractYamlKey(trimmed);
    if (!key) return;
    if (indent === 0) recordRootKey(key, trimmed, lines[i + 1], i, isK8s, result);
    if (indent === 2 && isK8s) result.symbols.push(key);
}

function extractContainerName(trimmed, indent) {
    if (indent <= 0) return null;
    return trimmed.match(/name:\s*['"]?([A-Za-z0-9_-]+)/)?.[1];
}

function processYamlReferences(trimmed, indent, result) {
    const image = trimmed.match(/image:\s*['"]?([A-Za-z0-9_./:-]+)/)?.[1];
    if (image) result.imports.push(image);
    const container = extractContainerName(trimmed, indent);
    if (container) result.symbols.push(container);
}

function processYamlListItem(trimmed, indent, prevLine, isAnsible, result) {
    if (trimmed.startsWith('- ') && !trimmed.startsWith('- #')) {
        processYamlItem(trimmed, indent, prevLine, isAnsible, result);
    }
}

function processYamlContext(trimmed, i, lines, flags, result) {
    if (flags.isAnsible) processAnsibleLine(trimmed, result);
    if (flags.isServerless && trimmed === 'functions:') extractServerlessFunctions(lines, i, result);
}

function isYamlCommentOrBlank(trimmed) {
    return !trimmed || trimmed.startsWith('#');
}

function processYamlLine(line, i, lines, flags, result) {
    const trimmed = line.trim();
    if (isYamlCommentOrBlank(trimmed)) return;
    const indent = (line.match(/^[ \t]*/) || [''])[0].length;
    processYamlKey(trimmed, indent, i, lines, flags.isK8s, result);
    processYamlListItem(trimmed, indent, lines[i - 1], flags.isAnsible, result);
    processYamlReferences(trimmed, indent, result);
    processYamlContext(trimmed, i, lines, flags, result);
}

function extractContainerPorts(source, offsets, result) {
    for (const match of source.matchAll(/containerPort:\s*([0-9]+)/g)) {
        const name = `port:${match[1]}`;
        result.symbols.push(name);
        const line = lineAt(source, match.index, offsets);
        result.symbolRanges[name] = [line, line];
    }
}

function extractYamlPurpose(source, result) {
    const top = source.match(/^(?:\s*#[^\n]*\n)+/);
    if (top) {
        result.purpose = top[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
    }
}

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
        const flags = {
            isK8s: source.includes('apiVersion:') && source.includes('kind:'),
            isAnsible: /(?:hosts|tasks|plays):/.test(source),
            isServerless: source.includes('service:') && source.includes('provider:')
        };
        const offsets = buildLineOffsets(source);
        extractYamlPurpose(source, result);
        lines.forEach((line, i) => processYamlLine(line, i, lines, flags, result));
        extractContainerPorts(source, offsets, result);
        return unique(result);
    }
});
