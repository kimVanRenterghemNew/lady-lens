/**
 * the graph repository is the port; its storage is an adapter the IoC injects (`graph.store`).
 * One scenario runs through createGraphRepository({ store }) on every adapter: they must give the same answers, and
 * those answers must be right (fixed expectations), so two adapters cannot be wrong in the same way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphRepository, createLadybugRepositoryStore, createMemoryRepositoryStore, GRAPH_STORE_METHODS, PROJECT_SCOPE } from '../../core/graph/index.js';

const byKey = (key) => (a, b) => String(key(a)).localeCompare(String(key(b)));
const sortGraph = (g) => ({ ...g, nodes: [...g.nodes].sort(byKey(n => n.id)), edges: [...g.edges].sort(byKey(e => `${e.from}|${e.to}|${e.type}`)) });

/** The scenario: every repository method, in an order that also exercises deletes and edge replacement. */
async function scenario(repository) {
    const out = {};
    out.empty = {
        exists: repository.exists(), graph: await repository.loadGraph({ scopes: [PROJECT_SCOPE] }), stats: await repository.stats(),
        nodes: await repository.loadNodes({ kinds: ['note'] }), files: [...(await repository.projectFiles()).entries()], deleted: await repository.deleteScopes('session:')
    };
    out.applied = await repository.applyProjectChanges({
        upserts: [
            { id: 'file:a.js', type: 'CodeFile', kind: 'code', path: 'a.js', name: 'a.js', contentHash: 'h-a', metadata: { exports: ['a'] } },
            { id: 'file:b.js', type: 'CodeFile', kind: 'code', path: 'b.js', name: 'b.js', contentHash: 'h-b', metadata: { exports: ['b'] } },
            { id: 'doc:readme', type: 'Document', kind: 'doc', path: 'README.md', name: 'Readme', contentHash: 'h-r' }
        ],
        relations: [{ from: 'file:a.js', to: 'file:b.js', relation: 'IMPORTS', confidence: 'extracted' }, { from: 'file:a.js', to: 'file:missing.js', relation: 'IMPORTS' }]
    });
    out.directDefined = await repository.directDefinedIn('a');
    out.directExportsA = await repository.directExports('a.js');
    out.directExistsB = await repository.directExists('b.js');
    out.directExistsMissing = await repository.directExists('missing.js');
    out.directImportsA = await repository.directImports('a.js');
    out.directImportedByB = await repository.directImportedBy('b.js');
    const fvGraph = await repository.directFunctionViewGraph('a');
    out.directFunctionViewGraph = sortGraph(fvGraph);
    out.files = [...(await repository.projectFiles()).entries()].sort(byKey(([p]) => p));
    out.replaced = await repository.replaceScope('session:1', {
        nodes: [{ id: 'dec:1', type: 'Decision', title: 'Use Ladybug', createdAt: 1700000000000, verdict: 'APPROVED' }, { id: 'phase:1', type: 'Phase', name: 'planning' }],
        edges: [{ from: 'phase:1', to: 'dec:1', type: 'DECIDED', confidence: 'inferred' }]
    });
    out.session = sortGraph(await repository.loadGraph({ scopes: ['session:1'] }));
    out.upserted = await repository.upsertNodes('knowledge', [{ id: 'note:1', type: 'Knowledge', kind: 'note', name: 'n1', documentation: 'body', metadata: { tag: 't' } }]);
    out.related = await repository.relate([{ from: 'note:1', to: 'file:a.js', type: 'MENTIONS' }, { from: 'note:1', to: 'nowhere', type: 'MENTIONS' }]);
    out.notes = (await repository.loadNodes({ kinds: ['note'] })).sort(byKey(n => n.id));
    await repository.relate([{ from: 'note:1', to: 'file:b.js', type: 'MENTIONS' }], { replaceFrom: ['note:1'] });
    out.mentions = sortGraph(await repository.loadGraph({ scopes: ['knowledge', PROJECT_SCOPE] })).edges.filter(e => e.type === 'MENTIONS');
    const withoutDocs = sortGraph(await repository.loadGraph({ scopes: ['knowledge', PROJECT_SCOPE], exclude: { scope: PROJECT_SCOPE, types: ['Document', 'Knowledge'] } }));
    out.withoutDocs = { nodes: withoutDocs.nodes.map(n => n.id), edges: withoutDocs.edges.map(e => `${e.from}-${e.type}->${e.to}`) };
    out.removed = await repository.applyProjectChanges({ removePaths: ['b.js'], relations: [] });
    out.project = sortGraph(await repository.loadGraph({ scopes: [PROJECT_SCOPE], types: ['CodeFile'] }));
    out.stats = await repository.stats();
    out.deletedSessions = await repository.deleteScopes('session:');
    out.after = await repository.stats();
    let rejected = null;
    try { await repository.replaceScope('knowledge', { nodes: [], edges: [{ from: 'x' }] }); } catch (error) { rejected = error.message; }
    out.rejected = { message: rejected, notesStillThere: (await repository.loadNodes({ kinds: ['note'] })).length };
    return out;
}

