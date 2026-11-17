/**
 * Tests for the compiler and module integrity guard (scripts/check-compiler.mjs).
 */
import { describe, it, expect } from 'vitest';
import { runCompilerCheck, resolveModulePath } from '../scripts/check-compiler.mjs';

describe('check-compiler: module compilation and integrity guard', () => {
    it('resolves relative module paths and index.js barrels', () => {
        const root = process.cwd().replace(/\\/g, '/');
        const fromFile = `${root}/core/search/index.js`;
        const resolved = resolveModulePath(fromFile, './functionView.js');
        expect(resolved).toBe(`${root}/core/search/functionView.js`);

        const barrel = resolveModulePath(fromFile, '../graph/index.js');
        expect(barrel).toBe(`${root}/core/graph/index.js`);

        expect(resolveModulePath(fromFile, 'external-pkg')).toBeNull();
    });

    it('verifies that lady-lens codebase compiles with 0 broken imports', () => {
        const result = runCompilerCheck();
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.fileCount).toBeGreaterThan(100);
        expect(result.importCount).toBeGreaterThan(200);
    });
});
