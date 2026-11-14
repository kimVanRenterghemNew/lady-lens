/**
 * The questions a bench run times on a synced graph. Targets (a symbol, a file, a folder) are taken from the graph
 * itself, so the same list works on any repository; they stay in memory and never reach the saved run.
 */
import fs from 'fs';
import path from 'path';
import { rankGraphNodes, hubsAndBridges } from '../graph/index.js';
import { createFakeGit } from '../git/index.js';
import { crossRepoSearch } from '../mcp/handlers/index.js';
import {
    graph_query, definedInTool, exportsTool, fileExists, imports, importedBy,
    functionViewTool, folderViewTool, healthTool, diffImpact, loadGraphModel, invalidateGraphCache
} from '../search/index.js';

const MODEL_ARGS = { sessionId: 'bench', text: 'code graph search', includeProject: true };

/** A code file that exports something, else any code file. */
export function sampleFile(graph) {
    const files = [...graph.nodes.values()].filter(node => node.type === 'CodeFile');
    const node = files.find(file => file.exports?.length) || files[0];
    if (!node) throw new Error('bench: the graph has no code files to ask about');
    return node;
}

const wordsOf = symbol => String(symbol).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s._-]+/).filter(word => word.length >= 3);

export async function benchTargets() {
    const { graph } = await loadGraphModel(MODEL_ARGS);
    const node = sampleFile(graph);
    const file = node.path;
    const symbol = node.exports?.[0] || path.basename(file).replace(/\.[^.]+$/, '');
    const folder = path.posix.dirname(file);
    return { graph, file, symbol, folder, queries: [wordsOf(symbol).join(' '), symbol, 'health import cycle'].filter(Boolean) };
}

/**
 * `[label, fn, { repeat }]` per question. `repeat` averages a fast question over several calls in one run.
 */
export function benchOperations({ root, repository, targets }) {
    const { graph, file, symbol, folder, queries } = targets;
    let turn = 0;
    const nextQuery = () => queries[turn++ % queries.length];
    const readRoot = rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
    const git = createFakeGit({ commits: [{ name: 'c1', parents: [], files: { [file]: '' } }], branches: { main: 'c1' }, head: 'main', worktree: { [file]: readRoot(file) } });
    const projects = [root, path.join(root, path.dirname(file)), path.join(root, folder)].map((dir, i) => ({ id: `p${i}`, path: dir }));
    return [
        ['load graph: cold', async () => { invalidateGraphCache(); await loadGraphModel(MODEL_ARGS); }],
        ['load graph: warm', () => loadGraphModel(MODEL_ARGS), { repeat: 5 }],
        ['query: rankGraphNodes', () => rankGraphNodes(graph, nextQuery(), { limit: 10 }), { repeat: 10 }],
        ['query: graph_query', () => graph_query({ sessionId: 'bench', query: nextQuery(), limit: 10 }), { repeat: 3 }],
        ['direct: definedIn', () => definedInTool({ symbol }), { repeat: 5 }],
        ['direct: exports', () => exportsTool({ file }), { repeat: 5 }],
        ['direct: imports', () => imports({ file }), { repeat: 5 }],
        ['direct: importedBy', () => importedBy({ file }), { repeat: 5 }],
        ['direct: exists', () => fileExists({ file }), { repeat: 5 }],
        ['view: functionView', () => functionViewTool({ symbol }), { repeat: 3 }],
        ['view: folderView', () => folderViewTool({ folder }), { repeat: 3 }],
        ['analysis: health', () => healthTool({})],
        ['analysis: diff_impact', () => diffImpact({}, { refresh: async () => null, git, repository, readFile: readRoot })],
        ['search: cross_repo_search', () => crossRepoSearch({ query: symbol, limit: 50 }, { list: () => projects, find: () => null })],
        ['analysis: hubs and bridges', () => hubsAndBridges(graph, { hubs: true, bridges: true })]
    ];
}
