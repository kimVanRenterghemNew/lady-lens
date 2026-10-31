/**
 * The local search page (`lens ui`): answers with the same tools as `lens ask`, says which repository it searches,
 * refuses an unknown tool, and its overview keeps only files and their import/test edges.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createGraphUiServer, overviewOf } from '../ui/index.js';

let server;
afterEach(() => server?.close());

const start = (deps) => new Promise(resolve => {
    server = createGraphUiServer(deps).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});
const graph = {
    nodes: [
        { id: 'file:a.js', type: 'CodeFile', kind: 'source', path: 'core/a.js' },
        { id: 'file:a.test.js', type: 'CodeFile', kind: 'test', path: 'test/a.test.js' },
        { id: 'doc:r.md', type: 'Document', kind: 'doc', path: 'README.md' },
        { id: 'concept:x', type: 'Concept', name: 'x' }
    ],
    edges: [
        { from: 'file:a.test.js', to: 'file:a.js', type: 'TESTS' },
        { from: 'file:a.js', to: 'concept:x', type: 'MENTIONS' }
    ]
};

describe('lens ui', () => {
    it('serves the page, says which repository it searches, and answers with the tool itself', async () => {
        const base = await start({ tools: { definedIn: async ({ symbol }) => ({ symbol, locations: [{ path: 'core/a.js' }] }) }, loadOverview: async () => graph, repo: 'C:\\git\\some-repo' });
        const html = await fetch(base + '/').then(r => r.text());
        expect(html).toMatch(/<title>lady-lens<\/title>/);
        expect(html).toContain('<lens-search');
        expect(html).toContain('<lens-health');
        expect(html).toContain('<lens-graph');
        expect(html).toContain('if (tool === \'auto\' && t === \'functionView\' && !res.definitions?.length)');
        expect(await fetch(base + '/graph-ui.css').then(r => r.text())).toMatch(/--bg:/);
        expect(await fetch(base + '/api/repo').then(r => r.json())).toEqual({ repo: 'C:\\git\\some-repo' });
        const health = await fetch(base + '/api/health').then(r => r.json());
        expect(health).toHaveProperty('topCentralNodes');
        expect(health).toHaveProperty('complexFunctions');
        const answer = await fetch(base + '/api/ask?tool=definedIn&args=' + encodeURIComponent('{"symbol":"f"}')).then(r => r.json());
        expect(answer).toEqual({ symbol: 'f', locations: [{ path: 'core/a.js' }] });
    });

    it('MUST refuse an unknown tool and bad JSON with 400', async () => {
        const base = await start({ tools: {}, loadOverview: async () => graph });
        expect((await fetch(base + '/api/ask?tool=write')).status).toBe(400);
        expect((await fetch(base + '/api/ask?tool=x&args=%7Bbad')).status).toBe(400);
    });

    it('overview: files and documents with their kind, only import/test edges between them', () => {
        expect(overviewOf(graph).edges).toEqual([{ from: 'file:a.test.js', to: 'file:a.js', type: 'TESTS' }]);
        expect(overviewOf(graph).nodes.map(n => n.path)).toEqual(['core/a.js', 'test/a.test.js', 'README.md']);
    });

    it('overview: a code file carries its health issues (the ring in the page); a tested one has none', () => {
        const issues = overviewOf({ nodes: [...graph.nodes, { id: 'file:core/b.js', type: 'CodeFile', kind: 'source', path: 'core/b.js' }], edges: graph.edges }).nodes;
        expect(issues.find(n => n.path === 'core/b.js').issues).toContain('untested');
        expect(issues.find(n => n.path === 'core/a.js').issues).toEqual([]);
    });
});
