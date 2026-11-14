/**
 * Findings of the Kura session (2026-11-12, story 32.28) on grep, searchView, functionView and read_chunk.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { globToRegExp, searchView, grep, glob, fitToBudget, read_chunk } from '../core/search/index.js';
import { docCommentAt } from '../core/graph/index.js';
import { configureLensRoot, REPO_ROOT } from '../core/configuration/index.js';

const repo = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-findings-'));
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
    return root;
};

describe('Kura findings on search', () => {
    it('1: a glob with {a,b} matches either alternative', () => {
        const regex = globToRegExp('{core,test}/**');
        expect(['core/a.js', 'test/x/b.js', 'docs/c.md'].map(file => regex.test(file))).toEqual([true, true, false]);
        expect(globToRegExp('src/*.{js,ts}').test('src/a.ts')).toBe(true);
        expect(globToRegExp('*.cs').test('a.cs')).toBe(true);
    });

    it('2: a single file over the budget keeps its first matches instead of disappearing', () => {
        const matches = Array.from({ length: 20 }, (_, i) => ({ line: i + 1, text: 'x'.repeat(400), kind: 'reference' }));
        const fitted = fitToBudget({ totalMatches: 20, filesCount: 1, files: [{ file: 'test/plan.test.js', kind: 'test', matches }] }, { lists: ['files'], nested: { files: 'matches' } });
        expect(fitted.files).toHaveLength(1);
        expect(fitted.files[0].matches.length).toBeGreaterThan(0);
        expect(fitted.files[0].matches[0].line).toBe(1);
        expect(fitted.hint).toMatch(/files 1 of 1, \d+ matches cut/);
    });

    it('3: a line of some KB comes back cut around the match', () => {
        const root = repo({ 'fixtures/big.json': `{"a":"${'y'.repeat(3000)}needle${'z'.repeat(3000)}"}\n` });
        const [match] = grep({ pattern: 'needle' }, { root }).matches;
        expect(match.text.length).toBeLessThan(260);
        expect(match.text).toContain('needle');
        expect(match.text.startsWith('…') && match.text.endsWith('…')).toBe(true);
        const view = searchView({ query: 'needle' }, { root });
        expect(view.files[0].matches[0].text.length).toBeLessThan(260);
    });

    it('4: the grep hint counts against the total and says where the next page starts', () => {
        const matches = Array.from({ length: 50 }, (_, i) => ({ file: `personas/p${i}.md`, line: 1, text: '## Critical Rules '.repeat(20) }));
        const fitted = fitToBudget({ matches, totalCount: 123, truncated: true, nextOffset: 50 }, { lists: ['matches'], totals: { matches: 'totalCount' }, paged: 'matches' });
        expect(fitted.hint).toContain(`matches ${fitted.matches.length} of 123`);
        expect(fitted.nextOffset).toBe(fitted.matches.length);
        expect(fitted.hint).toContain(`next page: offset ${fitted.matches.length}`);
        const root = repo(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`p/${i}.md`, '# Rules\n'])));
        expect(grep({ pattern: 'Rules' }, { root })).toMatchObject({ totalCount: 60, truncated: true, nextOffset: 50 });
    });

    it('6: grep and searchView leave out what .gitignore leaves out, as the graph does', () => {
        const root = repo({ '.gitignore': 'evals/.workspace/\n', 'core/a.js': 'export function personaBlock() {}\n', 'evals/.workspace/core/a.js': 'export function personaBlock() {}\n' });
        execFileSync('git', ['init', '-q'], { cwd: root });
        expect(searchView({ query: 'personaBlock' }, { root }).files.map(f => f.file)).toEqual(['core/a.js']);
        expect(grep({ pattern: 'personaBlock' }, { root }).matches.map(m => m.file)).toEqual(['core/a.js']);
        // asked for explicitly, an ignored folder is still searched (a path resolves against the lens root)
        const before = REPO_ROOT;
        configureLensRoot(root);
        try {
            expect(grep({ pattern: 'personaBlock', path: 'evals/.workspace' }, { root }).matches.map(m => m.file)).toEqual(['evals/.workspace/core/a.js']);
        } finally {
            configureLensRoot(before);
        }
    });

    it('7: with a regex query a definition is still a definition', () => {
        const root = repo({ 'core/p.js': 'export async function personaBlock(name) {\n  return isTestFile(name);\n}\nexport function isTestFile(relPath) {}\n' });
        const kinds = searchView({ query: 'personaBlock|isTestFile', isRegex: true }, { root }).files[0].matches.map(m => [m.line, m.kind, m.symbol]);
        expect(kinds).toEqual([[1, 'definition', 'personaBlock'], [2, 'call', undefined], [4, 'definition', 'isTestFile']]);
    });

    it('9: the read_chunk hint gives the lines one call returns in this file', () => {
        const root = repo({ 'long.js': Array.from({ length: 300 }, (_, i) => `const line${i} = '${'w'.repeat(200)}';`).join('\n') });
        const before = REPO_ROOT;
        configureLensRoot(root);
        try {
            const { hint } = read_chunk({ path: 'long.js' });
            const perCall = Number(hint.match(/about (\d+) lines/)[1]);
            expect(perCall).toBeLessThan(120);
            expect(read_chunk({ path: 'long.js', startLine: 1, endLine: 300 }).endLine).toBeGreaterThanOrEqual(perCall - 2);
        } finally {
            configureLensRoot(before);
        }
    });
});

describe('5: the purpose of a function is its own doc comment', () => {
    const personas = [
        '/**', ' * Drop the cached persona list - mainly useful for tests.', ' */', 'export function resetPersonasCache() {}', '',
        '/**', ' * Load one persona by name.', ' * @param {string} name', ' */', 'export function loadPersona(name) {}', '',
        'export function bare() {}', '',
        '// Picks the personas of one story.', '// Several lines.', '@decorated()', 'export function selectPersonasPerStory() {}', '',
        'def spike(x):', '    """Spike one story."""', '    return x'
    ].join('\n');

    it('reads a JSDoc, line comments over a decorator, a Python docstring, and nothing for a bare function', () => {
        expect(docCommentAt(personas, 4)).toBe('Drop the cached persona list - mainly useful for tests.');
        expect(docCommentAt(personas, 10)).toBe('Load one persona by name.');
        expect(docCommentAt(personas, 12)).toBeNull();
        expect(docCommentAt(personas, 17)).toBe('Picks the personas of one story. Several lines.');
        expect(docCommentAt(personas, 19)).toBe('Spike one story.');
        expect(docCommentAt(null, 1)).toBeNull();
    });
});

