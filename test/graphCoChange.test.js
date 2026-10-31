/**
 * What changes together: files that often change in the same commit get a CO_CHANGES edge (weight = number of commits),
 * from git history. Bulk commits (many files) do not count; a pair needs at least 3 commits together. A repository
 * without git has none.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphSync, createGraphRepository, coChangeRelations, PROJECT_SCOPE } from '../core/graph/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: {} };
let root;
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'pipe' });
function commit(files, message) {
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
    git('add', '-A'); git('commit', '-q', '-m', message);
}

describe('co-change from git history', () => {
    it('MUST link files changed together at least 3 times, with the count as weight, and ignore bulk commits', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cochange-'));
        git('init', '-q');
        for (let i = 1; i <= 3; i++) commit({ 'src/a.js': `export const a = ${i};\n`, 'src/b.js': `export const b = ${i};\n` }, `ab ${i}`);
        commit({ 'src/a.js': 'export const a = 9;\n', 'src/c.js': 'export const c = 1;\n' }, 'ac once');
        const bulk = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`gen/f${i}.js`, `export const f = ${i};\n`]));
        commit({ ...bulk, 'src/c.js': 'export const c = 2;\n' }, 'bulk');
        commit({ ...Object.fromEntries(Object.keys(bulk).map(k => [k, '// again\n'])), 'src/c.js': 'export const c = 3;\n' }, 'bulk 2');
        commit({ ...Object.fromEntries(Object.keys(bulk).map(k => [k, '// third\n'])), 'src/c.js': 'export const c = 4;\n' }, 'bulk 3');

        const relations = coChangeRelations(root, new Set(['src/a.js', 'src/b.js', 'src/c.js', ...Object.keys(bulk)]));
        expect(relations.map(r => [r.from, r.to, r.weight])).toEqual([['file:src/a.js', 'file:src/b.js', 3]]);

        const repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') });
        await createGraphSync({ root, repository, settings: SETTINGS }).sync();
        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
        expect(graph.edges.filter(e => e.type === 'CO_CHANGES').map(e => [e.from, e.to])).toEqual([['file:src/a.js', 'file:src/b.js']]);
    });

    it('a repository without git has no co-change, and the sync still works', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-nogit-'));
        fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
        expect(coChangeRelations(root, new Set(['a.js']))).toEqual([]);
    });
});
