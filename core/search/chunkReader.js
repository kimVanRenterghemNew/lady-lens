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

function readByChunkId({ chunkId, graph, relPath }) {
    let targetPath = relPath;
    let targetSymbol = null;
    let startLine = null;
    let endLine = null;

    if (graph?.getNode) {
        const node = graph.getNode(chunkId) || graph.getNode(String(chunkId).toLowerCase());
        if (node && (node.type === 'CodeChunk' || node.type === 'Function')) {
            targetPath = targetPath || node.path || node.file;
            targetSymbol = node.name || node.symbol;
            startLine = node.startLine ?? node.range?.[0];
            endLine = node.endLine ?? node.range?.[1];
        }
    }

    if (!targetSymbol || !targetPath) {
        const match = String(chunkId).match(/^(?:chunk:)?([^#:]+)[#:]([a-zA-Z0-9_$]+)$/);
        if (match) {
            targetPath = targetPath || match[1];
            targetSymbol = targetSymbol || match[2];
        }
    }

    if (!targetPath || !targetSymbol) {
        return { error: `chunk not found: ${chunkId}` };
    }

    const abs = resolveInRepo(targetPath);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return { error: `chunk not found: ${chunkId}` };
    }

    let content;
    try {
        content = fs.readFileSync(abs, 'utf8');
    } catch {
        return { error: `chunk not found: ${chunkId}` };
    }

    const lines = content.split(/\r?\n/);

    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
        const facts = analyzeSource(content);
        const range = facts?.symbolRanges?.[targetSymbol];
        if (!range || !Number.isInteger(range[0]) || !Number.isInteger(range[1])) {
            return { error: `chunk not found: ${chunkId}` };
        }
        startLine = range[0];
        endLine = range[1];
    }

    if (startLine < 1 || endLine < startLine || startLine > lines.length) {
        return { error: `chunk not found: ${chunkId}` };
    }

    return {
        chunkId,
        path: targetPath,
        symbol: targetSymbol,
        startLine,
        endLine,
        totalLines: lines.length,
        content: lines.slice(startLine - 1, endLine).join('\n')
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
