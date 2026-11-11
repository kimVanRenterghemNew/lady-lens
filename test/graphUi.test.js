/**
 * The local search page (`lens ui`): answers with the same tools as `lens ask`, says which repository it searches,
 * refuses an unknown tool, and its overview keeps only files and their import/test edges.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createGraphUiServer, overviewOf } from '../ui/index.js';
import { createFakeGit } from '../core/git/index.js';
import { SCENARIO } from './helpers/gitScenario.js';

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
        // the parts are taken into the page, and a code link outside the search tab (health) switches to it, where the code view is
        expect(html).toContain('async function showContext(path, line)');
        expect(html).not.toContain('<!-- graph-ui-');
        // one place for all tabs: every code link (health, trace, graph) is a step with go(), kept in the URL hash
        expect(html).toContain("if (ln) go({ tab: ln.dataset.tab || 'search', path: ln.dataset.path, line: Number(ln.dataset.line) || 1 });");
        expect(html).toContain("window.addEventListener('popstate', () => show(placeFromHash()));");
        for (const part of ['lens-health', 'lens-graph', 'lens-trace']) expect(html).toContain(`define('${part}'`);
        expect(html).toContain('if (tool === \'auto\' && t === \'functionView\' && !res.definitions?.length)');
        expect(await fetch(base + '/graph-ui.css').then(r => r.text())).toMatch(/--bg:/);
        expect(await fetch(base + '/api/repo').then(r => r.json())).toEqual({ repo: 'C:\\git\\some-repo' });
        const health = await fetch(base + '/api/health').then(r => r.json());
        expect(health).toHaveProperty('topCentralNodes');
        expect(health).toHaveProperty('complexFunctions');
        const answer = await fetch(base + '/api/ask?tool=definedIn&args=' + encodeURIComponent('{"symbol":"f"}')).then(r => r.json());
        expect(answer).toEqual({ symbol: 'f', locations: [{ path: 'core/a.js' }] });
    });

    it('runs each request in the repository picked with ?repo= and refuses an unregistered one with 403', async () => {
        const runInRepo = async (hint, fn) => {
            if (hint === 'nope') throw Object.assign(new Error('not registered'), { status: 403 });
            return fn({ path: hint || 'C:\\default' });
        };
        const base = await start({ tools: {}, loadOverview: async () => graph, runInRepo, listRepos: () => [{ id: 'abc', path: 'C:\\other', database: 'x' }] });
        expect(await fetch(base + '/api/repo?repo=C:%5Cother').then(r => r.json())).toEqual({ repo: 'C:\\other' });
        expect(await fetch(base + '/api/repo').then(r => r.json())).toEqual({ repo: 'C:\\default' });
        expect((await fetch(base + '/api/overview?repo=nope')).status).toBe(403);
        expect(await fetch(base + '/api/repos').then(r => r.json())).toEqual([{ id: 'abc', path: 'C:\\other' }]);
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
    it('stack trace: POST /api/trace locates frames in the project picked with ?repo=; a path of another project is notFound', async () => {
        const graphs = { one: { nodes: [{ id: 'file:core/a.js', type: 'CodeFile', path: 'core/a.js', symbolRanges: { f: [1, 9] } }], edges: [] }, two: { nodes: [{ id: 'file:lib/z.js', type: 'CodeFile', path: 'lib/z.js' }], edges: [] } };
        let current = 'one';
        const runInRepo = async (hint, fn) => { current = hint || 'one'; return fn({ path: current }); };
        const base = await start({ tools: {}, loadOverview: async () => graphs[current], runInRepo });
        const trace = '    at f (C:\\ci\\core\\a.js:3:1)\nnot a frame';
        const one = await fetch(base + '/api/trace', { method: 'POST', body: trace }).then(r => r.json());
        expect(one.frames).toEqual([expect.objectContaining({ status: 'project', path: 'core/a.js', symbol: 'f', line: 3, start: true })]);
        const two = await fetch(base + '/api/trace?repo=two', { method: 'POST', body: trace }).then(r => r.json());
        expect(two.frames[0].status).toBe('notFound');
        expect((await fetch(base + '/api/trace')).status).toBe(405);
        expect((await fetch(base + '/api/trace', { method: 'POST', body: 'x'.repeat(300 * 1024) })).status).toBe(413);
        expect(await fetch(base + '/').then(r => r.text())).toContain("define('lens-trace'");
    });
    it('the function at a line (/api/at) gives the symbol whose range holds it; without a path 400', async () => {
        const nodes = [{ id: 'file:core/a.js', type: 'CodeFile', path: 'core/a.js', symbolRanges: { outer: [1, 40], inner: [10, 20] } }];
        const base = await start({ tools: {}, loadOverview: async () => ({ nodes, edges: [] }) });
        expect(await fetch(base + '/api/at?path=core/a.js&line=12').then(r => r.json())).toMatchObject({ status: 'project', path: 'core/a.js', symbol: 'inner', range: [10, 20] });
        expect(await fetch(base + '/api/at?path=core/a.js&line=99').then(r => r.json())).toMatchObject({ status: 'project', symbol: null });
        expect((await fetch(base + '/api/at')).status).toBe(400);
    });

    it('health: answers with the health tool when the host has one', async () => {
        const base = await start({ tools: { health: async () => ({ relation: 'health', from: 'tool' }) }, loadOverview: async () => graph });
        expect(await fetch(base + '/api/health').then(r => r.json())).toEqual({ relation: 'health', from: 'tool' });
    });
    it('without a host: no other projects, an unknown path is 404, and an error of the graph is 500', async () => {
        const base = await start({ tools: {}, loadOverview: async () => { throw new Error('graph locked'); } });
        expect(await fetch(base + '/api/repos').then(r => r.json())).toEqual([]);
        expect((await fetch(base + '/nope')).status).toBe(404);
        const failed = await fetch(base + '/api/overview');
        expect([failed.status, (await failed.json()).error]).toEqual([500, 'graph locked']);
    });
    it('overview: a node without kind is doc or code by its type; /api/at without a line asks line 1; ask without args gives {}', async () => {
        const nodes = [{ id: 'd', type: 'Document', path: 'a.md' }, { id: 'c', type: 'CodeFile', path: 'core/c.js', symbolRanges: { top: [1, 3] } }];
        expect(overviewOf({ nodes, edges: [] }).nodes.map(n => n.kind)).toEqual(['doc', 'code']);
        const base = await start({ tools: { echo: async args => args }, loadOverview: async () => ({ nodes, edges: [] }) });
        expect((await fetch(base + '/api/at?path=core/c.js').then(r => r.json())).symbol).toBe('top');
        expect(await fetch(base + '/api/ask?tool=echo').then(r => r.json())).toEqual({});
    });
    it('code view: /api/at gives the health of the file and its complex functions; /api/flow and /api/history answer for the place', async () => {
        const nodes = [
            { id: 'file:a.js', type: 'CodeFile', kind: 'source', path: 'a.js', lines: 75, symbolRanges: { f: [1, 72] }, functions: [{ name: 'f', loc: [1, 72], lines: 72, cyclomaticComplexity: 20, issues: ['high-cyclomatic-complexity', 'large-function'] }] }
        ];
        const functionView = async ({ symbol }) => symbol === 'f' ? { definitions: [{ path: 'a.js', startLine: 1 }], calls: [], callers: [{ path: 'b.js', lines: [3], functions: ['g'] }] } : { definitions: [] };
        const base = await start({ tools: { functionView }, loadOverview: async () => ({ nodes, edges: [] }), repo: '.', gitFor: () => createFakeGit(SCENARIO) });
        const at = await fetch(base + '/api/at?path=a.js&line=5').then(r => r.json());
        expect(at.symbol).toBe('f');
        expect(at.health.issues).toContain('untested');
        expect(at.health.functions).toEqual([expect.objectContaining({ name: 'f', loc: [1, 72], cyclomaticComplexity: 20 })]);
        expect((await fetch(base + '/api/at?path=nope.js').then(r => r.json())).health).toBe(null);
        const flow = await fetch(base + '/api/flow?symbol=f&path=a.js&depth=1').then(r => r.json());
        expect([flow.root, flow.nodes.map(n => n.name), flow.mermaid.split('\n')[0]]).toEqual(['a.js#f', ['f', 'g'], 'flowchart LR']);
        expect((await fetch(base + '/api/flow')).status).toBe(400);
        const history = await fetch(base + '/api/history?path=a.js&symbol=f').then(r => r.json());
        expect(history.commits.map(c => c.subject)).toEqual(['main touches a', 'change f', 'first']);
        expect((await fetch(base + '/api/history')).status).toBe(400);
    });
});
