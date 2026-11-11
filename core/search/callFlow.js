// The call chain around one function, up (callers) and down (callees), to a chosen depth: one answer for the call tree
// and the flow diagram of the dashboard, and its Mermaid text. Built from functionView, so it knows what that knows
// (function-level calls: JavaScript today); functionView goes by name, so two functions with one name share callers.
import { functionViewTool } from './functionView.js';

const MAX_DEPTH = 5;
const nodeId = (path, name) => `${path}#${name}`;

function resolveFlowLinks(fv, step) {
    if (step > 0) {
        return (fv.calls || []).filter(c => c.path).map(c => ({ path: c.path, name: c.name, line: c.lines?.[0] }));
    }
    return (fv.callers || []).filter(c => !c.reference).flatMap(c => (c.functions?.length ? c.functions : [null]).map(name => ({ path: c.path, name: name ?? c.path.split('/').pop(), line: c.lines?.[0], file: !name })));
}

const shouldQueueNext = (added, link, level, maxDepth) => added.fresh && !link.file && Math.abs(level) < maxDepth;

function processFlowLink(link, at, level, maxDepth, addNode, addEdge, queue) {
    const added = addNode(link.path, link.name, link.line, level);
    if (!added) return false;
    const [from, to] = at.step > 0 ? [at.id, added.id] : [added.id, at.id];
    addEdge(from, to);
    if (shouldQueueNext(added, link, level, maxDepth)) {
        queue.push({ name: link.name, id: added.id, level, step: at.step });
    }
    return true;
}

function createFlowBuilder(limit) {
    const nodes = new Map(), edges = new Map();
    let truncated = false;
    return {
        nodes,
        edges,
        isTruncated: () => truncated,
        addNode(filePath, name, line, level) {
            const id = nodeId(filePath, name);
            if (nodes.has(id)) return { id, fresh: false };
            if (nodes.size >= limit) {
                truncated = true;
                return null;
            }
            nodes.set(id, { id, name, path: filePath, line: line ?? null, level });
            return { id, fresh: true };
        },
        addEdge(from, to) {
            edges.set(`${from}>${to}`, { from, to });
        }
    };
}

const DEFAULTS = { path: null, depth: 2, direction: 'both', limit: 80, view: functionViewTool };

function parseFlowOptions(opts) {
    const raw = Object.assign({}, DEFAULTS, opts);
    raw.depth = Math.max(1, Math.min(Number(raw.depth) || 2, MAX_DEPTH));
    return raw;
}

const matchPath = path => d => d.path === path;

function findRootDef(defs, path) {
    if (!defs || !defs.length) return null;
    const match = path ? defs.find(matchPath(path)) : null;
    return match || defs[0];
}

function initialQueue(direction, symbol, rootId) {
    const queue = [];
    if (direction !== 'down') queue.push({ name: symbol, id: rootId, level: 0, step: -1 });
    if (direction !== 'up') queue.push({ name: symbol, id: rootId, level: 0, step: 1 });
    return queue;
}

async function expandAt(at, viewOf, maxDepth, builder, queue) {
    const fv = await viewOf(at.name);
    if (!fv) return;
    const level = at.level + at.step;
    const links = resolveFlowLinks(fv, at.step);
    for (const link of links) {
        const ok = processFlowLink(link, at, level, maxDepth, builder.addNode, builder.addEdge, queue);
        if (!ok) break;
    }
}

async function expandQueue(queue, viewOf, maxDepth, builder) {
    while (queue.length) {
        await expandAt(queue.shift(), viewOf, maxDepth, builder, queue);
    }
}

/**
 * @returns {Promise<{root: string|null, nodes: {id, name, path, line, level}[], edges: {from, to}[], truncated: boolean}>}
 *   level < 0 is a caller (−1 calls the root), level > 0 a callee; a caller outside any function is the file itself.
 */
export async function callFlow(opts) {
    if (!opts?.symbol) return { error: 'symbol is required' };
    const config = parseFlowOptions(opts);
    const views = new Map();
    const viewOf = name => views.get(name) ?? views.set(name, Promise.resolve(config.view({ symbol: name })).catch(() => null)).get(name);
    const builder = createFlowBuilder(config.limit);

    const first = await viewOf(config.symbol);
    const def = findRootDef(first?.definitions, config.path);
    if (!def) return { root: null, nodes: [], edges: [], truncated: false };

    const root = builder.addNode(def.path, config.symbol, def.startLine, 0).id;
    const queue = initialQueue(config.direction, config.symbol, root);
    await expandQueue(queue, viewOf, config.depth, builder);

    return { root, nodes: [...builder.nodes.values()], edges: [...builder.edges.values()], truncated: builder.isTruncated() };
}

const label = text => String(text).replace(/"/g, '#quot;');

function formatEdges(edges, key) {
    return edges
        .filter(edge => key.has(edge.from) && key.has(edge.to))
        .map(edge => `  ${key.get(edge.from)} --> ${key.get(edge.to)}`);
}

function formatMarked(marked, key) {
    const thick = marked.filter(id => key.has(id)).map(id => key.get(id));
    if (!thick.length) return [];
    return ['  classDef marked stroke-width:3px', `  class ${thick.join(',')} marked`];
}

/** The flow as Mermaid `flowchart LR`; `marked` ids (the root, frames of a stack trace) get a thick border. */
export function toMermaid(graph = {}, marked = []) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const key = new Map(nodes.map((node, i) => [node.id, `n${i}`]));
    const nodeLines = nodes.map(node => `  ${key.get(node.id)}["${label(node.name)}<br/><small>${label(node.path)}</small>"]`);
    const edgeLines = formatEdges(edges, key);
    const markedLines = formatMarked(marked, key);
    return ['flowchart LR', ...nodeLines, ...edgeLines, ...markedLines].join('\n');
}
