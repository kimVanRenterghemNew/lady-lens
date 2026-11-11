// File chunk reading & outlining
import fs from 'fs';
import { resolveInRepo, contextBudget } from '../configuration/index.js';
import { analyzeSource } from '../graph/index.js';

export { resolveInRepo };

const MAX_READ_CHARS = () => contextBudget().readChunkChars;
const MAX_READ_LINES = () => contextBudget().readChunkLines;
const OUTLINE_MAX_ENTRIES = 60;
const DECLARATION = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?\s+\w+|class\s+\w+|(const|let|var)\s+\w+\s*=|\w+\s*:\s*(async\s+)?(function|\()|(describe|it|test)\(|#{1,3}\s)/;

export function outlineOf(lines) {
    const entries = [];
    lines.forEach((line, index) => {
        if (entries.length < OUTLINE_MAX_ENTRIES && DECLARATION.test(line)) {
            entries.push(`${index + 1}: ${line.trim().slice(0, 100)}`);
        }
    });
    return entries;
}

function fetchNode(graph, chunkId) {
    if (!graph || !graph.getNode) return null;
    const direct = graph.getNode(chunkId);
    if (direct) return direct;
    return graph.getNode(String(chunkId).toLowerCase());
}

function isChunkType(type) {
    return type === 'CodeChunk' || type === 'Function';
}

function resolveNodeRange(node) {
    const range = Array.isArray(node.range) ? node.range : [];
    const startLine = Number.isInteger(node.startLine) ? node.startLine : range[0];
    const endLine = Number.isInteger(node.endLine) ? node.endLine : range[1];
    return { startLine, endLine };
}

function resolveNodePath(node) {
    if (node.path) return node.path;
    return node.file || null;
}

function resolveNodeSymbol(node) {
    if (node.name) return node.name;
    return node.symbol || null;
}

function resolveChunkFromGraph(graph, chunkId) {
    const node = fetchNode(graph, chunkId);
    if (!node || !isChunkType(node.type)) return null;
    const path = resolveNodePath(node);
    const symbol = resolveNodeSymbol(node);
    const range = resolveNodeRange(node);
    return { path, symbol, startLine: range.startLine, endLine: range.endLine };
}

function resolveChunkFromPattern(chunkId) {
    const match = String(chunkId).match(/^(?:chunk:)?([^#:]+)[#:]([a-zA-Z0-9_$]+)$/);
    if (!match) return null;
    return { path: match[1], symbol: match[2] };
}

function propertyFrom(obj, prop) {
    return obj ? obj[prop] || null : null;
}

function pickTargetProperty(prop, rel, a, b) {
    if (rel) return rel;
    const fromA = propertyFrom(a, prop);
    if (fromA) return fromA;
    return propertyFrom(b, prop);
}

function resolveChunkTarget(chunkId, graph, relPath) {
    const fromGraph = resolveChunkFromGraph(graph, chunkId);
    const fromPattern = resolveChunkFromPattern(chunkId);
    const targetPath = pickTargetProperty('path', relPath, fromGraph, fromPattern);
    const targetSymbol = pickTargetProperty('symbol', null, fromGraph, fromPattern);
    const startLine = (fromGraph && fromGraph.startLine) || null;
    const endLine = (fromGraph && fromGraph.endLine) || null;
    return { targetPath, targetSymbol, startLine, endLine };
}

function readChunkFile(targetPath) {
    const abs = resolveInRepo(targetPath);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    try {
        return fs.readFileSync(abs, 'utf8');
    } catch {
        return null;
    }
}

function resolveRangeFromSource(content, symbol) {
    const facts = analyzeSource(content);
    const ranges = facts ? facts.symbolRanges : null;
    const range = ranges ? ranges[symbol] : null;
    if (!Array.isArray(range)) return null;
    return { startLine: range[0], endLine: range[1] };
}

function resolveLinesRange(start, end, content, symbol) {
    if (Number.isInteger(start) && Number.isInteger(end)) {
        return { startLine: start, endLine: end };
    }
    return resolveRangeFromSource(content, symbol);
}

function isValidChunkRange(range, totalLines) {
    if (!range) return false;
    return range.startLine >= 1 && range.endLine >= range.startLine && range.startLine <= totalLines;
}

function hasTarget(target) {
    return Boolean(target.targetPath && target.targetSymbol);
}

function readByChunkId({ chunkId, graph, relPath }) {
    const target = resolveChunkTarget(chunkId, graph, relPath);
    if (!hasTarget(target)) return { error: `chunk not found: ${chunkId}` };

    const content = readChunkFile(target.targetPath);
    if (content === null) return { error: `chunk not found: ${chunkId}` };

    const lines = content.split(/\r?\n/);
    const range = resolveLinesRange(target.startLine, target.endLine, content, target.targetSymbol);
    if (!isValidChunkRange(range, lines.length)) {
        return { error: `chunk not found: ${chunkId}` };
    }

    return {
        chunkId,
        path: target.targetPath,
        symbol: target.targetSymbol,
        startLine: range.startLine,
        endLine: range.endLine,
        totalLines: lines.length,
        content: lines.slice(range.startLine - 1, range.endLine).join('\n')
    };
}

export function read_chunk(args = {}) {
    const resolvedArgs = typeof args === 'string' ? { chunkId: args } : (args || {});
    const { chunkId, path: relPath, startLine, endLine, graph } = resolvedArgs;

    if (chunkId) {
        return readByChunkId({ chunkId, graph, relPath });
    }

    if (typeof relPath !== 'string' || relPath.length === 0) {
        return { error: 'path is required' };
    }
    const abs = resolveInRepo(relPath);
    if (!abs) return { error: `unsafe path (outside repo, or under .git/.memory/node_modules): ${relPath}` };
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { error: `not found: ${relPath}` };

    let content;
    try {
        content = fs.readFileSync(abs, 'utf8');
    } catch (error) {
        return { error: `could not read ${relPath}: ${error.message}` };
    }

    const lines = content.split(/\r?\n/);
    const ranged = Number.isInteger(startLine) || Number.isInteger(endLine);
    const fitsWhole = JSON.stringify(content).length <= MAX_READ_CHARS() && lines.length <= MAX_READ_LINES();
    if (!ranged && !fitsWhole) {
        return {
            path: relPath, totalLines: lines.length, truncated: true,
            outline: outlineOf(lines),
            hint: `File has ${lines.length} lines: read the part you need with startLine/endLine (max ${MAX_READ_LINES()} lines per call), or grep for a symbol.`
        };
    }
    const start = Math.max(1, ranged ? (startLine ?? 1) : 1);
    const wantedEnd = Math.min(lines.length, ranged ? (endLine ?? lines.length) : lines.length);
    const out = [];
    let used = 0;
    for (let n = start; n <= wantedEnd && out.length < MAX_READ_LINES(); n++) {
        const line = lines[n - 1];
        const cost = JSON.stringify(line).length;
        if (used + cost > MAX_READ_CHARS() && out.length) break;
        out.push(cost > MAX_READ_CHARS() ? line.slice(0, Math.floor(MAX_READ_CHARS() / 2)) : line);
        used += cost;
    }
    const end = start + out.length - 1;
    const truncated = end < wantedEnd || out.some((line, i) => line.length < lines[start - 1 + i].length);
    return {
        path: relPath, startLine: start, endLine: end, totalLines: lines.length, content: out.join('\n'), truncated,
        ...(end < wantedEnd ? { nextStartLine: end + 1, hint: `Read stopped at line ${end} (budget). Continue with startLine: ${end + 1}.` } : {})
    };
}
