function findSameCodeFiles(graph, base) {
    const ids = graph.nodesByBase.get(base.toLowerCase()) || [];
    return ids.map(id => graph.getNode(id)).filter(n => Boolean(n && n.type === 'CodeFile'));
}

function resolveCandidateMatches(same) {
    if (same.length === 1) return { node: same[0] };
    if (same.length > 1) return { candidates: same.map(n => n.path).sort() };
    return {};
}

export function lookupCodeFile(graph, wanted) {
    const exact = graph.getNodeByPath(wanted);
    if (exact && exact.type === 'CodeFile') return { node: exact };
    if (wanted.includes('/')) return {};
    const same = findSameCodeFiles(graph, wanted);
    return resolveCandidateMatches(same);
}

export function lookupFile(graph, wanted) {
    const exact = graph.getNodeByPath(wanted);
    const base = wanted.split('/').pop().toLowerCase();
    if (exact && (exact.type === 'CodeFile' || exact.type === 'Document')) {
        return { file: wanted, exists: true, similar: [] };
    }
    const similar = (graph.nodesByBase.get(base) || [])
        .map(id => graph.getNode(id))
        .filter(n => (n?.type === 'CodeFile' || n?.type === 'Document') && typeof n.path === 'string')
        .map(n => n.path)
        .sort();
    return { file: wanted, exists: false, similar };
}
