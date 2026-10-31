/**
 * the Ladybug repository round-trips what it is given. `replaceScope` -> `loadGraph` returns the same nodes
 * (id, type, title) and the same edges (from, to, type, confidence), whatever fast-check throws at it, and a replace never
 * leaks rows from the previous content of that scope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphRepository } from '../core/graph/index.js';

const ids = ['task:n1', 'task:n2', 'story:n3', 'file:src/a.js', 'file:src/b.js', 'concept:n6'];
const nodeSet = fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: ids.length })
    .chain(chosen => fc.tuple(
        fc.constant(chosen),
        fc.array(fc.record({ title: fc.string({ maxLength: 12 }) }), { minLength: chosen.length, maxLength: chosen.length }),
        // Pairs of distinct nodes by construction: a filter on from !== to never terminates when only one node was chosen.
        fc.uniqueArray(
            fc.record({
                pair: fc.uniqueArray(fc.constantFrom(...chosen), { minLength: 2, maxLength: 2 }),
                type: fc.constantFrom('CONTAINS', 'DEPENDS_ON'),
                confidence: fc.constantFrom('EXTRACTED', 'INFERRED', 'AMBIGUOUS')
            }).map(({ pair: [from, to], type, confidence }) => ({ from, to, type, confidence })),
            { selector: edge => `${edge.from}|${edge.to}|${edge.type}`, maxLength: chosen.length > 1 ? 8 : 0 })
    ));

let dir;
let repository;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-repo-prop-'));
    repository = createGraphRepository({ databasePath: path.join(dir, 'graph.lbdb') });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const nodeKey = (node) => `${node.id}|${node.type}|${node.title ?? ''}`;
const edgeKey = (edge) => `${edge.from}|${edge.to}|${edge.type}|${edge.confidence}`;

describe('graph repository round-trip', () => {
    it('replaceScope -> loadGraph returns exactly what was written', async () => {
        await fc.assert(fc.asyncProperty(nodeSet, async ([chosen, extras, edges]) => {
            const nodes = chosen.map((id, i) => ({ id, type: id.split(':')[0], title: extras[i].title || undefined }));
            await repository.replaceScope('session:prop', { nodes, edges });
            const loaded = await repository.loadGraph({ scopes: ['session:prop'] });
            expect(loaded.nodes.map(nodeKey).sort()).toEqual(nodes.map(nodeKey).sort());
            expect(loaded.edges.map(edgeKey).sort()).toEqual(edges.map(edgeKey).sort());
        }), { numRuns: 25 });
    }, 120_000);
});
