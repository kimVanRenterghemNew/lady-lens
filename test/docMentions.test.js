/** rankDocuments: why a document is a hit for a file question, and the lines that say so. */
import { describe, it, expect } from 'vitest';
import { createGraph } from '../core/graph/index.js';
import { rankDocuments } from '../core/search/index.js';

const TEXTS = {
    'docs/path.md': '# A\nsee core/router.js here\n',
    'docs/name.md': '# B\nthe routeInput function\n',
    'docs/words.md': '# C\nrouting and more routing\n'
};

function sample() {
    const graph = createGraph('docs');
    graph.addNode('file:core/router.js', 'CodeFile', { path: 'core/router.js' });
    for (const path of Object.keys(TEXTS)) graph.addNode(`doc:${path}`, 'Document', { path });
    graph.addNode('doc:docs/gone.md', 'Document', { path: 'docs/gone.md' });
    graph.addEdge('doc:docs/name.md', 'file:core/router.js', 'MENTIONS');
    graph.addEdge('doc:docs/path.md', 'file:core/router.js', 'MENTIONS');
    graph.addEdge('file:core/router.js', 'doc:docs/words.md', 'MENTIONS'); // the other way round: not a mention of the file
    return graph;
}
const readFile = path => TEXTS[path] ?? null;
const words = graph => ['docs/words.md', 'docs/gone.md', 'docs/path.md'].map(path => graph.getNode(`doc:${path}`));

describe('rankDocuments', () => {
    it('a file path: documents naming the path, then those naming one of its names, then word matches; each once', () => {
        const graph = sample();
        const ranked = rankDocuments(graph, 'core/router.js', [...words(graph), { id: 'x' }, null], { readFile, limit: 10 });
        expect(ranked.map(doc => [doc.path, doc.mentions ?? null, doc.lines ?? null])).toEqual([
            ['docs/path.md', 'path', [2]],
            ['docs/name.md', 'name', null],
            ['docs/words.md', null, null],
            ['docs/gone.md', null, null]
        ]);
    });

    it('a question that is not a file: no `mentions`, the lines that hold the question, cut at the limit', () => {
        const graph = sample();
        const ranked = rankDocuments(graph, 'more routing', words(graph), { readFile, limit: 1 });
        expect(ranked).toEqual([{ ...graph.getNode('doc:docs/words.md'), lines: [2] }]);
    });
});
