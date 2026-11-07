/** cross_repo_search (backlog diff-impact-en-graafvragen.md, J5 / AC6): one search over registered projects, per project. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { crossRepoSearch } from '../core/mcp/handlers/index.js';

let a, b, registry;
const deps = () => ({ list: () => Object.values(registry), find: hint => registry[hint] ?? Object.values(registry).find(repo => repo.path === hint) ?? null });

beforeAll(() => {
    a = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cross-a-'));
    b = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cross-b-'));
    fs.writeFileSync(path.join(a, 'x.js'), 'export function foo() {\n  return 1;\n}\n');
    fs.writeFileSync(path.join(b, 'y.js'), 'import { foo } from "./x.js";\nfoo();\n');
    registry = { a: { id: 'a', path: a }, b: { id: 'b', path: b } };
});
afterAll(() => { for (const dir of [a, b]) fs.rmSync(dir, { recursive: true, force: true }); });

describe('cross_repo_search', () => {
    it('J5: both projects have foo; results per project, files never mixed', () => {
        const result = crossRepoSearch({ query: 'foo', wholeWord: true }, deps());
        expect(result.repos.map(repo => [repo.repo, repo.files.map(file => file.file)])).toEqual([['a', ['x.js']], ['b', ['y.js']]]);
        expect(result.total).toBe(3);
        expect(result.unknown).toEqual([]);
    });

    it('only the named projects; an unregistered name is in `unknown`, not an error', () => {
        const result = crossRepoSearch({ query: 'foo', repos: ['a', 'nope'] }, deps());
        expect(result.repos.map(repo => repo.repo)).toEqual(['a']);
        expect(result.unknown).toEqual(['nope']);
    });

    it('a limit per project marks the result truncated; a missing query is an error', () => {
        expect(crossRepoSearch({ query: 'foo', limit: 1 }, deps())).toMatchObject({ truncated: true });
        expect(crossRepoSearch({}, deps()).error).toContain('query');
        expect(crossRepoSearch(undefined, deps()).error).toContain('query');
    });

    it('a pattern error stops the search; a project is searched once even when named twice; a bad limit is the default', () => {
        expect(crossRepoSearch({ query: '(', isRegex: true }, deps()).error).toContain('invalid pattern');
        const twice = crossRepoSearch({ query: 'foo', repos: ['a', a], limit: 'x' }, deps());
        expect(twice.repos.map(repo => repo.repo)).toEqual(['a']);
    });
});
