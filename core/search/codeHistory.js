// The history beside a function or file in the dashboard: the last commits that changed it (the function by name, else
// the file), who changed it last, the files that usually change with it (CO_CHANGES) and whether it is a hotspot
// (commits × lines among the top of the project, as in `health`). All through the GitPort; without git it is empty.
import { createGit } from '../git/index.js';
import { functionHistory } from '../branches/index.js';

const HOTSPOT_TOP = 10;

/**
 * @param {{path: string, symbol?: string, root: string, graph: {nodes: object[], edges: object[]}, git?: object, max?: number}} args
 * @returns {{path, symbol, commits: {sha, date, author, subject, change?}[], lastChange: object|null, coChanges: {path, weight}[], churn: number, hotspot: boolean}}
 */
export function codeHistory({ path, symbol = null, root, graph, git = createGit({ root }), max = 5 }) {
    const node = graph.nodes.find(n => n.type === 'CodeFile' && n.path === path);
    const history = functionHistory({ name: symbol || undefined, file: path, max, root, git });
    const commits = history.error ? [] : history.commits;
    const paths = new Map(graph.nodes.map(n => [n.id, n.path]));
    const coChanges = node ? graph.edges
        .filter(e => e.type === 'CO_CHANGES' && (e.from === node.id || e.to === node.id))
        .map(e => ({ path: paths.get(e.from === node.id ? e.to : e.from), weight: e.weight ?? 1 }))
        .filter(e => e.path).sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path)).slice(0, 8) : [];
    const prefix = git.prefix() || '';
    const churn = new Map();
    for (const files of git.commitFiles()) for (const file of new Set(files)) churn.set(file, (churn.get(file) || 0) + 1);
    const score = n => (churn.get(prefix + n.path) || 0) * (Number(n.lines) || 0);
    const top = graph.nodes.filter(n => n.type === 'CodeFile' && score(n) > 0).sort((a, b) => score(b) - score(a)).slice(0, HOTSPOT_TOP);
    return {
        path, symbol, commits, lastChange: commits[0] ?? null, coChanges,
        churn: churn.get(prefix + path) || 0,
        hotspot: Boolean(node && top.includes(node))
    };
}
