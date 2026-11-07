/**
 * diff_impact (backlog diff-impact-en-graafvragen.md, J1 to J4): from a diff to the functions it changes, their callers,
 * tests and test gaps; bound against unbound calls; functionView for a class. Fake git, memory store, files in a temp folder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createFakeGit, fakeSha } from '../core/git/index.js';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
import { changedFunctions } from '../core/branches/index.js';
import { diffImpact, viewOf } from '../core/search/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
const F1 = 'export function f(a) {\n  return a + 1;\n}\n\nexport function h() {\n  return 0;\n}\n';
const F2 = 'export function f(a) {\n  if (a) return 2;\n  return a + 1;\n}\n\nexport function h() {\n  return 0;\n}\n';
const G = "import { f } from './f.js';\n\nexport function g() {\n  return f(1);\n}\n";
let root, repository;

const write = files => { for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); } };
const readFile = file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const state = (worktree, extraCommits = []) => ({
    commits: [{ name: 'c1', parents: [], files: { 'core/f.js': F1, 'core/g.js': G } }, ...extraCommits],
    branches: { main: extraCommits.at(-1)?.name ?? 'c1' }, head: 'main', worktree
});
const run = async (args, git) => {
    await createGraphSync({ root, repository, settings: SETTINGS, contribute: false }).syncFiles({ mode: 'full' });
    return diffImpact(args, { refresh: async () => null, git, repository, readFile });
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-diffimpact-'));
    repository = createGraphRepository({ store: createMemoryRepositoryStore() });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('diff_impact', () => {
    it('J1: a changed function, its caller in another file, and no test: a test gap', async () => {
        write({ 'core/f.js': F2, 'core/g.js': G });
        const result = await run({}, createFakeGit(state({ 'core/f.js': F2 })));
        expect(result.source).toBe('worktree');
        expect(result.functions.map(fn => [fn.function, fn.change])).toEqual([['f', 'modified']]);
        const [f] = result.functions;
        expect(f.callers).toEqual([{ path: 'core/g.js', lines: [4] }]);
        expect(f.testGap).toBe(true);
        expect(f.complexity).toBe(2);
        expect(result.testGaps).toEqual(['core/f.js#f']);
        expect(result).toMatchObject({ total: 1, truncated: false });
    });

    it('J1: a change that touches no function (a comment) gives an empty list without error', async () => {
        write({ 'core/f.js': `// note\n${F1}`, 'core/g.js': G });
        const result = await run({}, createFakeGit(state({ 'core/f.js': `// note\n${F1}` })));
        expect(result.error).toBeUndefined();
        expect(result.functions).toEqual([]);
    });

    it('J2: the same change not committed and committed gives the same functions; the output says which was used', async () => {
        write({ 'core/f.js': F2, 'core/g.js': G });
        const worktree = await run({}, createFakeGit(state({ 'core/f.js': F2 })));
        const committed = await run({ from: fakeSha('c1'), to: 'main' }, createFakeGit(state({}, [{ name: 'c2', parents: ['c1'], files: { 'core/f.js': F2 } }])));
        expect(committed.source).toBe('range');
        expect(committed.functions.map(fn => fn.function)).toEqual(worktree.functions.map(fn => fn.function));
    });

    it('a limit cuts the list and says how many there are', async () => {
        write({ 'core/f.js': F2.replace('return 0;', 'return 9;'), 'core/g.js': G });
        const result = await run({ limit: 1 }, createFakeGit(state({ 'core/f.js': F2.replace('return 0;', 'return 9;') })));
        expect(result).toMatchObject({ total: 2, truncated: true });
        expect(result.functions).toHaveLength(1);
    });

    it('an unknown ref is an error, not an empty list', async () => {
        write({ 'core/f.js': F1, 'core/g.js': G });
        expect((await run({ from: 'nope' }, createFakeGit(state({})))).error).toContain('nope');
    });
});

describe('diff_impact edges', () => {
    it('a removed function has no graph view: no callers, no test gap; a repeated name is asked once', async () => {
        write({ 'core/g.js': G });
        const result = await run({ limit: 'x' }, createFakeGit(state({ 'core/f.js': null })));
        expect(result.functions.map(fn => [fn.function, fn.change, fn.testGap, fn.callers.length, fn.resolved])).toEqual([['f', 'removed', false, 0, 0], ['h', 'removed', false, 0, 0]]);
    });

    it('a renamed function keeps its old name; non-code files are skipped; a Python function has its complexity', async () => {
        const renamed = F1.replace('function f(a)', 'function fRenamed(a)');
        write({ 'core/f.js': renamed, 'core/g.js': G, 'tool.py': 'def run(x):\n    if x:\n        return 1\n    return 2\n' });
        const result = await run(null, createFakeGit(state({ 'core/f.js': renamed, 'README.md': '# changed\n', 'tool.py': 'def run(x):\n    if x:\n        return 1\n    return 2\n' })));
        expect(result.files).toEqual(['core/f.js', 'README.md', 'tool.py']);
        const byName = Object.fromEntries(result.functions.map(fn => [fn.function, fn]));
        expect(byName.fRenamed).toMatchObject({ change: 'renamed', oldName: 'f', oldFile: 'core/f.js' });
        expect(byName.run).toMatchObject({ change: 'added', file: 'tool.py' });
        expect(byName.run.complexity).toBe(2); // the language parsers call it `cc`
    });

    it('outside a repository with the real git: no files, no functions, no error', () => {
        expect(changedFunctions({ root })).toMatchObject({ source: 'worktree', files: [], functions: [] });
    });

    it('two refs without common history are an error', () => {
        const git = createFakeGit({ commits: [{ name: 'a', parents: [], files: { 'x.js': 'export const x = 1;\n' } }, { name: 'b', parents: [], files: { 'y.js': 'export const y = 1;\n' } }], branches: { one: 'a', two: 'b' }, head: 'one' });
        expect(changedFunctions({ from: 'one', to: 'two', git }).error).toContain('no common history');
        expect(changedFunctions({ git }).functions).toEqual([]);
    });
});

describe('changed lines to functions (AC2)', () => {
    const git = (files, worktree) => createFakeGit({ commits: [{ name: 'c1', parents: [], files }], branches: { main: 'c1' }, head: 'main', worktree });
    const changed = (files, worktree) => changedFunctions({ git: git(files, worktree), readFile: file => worktree[file] ?? null }).functions.map(fn => `${fn.change} ${fn.name}`).sort();

    it('one function, two functions, a new file and a deleted file', () => {
        expect(changed({ 'a.js': F1 }, { 'a.js': F2 })).toEqual(['modified f']);
        expect(changed({ 'a.js': F1 }, { 'a.js': F2.replace('return 0;', 'return 9;') })).toEqual(['modified f', 'modified h']);
        expect(changed({}, { 'n.js': F1 })).toEqual(['added f', 'added h']);
        expect(changed({ 'a.js': F1 }, { 'a.js': null })).toEqual(['removed f', 'removed h']);
    });
});

describe('functionView: bound and unbound calls, classes (J3, J4)', () => {
    it('J3: a dynamic call and another run elsewhere: resolved and unresolved apart, "niet bewezen leeg"', async () => {
        write({
            'core/run.js': 'export function run() {\n  return 1;\n}\n',
            'core/use.js': "import * as mod from './run.js';\n\nexport function go(name = 'run') {\n  return mod[name]();\n}\n",
            'other/run.js': 'export function run() {\n  return 2;\n}\n',
            'other/call.js': 'export function start() {\n  return run();\n}\n'
        });
        await createGraphSync({ root, repository, settings: SETTINGS, contribute: false }).syncFiles({ mode: 'full' });
        const view = await viewOf(repository, 'run', { readFile });
        expect(view.resolved).toBe(0);
        expect(view.unresolved).toBeGreaterThan(0);
        expect(view.note).toContain('niet bewezen leeg');
    });

    it('J4: a class shows its methods and its subclass; maxSites returns more than 5 lines', async () => {
        const calls = Array.from({ length: 8 }, (_, i) => `  new Base().a(${i});`).join('\n');
        write({
            'core/base.js': 'export class Base {\n  a() {\n    return 1;\n  }\n\n  b() {\n    return 2;\n  }\n}\n',
            'core/sub.js': `import { Base } from './base.js';\n\nexport class Sub extends Base {\n  c() {\n    return 3;\n  }\n}\n\nexport function many() {\n${calls}\n}\n`
        });
        await createGraphSync({ root, repository, settings: SETTINGS, contribute: false }).syncFiles({ mode: 'full' });
        const view = await viewOf(repository, 'Base', { readFile });
        expect(view.children.map(child => child.name)).toEqual(['a', 'b']);
        expect(view.inheritors).toEqual([{ name: 'Sub', path: 'core/sub.js', line: 3 }]);
        const caller = (await viewOf(repository, 'Base', { readFile, maxSites: 20 })).callers.find(entry => entry.path === 'core/sub.js');
        expect(caller.lines.length).toBeGreaterThan(5);
        expect(view.callers.find(entry => entry.path === 'core/sub.js').lines).toHaveLength(5);
    });
});