describe('8: freshness', () => {
    // Kura saw true, then false, without changing anything: the first call synced (the files were newer than the graph)
    it('says synced only for the call that ran the sync, not for the calls after it', async () => {
        const { refreshProjectGraph, invalidateGraphCache } = await import('../core/search/index.js');
        const root = repo({ 'core/a.js': 'export function a() {}\n' });
        const before = REPO_ROOT;
        const env = { root: process.env.LENS_REPO_ROOT, project: process.env.LENS_PROJECT_GRAPH };
        configureLensRoot(root);
        process.env.LENS_PROJECT_GRAPH = '1';
        try {
            invalidateGraphCache();
            expect(await refreshProjectGraph({ force: true })).toMatchObject({ checked: true, synced: true });
            expect(await refreshProjectGraph()).toMatchObject({ checked: true, synced: false });
        } finally {
            configureLensRoot(before);
            process.env.LENS_PROJECT_GRAPH = env.project;
            invalidateGraphCache();
        }
    }, 60_000);
});

describe('6b: what lens writes to be searched stays searchable', () => {
    it('finds the MDL export in .mxcli/mdl although git ignores .mxcli/, and leaves the rest of .mxcli out', () => {
        const root = repo({ '.gitignore': '.mxcli/\n', '.mxcli/mdl/Sales/Order_New.page.mdl': "create page Sales.Order_New { FilterType: 'startsWith' }\n", '.mxcli/lens-contribution.json': '{"startsWith":1}\n' });
        execFileSync('git', ['init', '-q'], { cwd: root });
        expect(glob({ pattern: '.mxcli/mdl/Sales/*.page.mdl' }, { root }).paths).toEqual(['.mxcli/mdl/Sales/Order_New.page.mdl']);
        expect(grep({ pattern: 'startsWith' }, { root }).matches.map(m => m.file)).toEqual(['.mxcli/mdl/Sales/Order_New.page.mdl']);
    });
});
