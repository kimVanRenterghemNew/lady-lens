export async function clearProject(graph, scope, removePaths, batchSize) {
    for (let i = 0; i < removePaths.length; i += batchSize) {
        const batch = removePaths.slice(i, i + batchSize);
        await graph.query('MATCH (n:Entity) WHERE n.scope = $scope AND n.path IN $paths DETACH DELETE n', { scope, paths: batch });
    }
    await graph.query('MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope AND b.scope = $scope DELETE e', { scope });
}

export async function projectCounts(graph, scope) {
    const [counts] = await graph.query('MATCH (n:Entity) WHERE n.scope = $scope RETURN count(n) AS nodes', { scope });
    const [edges] = await graph.query('MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope RETURN count(e) AS edges', { scope });
    return { nodes: Number(counts.nodes), edges: Number(edges.edges) };
}
