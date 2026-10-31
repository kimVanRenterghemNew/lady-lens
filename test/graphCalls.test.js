/**
 * Calls from acorn: which declared or imported function a file calls, from which function, on which line; the sync turns
 * them into CALLS relations to the file that declares the callee (through barrels). Every rule has a case it MUST reject.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeSource, deriveProjectRelations, createGraphSync, createGraphRepository, PROJECT_SCOPE, resolveCallee, fileNodeId } from '../core/graph/index.js';

describe('analyzeSource: calls', () => {
    it('records local and imported calls with the calling function, undoing an alias and following a namespace', () => {
        const source = [
            "import { load as read } from './store.js';",
            "import * as util from '../util/index.js';",
            'function helper() { return 1; }',
            'export function run(x) {',
            '  helper();',
            '  return read(util.trim(x));',
            '}',
            'run(1);'
        ].join('\n');

        expect(analyzeSource(source).calls).toEqual([
            ['run', 'helper', 5],
            ['run', 'load', 6, './store.js'],
            ['run', 'trim', 6, '../util/index.js'],
            ['', 'run', 8]
        ]);
    });

    it('MUST NOT make a short local closure a caller or a callee: its calls belong to the function around it', () => {
        const source = 'function helper() { return 1; }\nexport function run() {\n  const at = () => helper();\n  return at();\n}\n';
        expect(analyzeSource(source).calls).toEqual([['run', 'helper', 3]]);
    });

    it('MUST NOT record method calls, built-ins or package imports (they cannot be resolved to a repo file)', () => {
        const source = "import fs from 'fs';\nimport { join } from 'path';\nconst api = { go() {} };\napi.go();\nfs.readFileSync('x');\nJSON.parse('{}');\njoin('a');\n";
        expect(analyzeSource(source).calls).toEqual([]);
    });
});

describe('CALLS relations', () => {
    const files = new Map([
        ['core/h/run.js', { type: 'CodeFile', kind: 'source', metadata: { imports: ['../q/index.js'], calls: [['run', 'applyAnswers', 3, '../q/index.js'], ['run', 'applyAnswers', 9, '../q/index.js'], ['run', 'local', 4]] } }],
        ['core/q/index.js', { type: 'CodeFile', kind: 'source', metadata: { imports: ['./questions.js', './other.js'] } }],
        ['core/q/other.js', { type: 'CodeFile', kind: 'source', metadata: { imports: [], symbolRanges: { other: [1, 2] } } }],
        ['core/q/questions.js', { type: 'CodeFile', kind: 'source', metadata: { imports: [], symbolRanges: { applyAnswers: [1, 3] } } }]
    ]);

    it('point at the file that declares the callee (through the barrel), weighted by the number of call sites', () => {
        const calls = deriveProjectRelations(files, 'T').filter(relation => relation.relation === 'CALLS');
        expect(calls).toEqual([{ from: fileNodeId('core/h/run.js'), to: fileNodeId('core/q/questions.js'), relation: 'CALLS', confidence: 'EXTRACTED', weight: 2, createdAt: 'T' }]);
    });

    it('MUST NOT point at the barrel when a file behind it declares the name, nor at another file of the barrel', () => {
        const lookup = {
            has: (file) => files.has(file),
            declares: (file, name) => Boolean(files.get(file)?.metadata?.symbolRanges?.[name]),
            reexports: (file) => ({ 'core/q/index.js': ['core/q/questions.js', 'core/q/other.js'] })[file] ?? []
        };
        expect(resolveCallee({ from: 'core/h/run.js', name: 'applyAnswers', specifier: '../q/index.js' }, lookup)).toBe('core/q/questions.js');
        expect(resolveCallee({ from: 'core/h/run.js', name: 'other', specifier: '../q/index.js' }, lookup)).toBe('core/q/other.js');
        expect(resolveCallee({ from: 'core/h/run.js', name: 'x', specifier: 'some-package' }, lookup)).toBeNull();
    });
});

describe('a graph built before calls existed', () => {
    let root;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('re-reads an unchanged code file once when its stored facts are older, so its CALLS appear', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-calls-'));
        fs.mkdirSync(path.join(root, 'core'));
        fs.writeFileSync(path.join(root, 'core/a.js'), "import { b } from './b.js';\nexport function a() { return b(); }\n");
        fs.writeFileSync(path.join(root, 'core/b.js'), 'export function b() { return 1; }\n');
        const repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph', 'project.lbdb') });
        const settings = { project: { graph_roots: ['.'], exclude_dirs: ['.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
        const sync = createGraphSync({ root, repository, settings });
        await sync.sync({ mode: 'full' });
        // Simulate the old graph: the same files, stored without facts version and without calls or CALLS.
        const stored = (await repository.loadNodes({ scopes: [PROJECT_SCOPE] })).filter(node => node.type === 'CodeFile');
        const old = stored.map(node => ({ ...node, contentHash: node.contentHash, metadata: { ...node.metadata, facts: undefined, calls: undefined } }));
        await repository.applyProjectChanges({ upserts: old, removePaths: [], relations: [{ from: fileNodeId('core/a.js'), to: fileNodeId('core/b.js'), relation: 'IMPORTS', confidence: 'EXTRACTED', createdAt: 'T' }] });
        expect((await repository.loadGraph({ scopes: [PROJECT_SCOPE] })).edges.map(edge => edge.type)).not.toContain('CALLS');

        const result = await sync.sync();

        expect(result.updated).toBe(2);
        expect((await repository.loadGraph({ scopes: [PROJECT_SCOPE] })).edges.map(edge => `${edge.from} -${edge.type}-> ${edge.to}`)).toContain('file:core/a.js -CALLS-> file:core/b.js');
    });
});
