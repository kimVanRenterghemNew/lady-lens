/**
 * The folder view: "how does folder X work?" with its parts (role + exports), the flow between them, who uses it from
 * outside and what is not clean, all from the graph. Live 2026-10-26 a model got only folder names and invented
 * `class Entity`, CommonJS and yargs; this is what it gets instead.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, folderView, renderFolderView, reexportedPackage } from '../core/graph/index.js';

function fixture() {
    const graph = createGraph('t');
    const code = (path, extra = {}) => graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10, ...extra });
    code('core/x/index.js', { exports: ['open', 'find'], purpose: 'The x module: storage and lookup.' });
    code('core/x/store/index.js', { exports: ['open'], purpose: 'Storage: opens the database.' });
    code('core/x/store/db.js', { exports: ['open'], purpose: 'Opens the database file.' });
    code('core/x/find/index.js', { exports: ['find'] });
    code('core/x/find/rank.js', { exports: ['rank'], purpose: 'Ranks the hits.' });
    code('core/x/find/match.js', { exports: ['find'], purpose: 'Finds matching rows.' });
    code('core/x/util.js', { exports: ['clip'], purpose: 'Clips text.' });
    code('core/xx/other.js', { exports: ['nope'], purpose: 'Another folder with the same prefix.' });
    code('core/app/main.js', { exports: ['main'] });
    graph.addNode('file:test/x.test.js', 'CodeFile', { path: 'test/x.test.js', kind: 'test' });
    const edge = (from, to, type = 'IMPORTS') => graph.addEdge(`file:${from}`, `file:${to}`, type, 1);
    edge('core/x/index.js', 'core/x/store/index.js');
    edge('core/x/index.js', 'core/x/find/index.js');
    edge('core/x/store/index.js', 'core/x/store/db.js');
    edge('core/x/find/index.js', 'core/x/find/match.js');
    edge('core/x/find/match.js', 'core/x/find/rank.js');
    edge('core/x/find/match.js', 'core/x/store/index.js');
    edge('core/x/find/match.js', 'core/x/store/db.js', 'CALLS');
    edge('core/app/main.js', 'core/x/index.js');
    edge('core/app/main.js', 'core/x/find/match.js', 'CALLS');
    edge('core/app/main.js', 'core/xx/other.js');
    edge('test/x.test.js', 'core/x/index.js', 'TESTS');
    return graph;
}

describe('folderView', () => {
    it('gives the parts with their role and exports, the flow between them, its users and its tests', () => {
        const view = folderView(fixture(), 'core/x/');
        expect(view).toMatchObject({ folder: 'core/x', found: true, files: 7 });
        expect(view.entry).toMatchObject({ path: 'core/x/index.js', exportCount: 2, purpose: 'The x module: storage and lookup.', package: null });
        expect(view.parts.map(part => part.part)).toEqual(['find/', 'store/', 'util.js']);
        expect(view.parts.find(part => part.part === 'store/')).toMatchObject({ roles: [{ file: 'index.js', purpose: 'Storage: opens the database.' }], exports: ['open'] });
        expect(view.flow).toEqual([{ from: 'find/', to: 'store/', imports: 1, calls: 1 }]);
        expect(view.usedBy).toMatchObject({ files: 1, tests: 1, folders: [{ folder: 'core/app', files: 1 }] });
    });

    it('names where the folder is wired in: the files that CALL into it, with their purpose and what points at them; MUST NOT count a test', () => {
        const graph = fixture();
        graph.addNode('ioc:finder', 'IocType', { name: 'finder' });
        graph.addEdge('ioc:finder', 'file:core/app/main.js', 'REGISTERED_IN', 1);
        graph.addNode('file:core/app/main.js', 'CodeFile', { path: 'core/app/main.js', kind: 'source', exports: ['main'], purpose: 'Composition: registers the finder.' });
        graph.addEdge('file:test/x.test.js', 'file:core/x/find/match.js', 'CALLS', 1);
        const { callers } = folderView(graph, 'core/x').usedBy;
        expect(callers).toEqual([{ path: 'core/app/main.js', calls: 1, purpose: 'Composition: registers the finder.', pointedBy: [{ node: 'finder', type: 'IocType', relation: 'REGISTERED_IN' }] }]);
        expect(renderFolderView(folderView(graph, 'core/x'))).toContain('core/app/main.js (1 calls): Composition: registers the finder.; IocType "finder" REGISTERED_IN');
    });

    it('MUST let a part without a header speak through its most used files, never invent a role', () => {
        const find = folderView(fixture(), 'core/x').parts.find(part => part.part === 'find/');
        expect(find.roles.map(item => item.file)).toEqual(['match.js', 'rank.js']);
        expect(renderFolderView(folderView(fixture(), 'core/x'))).toContain('match.js: Finds matching rows.');
    });

    it('MUST NOT take a folder with the same prefix, a test or the folder itself as a part or a user', () => {
        const all = JSON.stringify(folderView(fixture(), 'core/x'));
        expect(all).not.toMatch(/core\/xx|other\.js|x\.test\.js/);
    });

    it('says not found for a folder without code instead of describing it', () => {
        expect(folderView(fixture(), 'core/nothing')).toEqual({ folder: 'core/nothing', found: false });
        expect(renderFolderView({ found: false })).toBe('');
    });

    it('sees a barrel that only passes on a package, and MUST NOT take a relative re-export for one', () => {
        expect(reexportedPackage("import x from 'y';\nexport * from 'lady-lens';\n")).toBe('lady-lens');
        expect(reexportedPackage("export * from './model/index.js';\n")).toBeNull();
    });

    it('renders in the order of a good explanation and stays within its budget', () => {
        const text = renderFolderView(folderView(fixture(), 'core/x'));
        const order = ['Entry:', '| part |', 'Flow inside', 'Used from outside', 'Not clean'].map(mark => text.indexOf(mark));
        expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true);
        expect(renderFolderView(folderView(fixture(), 'core/x'), { maxChars: 120 }).length).toBeLessThan(200);
    });

    it('names a registration named like the folder (a composition type "x.find" for core/x) with where it points, at the top; MUST NOT match another name', () => {
        const graph = fixture();
        graph.addNode('ioc:x.find', 'IocType', { name: 'x.find', purpose: 'The finder of x.' });
        graph.addNode('ioc:xx', 'IocType', { name: 'xx', purpose: 'Not x.' });
        graph.addEdge('ioc:x.find', 'file:core/app/main.js', 'REGISTERED_IN', 1);
        const view = folderView(graph, 'core/x');
        expect(view.registeredAs).toEqual([{ name: 'x.find', type: 'IocType', description: 'The finder of x.', at: [{ relation: 'REGISTERED_IN', path: 'core/app/main.js' }] }]);
        const text = renderFolderView(view);
        expect(text.indexOf('Registered as IocType "x.find" (REGISTERED_IN core/app/main.js): The finder of x.')).toBeLessThan(text.indexOf('| part |'));
    });

    it('shows the real start of the registering file, so a model follows that pattern; MUST NOT show code without a registration or an unreadable file', () => {
        const graph = fixture();
        graph.addNode('ioc:x.find', 'IocType', { name: 'x.find' });
        graph.addEdge('ioc:x.find', 'file:core/app/main.js', 'REGISTERED_IN', 1);
        const readFile = (path) => (path === 'core/app/main.js' ? "// composition\r\nimport { find } from '../x/index.js';\r\n\r\n\r\nexport const main = () => find();\r\n" : null);
        const view = folderView(graph, 'core/x', { readFile });
        expect(view.registrationCode).toEqual([{ path: 'core/app/main.js', code: "// composition\nimport { find } from '../x/index.js';\n\nexport const main = () => find();" }]);
        expect(renderFolderView(view)).toContain('How it is registered (the real start of core/app/main.js; follow this pattern):');
        expect(folderView(fixture(), 'core/x', { readFile }).registrationCode).toEqual([]);
        expect(folderView(graph, 'core/x').registrationCode).toEqual([]);
    });

    it('says in words that a folder nothing uses looks unused; MUST NOT say so of a used folder', () => {
        const graph = fixture();
        graph.addNode('file:core/dead/old.js', 'CodeFile', { path: 'core/dead/old.js', kind: 'source', exports: ['old'] });
        expect(renderFolderView(folderView(graph, 'core/dead'))).toContain('Nothing outside core/dead/ uses it at runtime');
        expect(renderFolderView(folderView(graph, 'core/x'))).not.toContain('looks unused');
    });

    it('MUST NOT call files untested in a graph without any test (an installed package): it says nothing is known', () => {
        const graph = fixture();
        graph.nodes.delete('file:test/x.test.js');
        graph.edges = graph.edges.filter(edge => edge.type !== 'TESTS');
        const view = folderView(graph, 'core/x');
        expect(view.usedBy.tests).toBeNull();
        expect(view.notClean.untested).toBeNull();
        const text = renderFolderView(view);
        expect(text).toContain('no tests in this graph');
        expect(text).not.toMatch(/untested|reached by 0/);
    });

    it('renders issues in notClean and handles edge cases of renderFolderView', () => {
        expect(renderFolderView(null)).toBe('');
        const mockView = {
            found: true,
            folder: 'core/bad',
            files: 3,
            entry: { path: 'core/bad/index.js', purpose: '', exportCount: 0, exports: [] },
            parts: [{ part: 'p1', files: 1, roles: [], exports: ['exp1'], exportCount: 3 }],
            flow: [{ from: 'p1', to: 'p2', imports: 2, calls: 1 }],
            usedBy: { files: 0, tests: 1, folders: [], callers: [{ path: 'core/call.js', calls: 1, purpose: '', pointedBy: [] }] },
            notClean: {
                untested: ['core/bad/a.js', 'core/bad/b.js', 'core/bad/c.js', 'core/bad/d.js', 'core/bad/e.js', 'core/bad/f.js'],
                inCycles: ['core/bad/a.js'],
                boundary: ['core/bad/b.js']
            }
        };
        const rendered = renderFolderView(mockView);
        expect(rendered).toContain('untested: core/bad/a.js');
        expect(rendered).toContain('in import cycles: core/bad/a.js');
        expect(rendered).toContain('imports past a module\'s index.js: core/bad/b.js');
        expect(rendered).toContain('Nothing outside core/bad/ uses it at runtime (only tests)');
    });
});
