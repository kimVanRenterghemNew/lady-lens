import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { branchImpact } from '../core/branches/index.js';

let root;
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const write = (name, content) => fs.writeFileSync(path.join(root, name), content);
const commit = message => { git('add', '-A'); git('commit', '-qm', message); };

describe('branchImpact', () => {
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-impact-'));
        git('init', '-q', '-b', 'main');
        write('core.js', 'export function f() {\n    return 1;\n}\nexport function z() {\n    return 0;\n}\n');
        write('feature.js', 'import { f } from "./core.js";\nexport const x = 1;\n');
        commit('base');
        git('branch', 'release');
        git('checkout', '-qb', 'feature-x');
        write('feature.js', 'import { f } from "./core.js";\nexport function h() {\n    return f();\n}\n');
        commit('feature uses f');
        git('checkout', '-q', 'release');
        write('core.js', 'export function f() {\n    return 2;\n}\nexport function z() {\n    return 0;\n}\n');
        commit('bugfix f');
        git('checkout', '-q', 'main');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('reports the changed function, its callers on the feature and the bugfix commit (J11)', () => {
        const result = branchImpact({ change: 'release', against: 'feature-x', root });
        expect(result.risks).toHaveLength(1);
        expect(result.risks[0]).toMatchObject({ function: 'f', file: 'core.js', change: 'modified', overlap: false });
        expect(result.risks[0].commit).toMatch(/bugfix f/);
        expect(result.risks[0].references).toEqual(expect.arrayContaining([{ file: 'feature.js', line: 3 }]));
        expect(result.conflicts).toEqual([]);
        expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    });

    it('marks overlap and a text conflict when both branches change f (J12)', () => {
        git('checkout', '-q', 'feature-x');
        write('core.js', 'export function f() {\n    return 3;\n}\nexport function z() {\n    return 0;\n}\n');
        commit('feature changes f');
        git('checkout', '-q', 'main');
        const result = branchImpact({ change: 'release', against: 'feature-x', root });
        expect(result.risks[0]).toMatchObject({ function: 'f', overlap: true });
        expect(result.sharedFiles).toEqual(['core.js']);
        expect(result.conflicts).toEqual(['core.js']);
    });

    it('is empty when the change touches nothing the feature uses (J13)', () => {
        git('branch', 'quiet', 'main');
        git('checkout', '-q', 'quiet');
        write('other.js', 'export function q() {\n    return 1;\n}\n');
        commit('add q');
        write('other.js', 'export function q() {\n    return 2;\n}\n');
        commit('change q');
        git('checkout', '-q', 'main');
        const result = branchImpact({ change: 'quiet', against: 'feature-x', root });
        expect(result.risks).toEqual([]);
    });

    it('reports unknown refs', () => {
        expect(branchImpact({ change: 'nope', against: 'main', root }).error).toMatch(/unknown/);
    });

    it('follows a renamed function with a bugfix in it to the callers of its old name (J14)', () => {
        git('checkout', '-q', '-b', 'renamed', 'main');
        write('core.js', 'export function f2() {\n    return 5;\n}\nexport function z() {\n    return 0;\n}\n');
        commit('rename f to f2 and fix');
        git('checkout', '-q', 'main');
        const result = branchImpact({ change: 'renamed', against: 'feature-x', root });
        expect(result.risks).toHaveLength(1);
        expect(result.risks[0]).toMatchObject({ function: 'f', change: 'renamed', renamedTo: 'f2', file: 'core.js' });
        expect(result.risks[0].references).toEqual(expect.arrayContaining([{ file: 'feature.js', line: 3 }]));
    });
});
