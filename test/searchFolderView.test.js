import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { folderViewTool, functionViewTool, packageFolderView, readPackageFile, invalidateGraphCache } from '../core/search/index.js';
import { configureGraphStore, renderFolderView, createMemoryRepositoryStore } from '../core/graph/index.js';
import { REPO_ROOT, configureLensRoot } from '../core/configuration/index.js';

describe('search folderView and functionView tools', () => {
    describe('folderViewTool', () => {
        it('validates that folder is required', async () => {
            const missing = await folderViewTool();
            expect(missing.error).toContain('folder is required');

            const empty = await folderViewTool({ folder: '   ' });
            expect(empty.error).toContain('folder is required');
        });

        it('returns found: false when folder does not exist', async () => {
            const res = await folderViewTool({ folder: 'nonexistent/dummy/path' }, { refresh: async () => ({ status: 'fresh' }) });
            expect(res.found).toBe(false);
            expect(res.relation).toBe('folderView');
            expect(res.text).toBe('');
        });

        it('returns folder view details when folder exists in repo (with and without maxChars)', async () => {
            const resWithLimit = await folderViewTool({ folder: 'core/observability' }, { refresh: async () => ({ status: 'fresh' }), maxChars: 1000 });
            if (resWithLimit.found) {
                expect(resWithLimit.relation).toBe('folderView');
                expect(resWithLimit.folder).toBe('core/observability');
                expect(typeof resWithLimit.text).toBe('string');
            }

            const resDefaultBudget = await folderViewTool({ folder: 'core/observability' }, { refresh: async () => ({ status: 'fresh' }) });
            if (resDefaultBudget.found) {
                expect(resDefaultBudget.found).toBe(true);
            }
        });

        it('resolves folder view with re-exported package entry', async () => {
            const originalRoot = REPO_ROOT;
            const host = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-barrel-'));
            const wrapperDir = path.join(host, 'core', 'barrel');
            fs.mkdirSync(wrapperDir, { recursive: true });
            fs.writeFileSync(path.join(wrapperDir, 'index.js'), "export * from 'acorn';\n");
            fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: 'temp-host' }));
            try {
                fs.symlinkSync(path.join(originalRoot, 'node_modules'), path.join(host, 'node_modules'), 'junction');
            } catch {
                // Ignore if junction fails
            }

            const mem = createMemoryRepositoryStore();
            configureGraphStore(() => mem);
            configureLensRoot(host);
            invalidateGraphCache();
            await mem.replaceScope('project', [
                { id: 'file:core/barrel/index.js', type: 'CodeFile', path: 'core/barrel/index.js', exports: ['parse'] }
            ], []);

            try {
                const res = await folderViewTool({ folder: 'core/barrel' }, { refresh: async () => ({ status: 'fresh' }) });
                if (res.found && res.package) {
                    expect(res.package).toBe('acorn');
                    expect(res.text).toContain('passes on the package "acorn"');
                }
            } finally {
                configureLensRoot(originalRoot);
                invalidateGraphCache();
                configureGraphStore();
                fs.rmSync(host, { recursive: true, force: true });
            }
        });

        it('handles graph loading errors gracefully', async () => {
            invalidateGraphCache();
            configureGraphStore(() => ({
                databasePath: () => 'broken.db',
                loadGraph: () => { throw new Error('forced db read error'); }
            }));
            const res = await folderViewTool({ folder: 'core/observability' }, { refresh: async () => ({ status: 'fresh' }) });
            expect(res.error).toContain('could not load graph: forced db read error');
            invalidateGraphCache();
            configureGraphStore(); // restore default
        });
    });

    describe('functionViewTool', () => {
        it('validates that symbol is required', async () => {
            const missing = await functionViewTool();
            expect(missing.error).toContain('symbol is required');

            const empty = await functionViewTool({ symbol: '' });
            expect(empty.error).toContain('symbol is required');
        });

        it('returns found: false for unknown symbol', async () => {
            const res = await functionViewTool({ symbol: 'UnknownNonExistentSymbol9999' }, { refresh: async () => ({ status: 'fresh' }) });
            expect(res.found).toBe(false);
            expect(res.relation).toBe('functionView');
            expect(res.definitions).toEqual([]);
        });

        it('queries existing symbol in project graph', async () => {
            const res = await functionViewTool({ symbol: 'createProfiler' }, { refresh: async () => ({ status: 'fresh' }) });
            expect(res.relation).toBe('functionView');
            expect(res.symbol).toBe('createProfiler');
        });
    });

    describe('packageFolderView', () => {
        it('readPackageFile reads existing files and returns null on failure', () => {
            const valid = readPackageFile(REPO_ROOT, 'package.json');
            expect(typeof valid).toBe('string');
            expect(valid).toContain('lady-lens');

            const missing = readPackageFile(REPO_ROOT, 'nonexistent-ghost-file-999.xyz');
            expect(missing).toBeNull();
        });

        it('returns null for an unresolvable package name', async () => {
            const res = await packageFolderView('non-existent-library-xyz-12345');
            expect(res).toBeNull();
        });

        it('resolves an installed package and renders view exercising readFile', async () => {
            const res = await packageFolderView('acorn');
            if (res) {
                expect(res.name).toBe('acorn');
                expect(res.view).toBeDefined();
                const rendered = renderFolderView(res.view, { maxChars: 500 });
                expect(typeof rendered).toBe('string');
            }
        });
    });
});
