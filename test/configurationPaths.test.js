import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import {
    REPO_ROOT,
    isSafePath,
    toRepoRelative,
    resolveInRepo,
    relativeToRepo,
    configureLensRoot,
    contextBudget
} from '../core/configuration/index.js';

describe('configuration/paths and contextBudget branch coverage', () => {
    const originalRoot = REPO_ROOT;
    const originalEnv = { ...process.env };

    afterEach(() => {
        configureLensRoot(originalRoot);
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key];
            else process.env[key] = originalEnv[key];
        }
    });

    it('toRepoRelative handles non-strings, relative paths, inside and outside paths', () => {
        expect(toRepoRelative(null)).toBe(null);
        expect(toRepoRelative(undefined)).toBe(undefined);
        expect(toRepoRelative(123)).toBe(123);
        expect(toRepoRelative('relative/path.js')).toBe('relative/path.js');

        const inside = path.join(REPO_ROOT, 'core', 'index.js');
        expect(toRepoRelative(inside)).toBe('core/index.js');

        const outside = path.resolve(REPO_ROOT, '..', 'other-repo', 'file.js');
        expect(toRepoRelative(outside)).toBe(outside);

        expect(toRepoRelative(REPO_ROOT)).toBe(REPO_ROOT);
    });

    it('isSafePath tests relative, absolute, outside root and forbidden directories', () => {
        expect(isSafePath('core/index.js')).toBe(true);
        expect(isSafePath(path.join(REPO_ROOT, 'core', 'index.js'))).toBe(true);
        expect(isSafePath('.git/config')).toBe(false);
        expect(isSafePath('.memory/graph.db')).toBe(false);
        expect(isSafePath('node_modules/acorn/index.js')).toBe(false);
        expect(isSafePath(path.resolve(REPO_ROOT, '..', 'evil.js'))).toBe(false);
    });

    it('resolveInRepo returns absolute path for safe files and null for unsafe', () => {
        const safe = resolveInRepo('core/index.js');
        expect(safe).toBe(path.join(REPO_ROOT, 'core', 'index.js'));
        expect(resolveInRepo('.git/HEAD')).toBe(null);
    });

    it('relativeToRepo formats paths with forward slashes', () => {
        const abs = path.join(REPO_ROOT, 'a', 'b', 'c.js');
        expect(relativeToRepo(abs)).toBe('a/b/c.js');
    });

    it('contextBudget covers positive numbers, defaults, non-positive and NaN env vars', () => {
        delete process.env.LENS_TOOL_RESULT_CHARS;
        delete process.env.LENS_READ_CHUNK_MAX_CHARS;
        delete process.env.LENS_READ_CHUNK_MAX_LINES;
        delete process.env.LENS_GREP_MAX_MATCHES;

        const def = contextBudget();
        expect(def.toolResultChars).toBe(4000);
        expect(def.readChunkChars).toBe(3200);

        process.env.LENS_TOOL_RESULT_CHARS = '5000';
        process.env.LENS_READ_CHUNK_MAX_CHARS = '2000';
        process.env.LENS_READ_CHUNK_MAX_LINES = '50';
        process.env.LENS_GREP_MAX_MATCHES = '20';
        const custom = contextBudget();
        expect(custom.toolResultChars).toBe(5000);
        expect(custom.readChunkChars).toBe(2000);
        expect(custom.readChunkLines).toBe(50);
        expect(custom.grepMatches).toBe(20);

        process.env.LENS_TOOL_RESULT_CHARS = '-100';
        process.env.LENS_READ_CHUNK_MAX_CHARS = 'invalid';
        const invalid = contextBudget();
        expect(invalid.toolResultChars).toBe(4000);
        expect(invalid.readChunkChars).toBe(3200);
    });
});
