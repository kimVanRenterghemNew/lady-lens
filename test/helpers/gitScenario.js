import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/** Scenario shared by the real git and the fake: main (c1..c3, m4) and feature (f1, f2) forked from c2. */
export const SCENARIO = {
    commits: [
        { name: 'c1', parents: [], subject: 'first', files: { 'a.js': 'export function f() {\n  return 1;\n}\n', 'old.js': 'export function z() {\n  return 0;\n}\n', 'docs/readme.md': '# hi\n' } },
        { name: 'c2', parents: ['c1'], subject: 'change f', files: { 'a.js': 'export function f() {\n  return 2;\n}\n' } },
        { name: 'c3', parents: ['c2'], subject: 'rename and add', files: { 'old.js': null, 'new.js': 'export function z() {\n  return 0;\n}\n', 'b.js': 'export const b = f();\n' } },
        { name: 'f1', parents: ['c2'], subject: 'feature a', files: { 'a.js': 'export function f() {\n  return 3;\n}\n', 'c.js': 'export const c = 1;\n' } },
        { name: 'f2', parents: ['f1'], subject: 'feature c', files: { 'c.js': 'export function g() {\n  return f();\n}\n' }, author: 'Fenna' },
        { name: 'm4', parents: ['c3'], subject: 'main touches a', files: { 'a.js': 'export function f() {\n  return 4;\n}\n' } }
    ],
    branches: { main: 'm4', feature: 'f2' },
    head: 'main'
};

/** Builds `state` as a real repository in `root` with plumbing, so dates and parents are exactly as described. Returns commit name to sha. */
export function buildRealRepo(root, state) {
    const run = (args, env = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
    run(['init', '-q', '-b', 'main']);
    run(['config', 'core.autocrlf', 'false']);
    const shas = new Map();
    state.commits.forEach((commit, index) => {
        if (commit.parents.length) run(['read-tree', '--reset', '-u', shas.get(commit.parents[0])]);
        for (const [file, text] of Object.entries(commit.files || {})) {
            const target = path.join(root, file);
            if (text == null) { fs.rmSync(target, { force: true }); continue; }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, text);
        }
        run(['add', '-A']);
        const author = commit.author || 'Tess';
        const date = `2024-01-01T00:00:${String(index).padStart(2, '0')}+0000`;
        const env = { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: 't@t', GIT_COMMITTER_DATE: date };
        shas.set(commit.name, run(['commit-tree', run(['write-tree']), ...commit.parents.flatMap(parent => ['-p', shas.get(parent)]), '-m', commit.subject || commit.name], env));
    });
    for (const [branch, name] of Object.entries(state.branches)) run(['update-ref', `refs/heads/${branch}`, shas.get(name)]);
    run(['checkout', '-q', '-f', state.head]);
    return shas;
}
