/**
 * the agent tools `imports`/`importedBy`, `graph_query` and the `grep` hint answer an import question the SAME way.
 * A small repo is indexed into the (worker-isolated) project graph the same way /plan does it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { imports, importedBy, interfacesForScope, grep, graph_query, RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS } from '../core/search/index.js';
import { createGraphRepository, createGraphSync } from '../core/graph/index.js';
import { loadProjectSettings } from '../core/repository/index.js';
import { configureLensRoot, REPO_ROOT } from '../core/configuration/index.js';

const noRefresh = { refresh: async () => ({ checked: false }) };
let root;
let graphFlag;

const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};

beforeAll(async () => {
    graphFlag = process.env.LENS_PROJECT_GRAPH;
    process.env.LENS_PROJECT_GRAPH = '1'; // the suite switches the project graph off; this test needs it
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-tools-'));
    write('core/hub.js', 'export const hub = 1;\n');
    for (let i = 0; i < 15; i++) write(`core/user${String(i).padStart(2, '0')}.js`, "import { hub } from './hub.js';\nexport const u = hub;\n");
    write('core/a.js', "import { hub } from './hub.js';\nimport './b.js';\nexport const a = hub;\n");
    write('core/b.js', 'export const b = 1;\n');
    write('core/sym.js', 'export const before = 1;\n\nexport function locatedThing(a) {\n    const x = a + 1;\n    return x;\n}\n');
    write('test/hub.test.js', "import { hub } from '../core/hub.js';\n");
    await createGraphSync({ root, repository: createGraphRepository(), settings: await loadProjectSettings() }).sync({ mode: 'full' });
});
afterAll(() => {
    if (graphFlag === undefined) delete process.env.LENS_PROJECT_GRAPH; else process.env.LENS_PROJECT_GRAPH = graphFlag;
    fs.rmSync(root, { recursive: true, force: true });
});

const expectedImporters = [...Array.from({ length: 15 }, (_, i) => `core/user${String(i).padStart(2, '0')}.js`), 'core/a.js'].sort();

describe('imports / importedBy', () => {
    it('importedBy returns every importer of a hub, complete and sorted, without the test', async () => {
        const result = await importedBy({ file: 'core/hub.js' }, noRefresh);
        expect(result).toMatchObject({ file: 'core/hub.js', relation: 'importedBy', count: 16, truncated: false });
        expect(result.files).toEqual(expectedImporters);
    });
    it('imports returns what a file imports', async () => {
        expect((await imports({ file: 'core/a.js' }, noRefresh)).files).toEqual(['core/b.js', 'core/hub.js']);
    });
    it('a spelled-differently reference gives the same answer', async () => {
        expect((await importedBy({ file: './core/hub.js' }, noRefresh)).files).toEqual(expectedImporters);
        expect((await importedBy({ file: 'hub.js' }, noRefresh)).files).toEqual(expectedImporters);
    });
    it('a file that is not in the graph is an error that says so (not "0 importers")', async () => {
        const result = await importedBy({ file: 'core/ghost.js' }, noRefresh);
        expect(result.error).toMatch(/not in the project graph/);
        expect(result.files).toBeUndefined();
    });
    it('the graph is refreshed before answering, and the answer says so', async () => {
        let calls = 0;
        const result = await importedBy({ file: 'core/b.js' }, { refresh: async () => { calls += 1; return { checked: true, synced: false }; } });
        expect(calls).toBe(1);
        expect(result.freshness).toEqual({ checked: true, synced: false });
    });
    it('a file argument is required', async () => {
        expect((await importedBy({}, noRefresh)).error).toMatch(/file is required/);
    });
    it('both tools are offered to the agents, with a schema', () => {
        expect(Object.keys(RESEARCH_TOOLS)).toEqual(expect.arrayContaining(['imports', 'importedBy']));
        expect(RESEARCH_TOOL_SCHEMAS.map(tool => tool.name)).toEqual(expect.arrayContaining(['imports', 'importedBy']));
    });
});

describe('graph_query gives the same answer as importedBy / imports', () => {
    const nodesWithout = (result, file) => result.nodes.map(node => node.path).filter(p => p && p !== file).sort();

    it('a path as node and the type spelled "import" still finds the importers (no empty answer)', async () => {
        const result = await graph_query({ node: 'core/hub.js', incoming: { type: 'import' } });
        expect(nodesWithout(result, 'core/hub.js')).toEqual(expectedImporters);
    });
    it('the default limit of 10 does not cut an import answer short', async () => {
        const result = await graph_query({ node: 'file:core/hub.js', incoming: { type: 'IMPORTS' } });
        expect(nodesWithout(result, 'core/hub.js')).toHaveLength(16);
    });
    it('outgoing imports agree with imports()', async () => {
        const result = await graph_query({ node: 'core/a.js', outgoing: { type: 'imports' } });
        expect(nodesWithout(result, 'core/a.js')).toEqual((await imports({ file: 'core/a.js' }, noRefresh)).files);
    });
});

describe('grep on an import pattern', () => {
    it('zero matches on a repo path pattern points to importedBy (grep cannot see who imports a path)', () => {
        const result = grep({ pattern: "from '\\.\\./core/doesNotExistAnywhere\\.js'", path: 'core/search' });
        expect(result.totalCount).toBe(0);
        expect(result.hint).toMatch(/importedBy/);
    });
    it('a plain zero-match search gets no hint; a search with matches gets none either', () => {
        expect(grep({ pattern: `zzz${'NoSuch'}Identifier999`, path: 'core/search' }).hint).toBeUndefined();
        expect(grep({ pattern: 'isSafePath', path: 'core/configuration/paths.js' }).hint).toBeUndefined();
    });
});


describe('graph_query: a symbol resolves to path + line range', () => {
    it('a symbol named in the question comes back with its lines', async () => {
        const result = await graph_query({ query: 'where is locatedThing implemented' });
        expect(result.symbols).toEqual([{ name: 'locatedThing', path: 'core/sym.js', startLine: 3, endLine: 6 }]);
    });
    it('no symbol named -> an empty list, not missing', async () => {
        expect((await graph_query({ query: 'nothing recognisable here' })).symbols).toEqual([]);
    });
});

describe('interfacesForScope', () => {
    it('returns empty string when no files provided', async () => {
        expect(await interfacesForScope({ files: [] })).toBe('');
        expect(await interfacesForScope()).toBe('');
    });

    it('renders interfaces for files in scope', async () => {
        const res = await interfacesForScope({ files: ['core/a.js'] }, noRefresh);
        expect(typeof res).toBe('string');
    });

    it('respects custom maxChars budget', async () => {
        const res = await interfacesForScope({ files: ['core/a.js'], maxChars: 50 }, noRefresh);
        expect(res.length).toBeLessThanOrEqual(150);
    });
});

describe('Kura 2026-11-04: graph_query node mode answers like query mode (B1)', () => {
    it('incoming without a type: imports before calls, the cut is said, and the start node has consequences and risks', async () => {
        const result = await graph_query({ node: 'file:core/Hub.js', incoming: true, limit: 5 });
        expect(result.edges.slice(0, 4).every(edge => edge.type === 'IMPORTS')).toBe(true);
        expect(result).toMatchObject({ total: 17, truncated: true }); // 16 importers and the test
        expect(result.hint).toContain('17 neighbours');
        const start = result.nodes.find(node => node.path === 'core/hub.js');
        expect(start.consequences).toMatchObject({ importedBy: 16 });
        expect(Array.isArray(start.risks)).toBe(true);
    });
    it('a node without a direction still gets its consequences; an uncut answer says truncated: false', async () => {
        expect((await graph_query({ node: 'file:core/hub.js' })).nodes[0].consequences).toMatchObject({ importedBy: 16 });
        expect(await graph_query({ node: 'core/a.js', outgoing: true, limit: 50 })).toMatchObject({ total: 2, truncated: false });
    });
});

describe('Kura 2026-11-04: a documentation question about a file (B3)', () => {
    let previousRoot;
    afterAll(() => configureLensRoot(previousRoot));
    beforeAll(async () => {
        previousRoot = REPO_ROOT;
        configureLensRoot(root); // the document lines are read from the active repository
        write('docs/router.md', '# Router\nThe router lives in core/hub.js and decides.\n');
        write('docs/words.md', '# Hub words\nA hub is a central thing; hub hub hub.\n');
        await createGraphSync({ root, repository: createGraphRepository(), settings: await loadProjectSettings() }).sync();
    });
    it('the documents that name the path come first, with the lines; a word match has no `mentions`', async () => {
        const result = await graph_query({ query: 'core/hub.js', kind: 'doc', limit: 5 });
        expect(result.nodes[0]).toMatchObject({ path: 'docs/router.md', mentions: 'path', lines: [2] });
        expect(result.nodes.filter(node => node.mentions !== 'path').every(node => !String(node.path).includes('router'))).toBe(true);
    });
});

describe('Kura 2026-11-04: tool schemas say who uses them and whether they write (B2)', () => {
    it('the discussion tools are for /discuss and /research; save and edit write, the rest only reads', () => {
        const discussion = RESEARCH_TOOL_SCHEMAS.filter(schema => schema.name.startsWith('discussion_'));
        expect(discussion).toHaveLength(5);
        expect(discussion.every(schema => schema.usedBy.join() === '/discuss,/research')).toBe(true);
        expect(discussion.filter(schema => !schema.readOnly).map(schema => schema.name).sort()).toEqual(['discussion_edit', 'discussion_save']);
        expect(RESEARCH_TOOL_SCHEMAS.find(schema => schema.name === 'grep').readOnly).toBe(true);
    });
});