describe('GraphStore port: the storage adapters behind the graph repository', () => {
    let dir;
    const results = {};

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-repo-contract-'));
        results.ladybug = await scenario(createGraphRepository({ store: createLadybugRepositoryStore({ databasePath: path.join(dir, 'contract.lbdb') }) }));
        results.memory = await scenario(createGraphRepository({ store: createMemoryRepositoryStore() }));
    }, 120_000);

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('every adapter implements exactly the GraphStore port methods', () => {
        const dbPath = path.join(dir, 'methods.lbdb');
        for (const store of [createLadybugRepositoryStore({ databasePath: dbPath }), createMemoryRepositoryStore()]) {
            expect(Object.keys(store).sort()).toEqual([...GRAPH_STORE_METHODS].sort());
        }
    });

    it('both adapters give the same answer to every step', () => {
        expect(results.memory).toEqual(results.ladybug);
    });

    it('the answers are right, not just equal (fixed expectations)', () => {
        const r = results.ladybug;
        expect(r.empty).toEqual({ exists: false, graph: { nodes: [], edges: [], exists: false }, stats: { exists: false, scopes: {} }, nodes: [], files: [], deleted: 0 });
        expect(r.applied).toEqual({ nodes: 3, edges: 1 }); // the edge to a missing file is skipped
        expect(r.directDefined).toEqual([{ path: 'a.js' }]);
        expect(r.directExportsA).toEqual({ file: 'a.js', found: true, candidates: [], names: ['a'] });
        expect(r.directExistsB).toEqual({ file: 'b.js', exists: true, similar: [] });
        expect(r.directExistsMissing).toEqual({ file: 'missing.js', exists: false, similar: [] });
        expect(r.directImportsA).toEqual({ file: 'a.js', found: true, candidates: [], files: ['b.js'] });
        expect(r.directImportedByB).toEqual({ file: 'b.js', found: true, candidates: [], files: ['a.js'] });
        expect(r.directFunctionViewGraph.nodes.map(n => n.id)).toEqual(['file:a.js']);
        // exclude: the project's Document is gone, the Knowledge note of another scope is NOT (the scope must match too)
        expect(r.withoutDocs).toEqual({ nodes: ['file:a.js', 'file:b.js', 'note:1'], edges: ['file:a.js-IMPORTS->file:b.js', 'note:1-MENTIONS->file:b.js'] });
        expect(r.files.map(([p, f]) => [p, f.hash])).toEqual([['a.js', 'h-a'], ['b.js', 'h-b'], ['README.md', 'h-r']]); // localeCompare: case-insensitive order
        expect(r.session.nodes.find(n => n.id === 'dec:1')).toMatchObject({ type: 'Decision', title: 'Use Ladybug', verdict: 'APPROVED', createdAt: 1700000000000, scope: 'session:1' });
        expect(r.session.edges).toEqual([expect.objectContaining({ from: 'phase:1', to: 'dec:1', type: 'DECIDED', confidence: 'INFERRED' })]);
        expect(r.notes).toEqual([expect.objectContaining({ id: 'note:1', kind: 'note', scope: 'knowledge', documentation: 'body', metadata: { tag: 't' } })]);
        expect(r.mentions.map(e => e.to)).toEqual(['file:b.js']); // replaceFrom removed the edge to a.js
        expect(r.project.nodes.map(n => n.id)).toEqual(['file:a.js']); // b.js removed, README is a Document
        expect(r.stats.scopes).toEqual({ project: 2, 'session:1': 2, knowledge: 1 });
        expect(r.deletedSessions).toBe(2);
        expect(r.after.scopes).toEqual({ project: 2, knowledge: 1 });
    });

    it('MUST reject an invalid relation before writing anything, on every adapter', () => {
        for (const name of ['ladybug', 'memory']) {
            expect(results[name].rejected, name).toEqual({ message: 'relation requires from, to and relation', notesStillThere: 1 });
        }
    });
});
