/**
 * Puratos Opcenter, 2026-10-29: 24 matches for a C# command, 12 shown (the answer budget is full of long doc lines);
 * the code files came after the docs and were cut. grep pages with `offset`, so the next page can be asked for.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { grep } from '../core/search/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-grep-offset-'));
for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), `HIT ${i}\n`);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('grep offset', () => {
    it('MUST skip the first `offset` matches, keep the total, and say where the next page starts', () => {
        const first = grep({ pattern: 'HIT' }, { root });
        expect(first.totalCount).toBe(5);
        const page = grep({ pattern: 'HIT', offset: 3 }, { root });
        expect(page.totalCount).toBe(5);
        expect(page.offset).toBe(3);
        expect(page.matches.map(m => m.text)).toEqual(first.matches.slice(3).map(m => m.text));
    });

    it('a negative or non-numeric offset is the first page', () => {
        expect(grep({ pattern: 'HIT', offset: -2 }, { root }).matches).toHaveLength(5);
        expect(grep({ pattern: 'HIT', offset: 'x' }, { root }).matches).toHaveLength(5);
    });
});

describe('grep binary files', () => {
    it('MUST skip binary files (a Mendix .mpr or catalog.db) and keep the readable copy of their text', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-grep-binary-'));
        try {
            fs.writeFileSync(path.join(dir, 'App.mpr'), Buffer.from("FilterType: 'startsWith'\0\x01"));
            fs.writeFileSync(path.join(dir, 'Page.page.mdl'), "FilterType: 'startsWith'\n");
            expect(grep({ pattern: 'startsWith' }, { root: dir }).matches.map(m => m.file)).toEqual(['Page.page.mdl']);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('grep ignoreCase', () => {
    it('MUST find every spelling with ignoreCase (VS Code found 31 where a case-sensitive search found 24)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-grep-case-'));
        try {
            fs.writeFileSync(path.join(dir, 'a.md'), 'CheckChangeOverForX\nCheckChangeoverForX\n');
            expect(grep({ pattern: 'CheckChangeOverForX' }, { root: dir }).totalCount).toBe(1);
            expect(grep({ pattern: 'CheckChangeOverForX', ignoreCase: true }, { root: dir }).totalCount).toBe(2);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
