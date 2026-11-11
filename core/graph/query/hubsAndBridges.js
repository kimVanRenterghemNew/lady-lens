/**
 * Hubs and bridges of the file graph (IMPORTS and CALLS between code files, direction ignored). A hub has the most
 * neighbours; a bridge sits on the most shortest paths between other files (betweenness, Brandes), so changing or
 * removing it cuts the project in parts. Computed only when asked: betweenness costs O(files x edges).
 */
const LINKS = new Set(['IMPORTS', 'CALLS']);

function fileGraph(graph) {
    const files = new Map([...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string').map(node => [node.id, node.path]));
    const neighbours = new Map([...files.values()].map(path => [path, new Set()]));
    for (const edge of graph.edges) {
        const [from, to] = [files.get(edge.from), files.get(edge.to)];
        if (!LINKS.has(edge.type) || !from || !to || from === to) continue;
        neighbours.get(from).add(to);
        neighbours.get(to).add(from);
    }
    return neighbours;
}

function bfsForwardPass(source, adjacent, distance, paths, before, order) {
    distance.fill(-1); paths.fill(0);
    distance[source] = 0; paths[source] = 1;
    let head = 0, tail = 0;
    order[tail++] = source;
    while (head < tail) {
        const node = order[head++];
        adjacent[node].forEach(next => {
            if (distance[next] < 0) {
                distance[next] = distance[node] + 1;
                order[tail++] = next;
            }
            if (distance[next] === distance[node] + 1) {
                paths[next] += paths[node];
                before[next].push(node);
            }
        });
    }
    return tail;
}

function accumulateBackwards(tail, order, before, paths, delta, score) {
    delta.fill(0);
    for (let i = tail - 1; i > 0; i--) {
        const node = order[i];
        before[node].forEach(previous => {
            delta[previous] += (paths[previous] / paths[node]) * (1 + delta[node]);
        });
        score[node] += delta[node];
    }
}

/** Brandes for an unweighted, undirected graph; each pair counted once. Nodes are numbered so the inner loops use typed arrays. */
function betweenness(neighbours) {
    const names = [...neighbours.keys()];
    const index = new Map(names.map((name, i) => [name, i]));
    const adjacent = names.map(name => [...neighbours.get(name)].map(other => index.get(other)));
    const n = names.length;
    const score = new Float64Array(n), paths = new Float64Array(n), delta = new Float64Array(n), distance = new Int32Array(n);
    const order = new Int32Array(n);
    for (let source = 0; source < n; source++) {
        const before = names.map(() => []);
        const tail = bfsForwardPass(source, adjacent, distance, paths, before, order);
        accumulateBackwards(tail, order, before, paths, delta, score);
    }
    return new Map(names.map((name, i) => [name, score[i] / 2]));
}

const top = (entries, key, limit) => {
    const ranked = entries.filter(entry => entry[key] > 0).sort((a, b) => b[key] - a[key] || a.path.localeCompare(b.path));
    return { total: ranked.length, truncated: ranked.length > limit, nodes: ranked.slice(0, limit) };
};

/** @returns {{hubs?: {total, truncated, nodes: {path, degree}[]}, bridges?: {total, truncated, nodes: {path, betweenness}[]}}} */
export function hubsAndBridges(graph, { hubs = false, bridges = false, limit = 20 } = {}) {
    if (!hubs && !bridges) return {};
    const neighbours = fileGraph(graph);
    const result = {};
    if (hubs) result.hubs = top([...neighbours].map(([path, set]) => ({ path, degree: set.size })), 'degree', limit);
    if (bridges) result.bridges = top([...betweenness(neighbours)].map(([path, value]) => ({ path, betweenness: Math.round(value * 100) / 100 })), 'betweenness', limit);
    return result;
}
