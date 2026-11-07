import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { branchDiff } from '../core/branches/index.js';

let root;
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'pipe' });
const write = (name, content) => fs.writeFileSync(path.join(root, name), content);

describe('branchDiff', () => {
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-branchdiff-'));
        git('init', '-q', '-b', 'main');
        write('a.js', 'export function f() { return 1; }\nexport function g() { return f(); }\n');
        write('old.js', 'export function z() { return 0; }\n');
        git('add', '.'); git('commit', '-qm', 'base');
        git('checkout', '-qb', 'feature-x');
        write('a.js', 'export function f() { return 1; }\nexport function g() { return f() + 1; }\nexport function h() { return f(); }\n');
        fs.renameSync(path.join(root, 'old.js'), path.join(root, 'new.js'));
        git('add', '-A'); git('commit', '-qm', 'feature work');
        git('checkout', '-q', 'main');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('lists changed files and only changed functions, without checking out', () => {
        const result = branchDiff({ from: 'main', to: 'feature-x', root });
        expect(result.files).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'a.js', status: 'modified' }),
            expect.objectContaining({ oldPath: 'old.js', path: 'new.js', status: 'renamed' })
        ]));
        expect(result.functions.map(fn => `${fn.name}:${fn.change}`).sort()).toEqual(['g:modified', 'h:added']);
        expect(result.commits).toHaveLength(1);
        expect(git('rev-parse', '--abbrev-ref', 'HEAD').toString().trim()).toBe('main');
    });

    it('reports unknown refs', () => {
        expect(branchDiff({ from: 'main', to: 'nope', root }).error).toMatch(/unknown/);
    });

    it('lists changed import and call relations', () => {
        const { relations } = branchDiff({ from: 'main', to: 'feature-x', root });
        expect(relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ file: 'a.js', type: 'calls', change: 'added', from: 'h', to: 'f' })
        ]));
        expect(relations.filter(r => r.type === 'calls' && r.change === 'removed')).toEqual([]);
    });

    it('shows a renamed function as renamed, not removed plus added', () => {
        git('checkout', '-qb', 'rename-y', 'main');
        write('a.js', 'export function f() { return 1; }\nexport function g2() { return f() + 7; }\n');
        git('add', '-A'); git('commit', '-qm', 'rename g');
        git('checkout', '-q', 'main');
        const { functions, relations } = branchDiff({ from: 'main', to: 'rename-y', root });
        expect(functions).toEqual([expect.objectContaining({ name: 'g2', oldName: 'g', change: 'renamed', bodyChanged: true })]);
        expect(relations).toEqual([]);
    });
});
