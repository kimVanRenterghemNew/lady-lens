/**
 * Dashboard call tree, flow diagram and history (backlog/dashboard-ontwikkelaar.md, AC3, AC5, AC7, J4, J5, J7):
 * the call chain up and down to a chosen depth, its Mermaid text, and the commits, last change, co-changes and
 * hotspot of a function or file; without git the history is empty and does not fail.
 */
import { describe, it, expect } from 'vitest';
import { callFlow, toMermaid, codeHistory } from '../core/search/index.js';
import { createFakeGit } from '../core/git/index.js';
import { SCENARIO } from './helpers/gitScenario.js';

// main -> parse -> token; handler and cli call main; cli also from top-level code of bin.js
const VIEWS = {
    main: { definitions: [{ path: 'core/main.js', startLine: 3 }], calls: [{ name: 'parse', path: 'core/parse.js', lines: [1, 9] }, { name: 'log', path: null }], callers: [{ path: 'core/handler.js', lines: [12], functions: ['handler'] }, { path: 'README.md', lines: [4], reference: true }] },
    parse: { definitions: [{ path: 'core/parse.js', startLine: 1 }], calls: [{ name: 'token', path: 'core/token.js', lines: [2, 4] }], callers: [] },
    token: { definitions: [{ path: 'core/token.js', startLine: 2 }], calls: [], callers: [] },
    handler: { definitions: [{ path: 'core/handler.js', startLine: 10 }], calls: [], callers: [{ path: 'bin.js', lines: [5], functions: [] }] }
};
const view = async ({ symbol }) => VIEWS[symbol] ?? { definitions: [] };

describe('call flow', () => {
    it('J5: walks callees down and callers up to the depth; references and calls outside the graph are left out', async () => {
        const flow = await callFlow({ symbol: 'main', depth: 2, view });
        expect(flow.root).toBe('core/main.js#main');
        expect(flow.nodes.map(n => [n.name, n.level])).toEqual([['main', 0], ['handler', -1], ['parse', 1], ['bin.js', -2], ['token', 2]]);
        expect(flow.edges).toEqual(expect.arrayContaining([
            { from: 'core/main.js#main', to: 'core/parse.js#parse' }, { from: 'core/parse.js#parse', to: 'core/token.js#token' },
            { from: 'core/handler.js#handler', to: 'core/main.js#main' }, { from: 'bin.js#bin.js', to: 'core/handler.js#handler' }
        ]));
        expect(flow.truncated).toBe(false);
    });

    it('stops at depth 1, goes one way only, cuts at the limit, and an unknown symbol is an empty flow', async () => {
        expect((await callFlow({ symbol: 'main', depth: 1, direction: 'down', view })).nodes.map(n => n.name)).toEqual(['main', 'parse']);
        expect((await callFlow({ symbol: 'main', depth: 3, direction: 'up', view })).nodes.map(n => n.name)).toEqual(['main', 'handler', 'bin.js']);
        expect(await callFlow({ symbol: 'main', limit: 2, view })).toMatchObject({ truncated: true });
        expect(await callFlow({ symbol: 'nope', view })).toEqual({ root: null, nodes: [], edges: [], truncated: false });
        expect(await callFlow({ view })).toEqual({ error: 'symbol is required' });
    });

    it('AC5: Mermaid text names each node with its file, draws each edge and marks the root', async () => {
        const flow = await callFlow({ symbol: 'main', depth: 1, view });
        expect(toMermaid(flow, [flow.root]).split('\n')).toEqual([
            'flowchart LR',
            '  n0["main<br/><small>core/main.js</small>"]',
            '  n1["handler<br/><small>core/handler.js</small>"]',
            '  n2["parse<br/><small>core/parse.js</small>"]',
            '  n1 --> n0',
            '  n0 --> n2',
            '  classDef marked stroke-width:3px',
            '  class n0 marked'
        ]);
        expect(toMermaid({ nodes: [{ id: 'a', name: 'say "hi"', path: 'x.js' }] })).toBe('flowchart LR\n  n0["say #quot;hi#quot;<br/><small>x.js</small>"]');
    });
});

