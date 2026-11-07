import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { commitShow, functionHistory } from '../core/branches/index.js';

let root;
const git = (...args) => execFileSync('git', ['-c', 'user.name=Tess', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const write = (name, content) => fs.writeFileSync(path.join(root, name), content);

describe('commit tools', () => {
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-commits-'));
        git('init', '-q', '-b', 'main');
        write('a.js', 'export function f() { return 1; }\nexport function g() { return 1; }\n');
        git('add', '.'); git('commit', '-qm', 'first');
        write('a.js', 'export function f() { return 2; }\nexport function g() { return 1; }\n');
        git('add', '.'); git('commit', '-qm', 'change f');
        write('b.js', 'export function h() { return 3; }\n');
        git('add', '.'); git('commit', '-qm', 'add h');
        write('a.js', 'export function g() { return 1; }\n');
        git('add', '.'); git('commit', '-qm', 'drop f');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('commit_show lists files and functions against the first parent', () => {
        const result = commitShow({ commit: 'HEAD~2', root });
        expect(result.commit).toMatchObject({ subject: 'change f', author: 'Tess' });
        expect(result.files).toEqual([expect.objectContaining({ path: 'a.js', status: 'modified' })]);
        expect(result.functions.map(fn => `${fn.name}:${fn.change}`)).toEqual(['f:modified']);
    });

    it('commit_show handles a root commit', () => {
        const result = commitShow({ commit: git('rev-list', '--max-parents=0', 'HEAD').trim(), root });
        expect(result.commit.parents).toEqual([]);
        expect(result.files).toEqual([expect.objectContaining({ path: 'a.js', status: 'added' })]);
    });

    it('commit_show reports unknown commits and a missing argument', () => {
        expect(commitShow({ commit: 'nope', root }).error).toMatch(/unknown/);
        expect(commitShow({ root }).error).toMatch(/required/);
    });

    it('function_history lists only commits that touched that function, newest first', () => {
        const result = functionHistory({ name: 'f', file: 'a.js', root });
        expect(result.commits.map(entry => `${entry.subject}:${entry.change}`)).toEqual(['drop f:removed', 'change f:modified', 'first:added']);
        expect(functionHistory({ name: 'g', file: 'a.js', root }).commits.map(entry => entry.subject)).toEqual(['first']);
    });

    it('function_history honours max and reports bad input', () => {
        expect(functionHistory({ name: 'f', file: 'a.js', max: 1, root }).commits).toHaveLength(1);
        expect(functionHistory({ name: 'f', root }).error).toMatch(/required/);
        expect(functionHistory({ file: 'a.js', root }).commits.map(entry => entry.subject)).toEqual(['drop f', 'change f', 'first']);
        expect(functionHistory({ name: 'f', file: 'a.js', ref: 'nope', root }).error).toMatch(/unknown/);
    });
});
