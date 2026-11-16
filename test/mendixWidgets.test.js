/**
 * Tests for Mendix widget summary and nested .mpr resolution in mendix_diff.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { mendixDiff, findMpr, extractWidgetSummary } from '../core/mendix/index.js';
import { mendixRepo, unitId } from './helpers/mendixProject.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
const cleanups = [];
afterAll(() => cleanups.forEach(fn => fn()));

describe('Mendix widget summary and nested .mpr detection', () => {
    it('extractWidgetSummary categorizes added, removed, and modified widgets and counts disk widgets', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'widgets-test-'));
        cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

        const widgetsDir = path.join(tmpDir, 'widgets');
        fs.mkdirSync(widgetsDir);
        fs.writeFileSync(path.join(widgetsDir, 'Image.mpk'), 'dummy');
        fs.writeFileSync(path.join(widgetsDir, 'Switch.mpk'), 'dummy');
        fs.writeFileSync(path.join(widgetsDir, 'readme.txt'), 'ignore');

        const files = [
            { path: 'widgets/Image.mpk', status: 'modified' },
            { path: 'widgets/DeprecatedWidget.mpk', status: 'removed' },
            { path: 'widgets/NewWidget.mpk', status: 'added' },
            { path: 'theme/web/custom.css', status: 'modified' }
        ];

        const summary = extractWidgetSummary(files, tmpDir);
        expect(summary.changed).toBe(true);
        expect(summary.added).toEqual(['NewWidget.mpk']);
        expect(summary.removed).toEqual(['DeprecatedWidget.mpk']);
        expect(summary.modified).toEqual(['Image.mpk']);
        expect(summary.diskCount).toBe(2);
    });

    it('findMpr finds nested .mpr files in subdirectories', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-mpr-'));
        cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

        const subDir = path.join(tmpDir, 'src');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'App.mpr'), 'dummy');

        expect(findMpr(null, null, tmpDir)).toBe('src/App.mpr');
    });

    it.skipIf(!hasSqlite)('mendixDiff includes widgets field in output', async () => {
        const repo = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repo.remove());
        const projId = unitId();
        const modId = unitId();
        repo.commit([{ id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } }], 'base');
        repo.commit([
            { id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: modId, container: projId, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'Sales' } }
        ], 'feature commit', 'feature');

        const diff = await mendixDiff({ from: 'main', to: 'feature', root: repo.root });
        expect(diff.schemaVersion).toBe(1);
        expect(diff.widgets).toBeDefined();
        expect(diff.widgets.changed).toBe(false);
        expect(diff.widgets.added).toEqual([]);
        expect(diff.widgets.removed).toEqual([]);
        expect(diff.widgets.modified).toEqual([]);
    });
});