describe('call flow edges', () => {
    it('picks the definition in the given file, survives a failing view, and Mermaid skips edges to unknown nodes', async () => {
        const twice = { definitions: [{ path: 'x.js', startLine: 1 }, { path: 'y.js', startLine: 7 }], calls: [{ name: 'boom', path: 'z.js' }], callers: [] };
        const flaky = async ({ symbol }) => { if (symbol === 'boom') throw new Error('graph locked'); return twice; };
        const flow = await callFlow({ symbol: 'f', path: 'y.js', depth: 'x', view: flaky });
        expect([flow.root, flow.nodes.map(n => [n.id, n.line])]).toEqual(['y.js#f', [['y.js#f', 7], ['z.js#boom', null]]]);
        expect(toMermaid({ nodes: [{ id: 'a', name: 'a', path: 'a.js' }], edges: [{ from: 'a', to: 'gone' }] }, ['gone'])).toBe('flowchart LR\n  n0["a<br/><small>a.js</small>"]');
        expect(toMermaid()).toBe('flowchart LR');
    });
});

describe('code history', () => {
    const graph = {
        nodes: [{ id: 'file:a.js', type: 'CodeFile', path: 'a.js', lines: 3 }, { id: 'file:b.js', type: 'CodeFile', path: 'b.js', lines: 1 }, { id: 'file:new.js', type: 'CodeFile', path: 'new.js', lines: 3 }],
        edges: [{ from: 'file:b.js', to: 'file:a.js', type: 'CO_CHANGES', weight: 2 }, { from: 'file:a.js', to: 'file:new.js', type: 'CO_CHANGES', weight: 5 }]
    };

    it('J7: the commits that changed the function, who changed it last, the co-changed files and the hotspot sign', () => {
        const h = codeHistory({ path: 'a.js', symbol: 'f', root: '.', graph, git: createFakeGit(SCENARIO) });
        expect(h.commits.map(c => [c.subject, c.change])).toEqual([['main touches a', 'modified'], ['change f', 'modified'], ['first', 'added']]);
        expect(h.commits[0]).toEqual(expect.objectContaining({ sha: expect.any(String), date: expect.any(String), author: 'Tess' }));
        expect(h.lastChange.subject).toBe('main touches a');
        expect(h.coChanges).toEqual([{ path: 'new.js', weight: 5 }, { path: 'b.js', weight: 2 }]);
        expect([h.churn, h.hotspot]).toEqual([3, true]);
    });

    it('a file without a symbol gives its own commits; without git everything is empty, not an error', () => {
        expect(codeHistory({ path: 'b.js', root: '.', graph, git: createFakeGit(SCENARIO) }).commits.map(c => c.subject)).toEqual(['rename and add']);
        expect(codeHistory({ path: 'a.js', symbol: 'f', root: '.', graph, git: createFakeGit(null) })).toEqual({ path: 'a.js', symbol: 'f', commits: [], lastChange: null, coChanges: [{ path: 'new.js', weight: 5 }, { path: 'b.js', weight: 2 }], churn: 0, hotspot: false });
    });
    it('a file outside the graph has no co-changes and is no hotspot; a co-change without weight counts once', () => {
        const git = createFakeGit(SCENARIO);
        expect(codeHistory({ path: 'docs/readme.md', root: '.', graph, git })).toMatchObject({ coChanges: [], hotspot: false, churn: 1 });
        const loose = { nodes: [...graph.nodes, { id: 'concept:x', type: 'Concept' }], edges: [{ from: 'file:b.js', to: 'file:a.js', type: 'CO_CHANGES' }, { from: 'file:a.js', to: 'concept:x', type: 'CO_CHANGES' }] };
        expect(codeHistory({ path: 'a.js', root: '.', graph: loose, git }).coChanges).toEqual([{ path: 'b.js', weight: 1 }]);
    });
});
