/**
 * Build output is not project knowledge: a .NET repo has bin/Debug, bin/Release and obj/ in every project folder, deep
 * in the tree (Puratos Opcenter: search hits in .../PURSTOCK_OP.Installer/bin/Debug/.../Handler.xml). A JavaScript
 * repo's own bin/ (a CLI) is code and stays.
 */
import { describe, it, expect } from 'vitest';
import { shouldExcludePath, loadProjectSettingsSync } from '../core/repository/index.js';

const dirs = loadProjectSettingsSync('/no/such/settings.yaml').project.exclude_dirs;

describe('build output is excluded anywhere, a CLI in bin/ is not', () => {
    it('MUST exclude bin/Debug, bin/Release and obj/ at any depth', () => {
        expect(shouldExcludePath('FunctionalBlocks/X/X.Installer/bin/Debug/Runtime/Handler.xml', dirs)).toBe(true);
        expect(shouldExcludePath('src/App/bin/Release/net8.0/App.dll.config', dirs)).toBe(true);
        expect(shouldExcludePath('src/App/obj/project.assets.json', dirs)).toBe(true);
    });

    it('MUST keep a bin/ that holds code (a CLI entry point)', () => {
        expect(shouldExcludePath('bin/lens.mjs', dirs)).toBe(false);
        expect(shouldExcludePath('packages/tool/bin/run.js', dirs)).toBe(false);
    });
});
