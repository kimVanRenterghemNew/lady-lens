/**
 * GraphSync fills and maintains the PROJECT scope of the Ladybug graph.
 * Real Ladybug database per test (temp dir), real files, no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, deriveProjectRelations } from '../core/graph/index.js';
import { createGraphRepository, PROJECT_SCOPE, fileNodeId, analyzeSource } from '../core/graph/index.js';

const SETTINGS = {
    project: {
        graph_roots: ['.'],
        exclude_dirs: ['.git', '.memory', 'node_modules', 'knowledge', 'backlog/adhoc'],
        graph_extensions: ['.js', '.mjs', '.md']
    },
    graph: { ast: { enabled: false } }
};

const BASE = {
    'kura.js': "import { a } from './core/a.js';\nexport const main = () => a();\n",
    'core/a.js': "/**\n * Session status helper.\n */\nimport { b } from './b.js';\nexport function a() { return b(); }\n",
    'core/b.js': "export const b = () => 1;\n",
    'test/a.test.js': "import { a } from '../core/a.js';\ntest('a', () => a());\n",
    'docs/decision.md': '---\ntitle: OAuth decision\nlinks:\n  - target: feature\n    relation: implements\n---\nBody.\n',
    'docs/feature.md': '# OAuth feature\n'
};

function writeRepo(root, files) {
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    }
}

describe('GraphSync on the Ladybug graph', () => {
    let root;
    let repository;
    let sync;

    const projectGraph = async () => repository.loadGraph({ scopes: [PROJECT_SCOPE] });

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'graphsync-'));
        writeRepo(root, BASE);
        repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph', 'project.lbdb') });
        sync = createGraphSync({ root, repository, settings: SETTINGS });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('Given an empty database, When status() runs, Then it is stale and lists every file as new', async () => {
        const status = await sync.status();

        expect(status).toMatchObject({ exists: false, stale: true, nodes: 0 });
        expect(status.newFiles.sort()).toEqual(['core/a.js', 'core/b.js', 'docs/decision.md', 'docs/feature.md', 'kura.js', 'test/a.test.js']);
    });

    it('Given a fresh repo, When sync() runs, Then code files, tests, documents and their relations are in Ladybug', async () => {
        const result = await sync.sync();

        expect(result).toMatchObject({ added: 6, updated: 0, removed: 0, wrote: true, nodes: 6 });
        const { nodes, edges } = await projectGraph();
        const byPath = Object.fromEntries(nodes.map(node => [node.path, node]));
        expect(byPath['core/a.js']).toMatchObject({ id: 'file:core/a.js', type: 'CodeFile', kind: 'source', exports: ['a'], purpose: 'Session status helper.' });
        expect(byPath['test/a.test.js']).toMatchObject({ type: 'CodeFile', kind: 'test' });
        expect(byPath['docs/decision.md']).toMatchObject({ id: 'doc:docs/decision.md', type: 'Document', title: 'OAuth decision' });
        const labels = edges.map(edge => `${edge.from} -${edge.type}-> ${edge.to}`);
        expect(labels).toEqual(expect.arrayContaining([
            'file:kura.js -IMPORTS-> file:core/a.js',
            'file:core/a.js -IMPORTS-> file:core/b.js',
            'file:test/a.test.js -TESTS-> file:core/a.js',
            'doc:docs/decision.md -implements-> doc:docs/feature.md'
        ]));
        expect(edges.every(edge => edge.confidence === 'EXTRACTED')).toBe(true);
    });

    it('Given nothing changed, When sync() runs again, Then nothing is written', async () => {
        await sync.sync();

        expect(await sync.sync()).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 6, wrote: false });
    });

    it('Given one changed file, When sync() runs, Then exactly that file is re-indexed and its INCOMING edges survive', async () => {
        await sync.sync();
        writeRepo(root, { 'core/b.js': 'export const b = () => 1;\nexport const extra = 2;\n' });

        const result = await sync.sync();

        expect(result).toMatchObject({ added: 0, updated: 1, removed: 0, unchanged: 5, wrote: true });
        const { nodes, edges } = await projectGraph();
        expect(nodes.find(node => node.path === 'core/b.js').exports).toEqual(['b', 'extra']);
        expect(edges.map(edge => `${edge.from}->${edge.to}`)).toContain('file:core/a.js->file:core/b.js');
    });

    it('Given a deleted file, When sync() runs, Then its node and all its edges are gone', async () => {
        await sync.sync();
        fs.rmSync(path.join(root, 'core/b.js'));

        expect(await sync.sync()).toMatchObject({ removed: 1, wrote: true });
        const { nodes, edges } = await projectGraph();
        expect(nodes.map(node => node.path)).not.toContain('core/b.js');
        expect(edges.some(edge => edge.to === 'file:core/b.js' || edge.from === 'file:core/b.js')).toBe(false);
    });

    it('Given /code wrote a new file, When touch() runs, Then only that file is added', async () => {
        await sync.sync();
        writeRepo(root, { 'core/hello.js': "import { b } from './b.js';\nexport const hello = () => b();\n" });

        expect(await sync.touch(['core/hello.js'])).toMatchObject({ added: 1, updated: 0, removed: 0, wrote: true });
        const { nodes, edges } = await projectGraph();
        expect(nodes.map(node => node.path)).toContain('core/hello.js');
        expect(edges.map(edge => `${edge.from}->${edge.to}`)).toContain('file:core/hello.js->file:core/b.js');
    });

    it('Given touch() for a file that no longer exists, Then it is removed', async () => {
        await sync.sync();
        fs.rmSync(path.join(root, 'core/b.js'));

        expect(await sync.touch(['core/b.js'])).toMatchObject({ removed: 1 });
    });

    it('never indexes node_modules, .memory, knowledge or generated backlog plans', async () => {
        writeRepo(root, {
            'node_modules/x/index.js': 'export const x = 1;',
            'knowledge/old.md': '# old',
            'backlog/adhoc/plan/task.md': '# task with invented paths',
            '.memory/s/scratch.js': 'export const s = 1;',
            'src/node_modules/y/index.js': 'export const y = 1;'
        });

        await sync.sync();

        const paths = (await projectGraph()).nodes.map(node => node.path);
        expect(paths.filter(file => /node_modules|knowledge|backlog\/adhoc|\.memory/.test(file))).toEqual([]);
    });

    it('keeps nested folders whose NAME is also an excluded top-level dir (boards/personas inside core)', async () => {
        writeRepo(root, { 'core/governance/boards/boards.js': 'export const boards = [];' });

        await sync.sync();

        expect((await projectGraph()).nodes.map(node => node.path)).toContain('core/governance/boards/boards.js');
    });

    it('reset() empties the project scope and leaves session scopes alone', async () => {
        await sync.sync();
        await repository.replaceScope('session:s1', { nodes: [{ id: 'decision:x', type: 'Decision', title: 'X' }], edges: [] });

        await sync.reset();

        const stats = await repository.stats();
        expect(stats.scopes[PROJECT_SCOPE] || 0).toBe(0);
        expect(stats.scopes['session:s1']).toBe(1);
    });

    it('keeps a file with a syntax error as a node with parseError and still finds its imports', () => {
        const facts = analyzeSource("import { z } from './z.js';\nexport const = ;");

        expect(facts.parseError).toBeTruthy();
        expect(facts.imports).toEqual(['./z.js']);
    });

    it('derives relations deterministically and ignores imports that resolve to nothing', () => {
        const files = new Map([
            ['core/a.js', { type: 'CodeFile', kind: 'source', metadata: { imports: ['./b.js', './missing.js'] } }],
            ['core/b.js', { type: 'CodeFile', kind: 'source', metadata: { imports: [] } }]
        ]);

        expect(deriveProjectRelations(files, 'T')).toEqual([
            { from: fileNodeId('core/a.js'), to: fileNodeId('core/b.js'), relation: 'IMPORTS', confidence: 'EXTRACTED', createdAt: 'T' }
        ]);
    });

    it('produces node ids through the shared normalizer', async () => {
        writeRepo(root, { 'core/MixedCase_File.js': 'export const m = 1;' });
        await sync.sync();

        expect((await projectGraph()).nodes.map(node => node.id)).toContain('file:core/mixedcase-file.js');
    });
});
