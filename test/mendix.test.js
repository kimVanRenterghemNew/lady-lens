import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
    execFile: vi.fn((file, args, options, callback) => {
        if (String(file).includes('missing')) return callback(new Error('mxcli not found'));
        const command = args[0];
        const mode = process.env.LENS_MXCLI_MODE;
        if (mode === 'tree-only' && command !== 'project-tree') return callback(null, { stdout: 'null' });
        const sql = command === '-c' ? String(args[1]) : '';
        if (mode === 'no-limit' && sql.includes(' LIMIT ')) return callback(new Error('syntax error near LIMIT'));
        const page = sql.match(/LIMIT (\d+) OFFSET (\d+)$/);
        if (mode === 'many' && sql.includes('CATALOG.widgets')) {
            const all = Array.from({ length: 1200 }, (_, i) => ({ page: 'Sales.Big', widget: `w${i}`, widgetType: 'Forms$TextBox', attribute: `Sales.E.a${i}` }));
            return callback(null, { stdout: JSON.stringify(all.slice(Number(page[2]), Number(page[2]) + Number(page[1]))) });
        }
        const json = command === '-c'
            ? String(args[1]).includes('CATALOG.attributes')
                ? [{ entity: 'Sales.Equipment', name: 'ERPLocation' }]
                : [{ page: 'Sales.Equipment_New', widget: 'txtLocation', widgetType: 'Forms$TextBox', attribute: 'Sales.Equipment.ERPLocation' }, { page: 'Sales.Equipment_New', widget: 'txtBin', widgetType: 'Forms$TextBox', attribute: 'Sales.Equipment.Bin' }, { page: 'Sales.Equipment_New', widget: 'btnSave', widgetType: 'Forms$ActionButton', microflow: 'Sales.Run', nanoflow: 'Sales.Check' }, {}]
            : command === 'structure'
            ? process.env.LENS_MXCLI_MODE === 'structure-extra' ? [{}, { Module: 'Sales', Pages: 2 }] : [{ Module: 'Sales', Pages: 2 }]
            : command === 'graph-report'
                ? { sections: [] }
                : [{ type: 'module', label: 'Sales', qualifiedName: 'Sales', children: [{ type: 'microflow', label: 'Run', qualifiedName: 'Sales.Run', describable: true }] }];
        callback(null, { stdout: `warning: using test project\n${JSON.stringify(json)}` });
    })
}));

import { findMendixProject, mendixContributor, mendixChanged, createGraphSync, createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
const hasSqlite = await import('node:sqlite').then(() => true, () => false); // Node 22.13+ (22.5+ behind a flag)

const roots = [];
const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-mendix-'));
    roots.push(root);
    return root;
};

afterEach(() => {
    delete process.env.LENS_MXCLI_PATH;
    delete process.env.LENS_MXCLI_MODE;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Mendix mxcli contributor', () => {
    it('finds an mpr at the project root, an explicit mpr path, and no project', () => {
        const root = makeRoot();
        const project = path.join(root, 'App.mpr');
        fs.writeFileSync(project, 'binary placeholder');
        expect(findMendixProject(root)).toBe(project);
        expect(findMendixProject(project)).toBe(project);
        expect(findMendixProject(path.join(root, 'missing'))).toBeNull();
    });

    it('returns no contribution when the folder is not Mendix', async () => {
        const result = await mendixContributor({ root: makeRoot() });
        expect(result).toEqual({ nodes: [], relations: [] });
    });

    it('keeps sync alive when mxcli is unavailable', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = path.join(root, 'missing-mxcli');
        expect(await mendixContributor({ root })).toEqual({ nodes: [], relations: [] });
    });

    it('imports project, modules and nested elements from mxcli JSON', async () => {
        const root = makeRoot();
        const project = path.join(root, 'App.mpr');
        fs.writeFileSync(project, 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        const result = await mendixContributor({ root });
        expect(result.nodes.some(node => node.type === 'MendixProject')).toBe(true);
        expect(result.nodes.some(node => node.type === 'MendixModule')).toBe(true);
        expect(result.relations.some(edge => edge.type === 'CONTAINS')).toBe(true);
    });

    it('adds page fields with the required flag of their attribute', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        const result = await mendixContributor({ root });
        const fields = result.nodes.filter(node => node.type === 'MendixPageField');
        expect(fields.map(field => [field.name, field.metadata.required])).toEqual([['txtLocation', true], ['txtBin', false], ['btnSave', false]]);
        expect(result.relations).toContainEqual({ from: 'mendix:field:Sales.Equipment_New.btnSave', to: 'mendix:microflow:Sales.Run', type: 'REFERENCES' });
        expect(result.relations).toContainEqual({ from: 'mendix:field:Sales.Equipment_New.btnSave', to: 'mendix:nanoflow:Sales.Check', type: 'REFERENCES' });
        expect(result.relations).toContainEqual({ from: 'mendix:page:Sales.Equipment_New', to: 'mendix:field:Sales.Equipment_New.txtLocation', type: 'CONTAINS' });
    });

    it.skipIf(!hasSqlite)('writes the MDL text of every document from the catalog to .mxcli/mdl, so grep finds widget settings', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        fs.mkdirSync(path.join(root, '.mxcli'));
        const catalog = path.join(root, '.mxcli', 'catalog.db');
        const db = new DatabaseSync(catalog);
        db.exec('CREATE TABLE source_content(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4)');
        const insert = db.prepare('INSERT INTO source_content(c0, c1, c2) VALUES (?, ?, ?)');
        insert.run('Sales.Order_New', 'PAGE', "create page Sales.Order_New {\n  entitypicker picker1 (FilterType: 'startsWith')\n}");
        insert.run('Sales.../evil', 'MICROFLOW', 'x');
        insert.run('Loose', null, 'a document without module and type');
        insert.run(null, 'PAGE', 'no name: skipped');
        insert.run('Sales.NoText', 'PAGE', null);
        db.close();
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        await mendixContributor({ root });
        const page = path.join(root, '.mxcli', 'mdl', 'Sales', 'Order_New.page.mdl');
        expect(fs.readFileSync(page, 'utf8').split('\n')[1]).toContain("FilterType: 'startsWith'");
        expect(fs.readdirSync(path.join(root, '.mxcli', 'mdl', 'Sales')).every(name => !name.includes('/') && !name.startsWith('.'))).toBe(true);
        expect(fs.existsSync(path.join(root, '.mxcli', 'evil.microflow.mdl'))).toBe(false);
        expect(fs.readFileSync(path.join(root, '.mxcli', 'mdl', 'Loose', 'Loose.document.mdl'), 'utf8')).toContain('without module');
        expect(fs.existsSync(path.join(root, '.mxcli', 'mdl', 'Sales', 'NoText.page.mdl'))).toBe(false);
    });

    it('keeps the previous MDL export when the catalog has no source index', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        const kept = path.join(root, '.mxcli', 'mdl', 'Sales', 'Old.page.mdl');
        fs.mkdirSync(path.dirname(kept), { recursive: true });
        fs.writeFileSync(kept, 'old');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        await mendixContributor({ root });
        expect(fs.readFileSync(kept, 'utf8')).toBe('old');
    });

    it('handles tree-only and structure entries without a module name', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        process.env.LENS_MXCLI_MODE = 'tree-only';
        expect((await mendixContributor({ root })).nodes.some(node => node.type === 'MendixProject')).toBe(true);
        process.env.LENS_MXCLI_MODE = 'structure-extra';
        fs.rmSync(path.join(root, '.mxcli', 'lens-contribution.json'), { force: true }); // the same .mpr would be answered from the cache
        expect((await mendixContributor({ root })).nodes.some(node => node.type === 'MendixModule')).toBe(true);
    });
});

describe('Mendix contribution cache', () => {
    it('asks mxcli again only when the .mpr changes', async () => {
        const { execFile } = await import('child_process');
        const root = makeRoot();
        const project = path.join(root, 'App.mpr');
        fs.writeFileSync(project, 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        const first = await mendixContributor({ root });
        const calls = execFile.mock.calls.length;
        expect(await mendixContributor({ root })).toEqual(first);
        expect(execFile.mock.calls.length).toBe(calls);
        fs.writeFileSync(project, 'binary placeholder, changed');
        await mendixContributor({ root });
        expect(execFile.mock.calls.length).toBeGreaterThan(calls);
    });

    it('an unreadable cache is asked again, not an error', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        fs.mkdirSync(path.join(root, '.mxcli'));
        fs.writeFileSync(path.join(root, '.mxcli', 'lens-contribution.json'), '{broken');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        expect((await mendixContributor({ root })).nodes.some(node => node.type === 'MendixProject')).toBe(true);
    });
    it('asks the page widgets in pages of 500, so the 10,000-line output limit of mxcli is never hit', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        process.env.LENS_MXCLI_MODE = 'many';
        const fields = (await mendixContributor({ root })).nodes.filter(node => node.type === 'MendixPageField');
        expect(fields).toHaveLength(1200);
        expect(new Set(fields.map(field => field.name)).size).toBe(1200);
    });

    it('asks in one query when mxcli does not know LIMIT', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        process.env.LENS_MXCLI_MODE = 'no-limit';
        expect((await mendixContributor({ root })).nodes.filter(node => node.type === 'MendixPageField').map(field => field.name)).toEqual(['txtLocation', 'txtBin', 'btnSave']);
    });

    it('a changed model (also in mprcontents/ of an MPR v2 project) means the cached answer is stale', async () => {
        const root = makeRoot();
        expect(mendixChanged(root)).toBe(false); // not Mendix
        fs.writeFileSync(path.join(root, 'App.mpr'), 'small v2 mpr');
        fs.mkdirSync(path.join(root, 'mprcontents', 'ab'), { recursive: true });
        fs.writeFileSync(path.join(root, 'mprcontents', 'ab', 'unit1.mxunit'), 'one');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        expect(mendixChanged(root)).toBe(true);
        await mendixContributor({ root });
        expect(mendixChanged(root)).toBe(false);
        fs.writeFileSync(path.join(root, 'mprcontents', 'ab', 'unit2.mxunit'), 'two');
        expect(mendixChanged(root)).toBe(true);
    });

    it('a result cached when the MDL export could not run (Node 18) is stale once it can, and the other way round', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        await mendixContributor({ root });
        expect(mendixChanged(root)).toBe(false);
        const cache = path.join(root, '.mxcli', 'lens-contribution.json');
        const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
        const other = hasSqlite ? 'mdl=false' : 'mdl=true';
        fs.writeFileSync(cache, JSON.stringify({ ...cached, key: cached.key.replace(/mdl=(true|false)$/, other) }));
        expect(mendixChanged(root)).toBe(true);
    });
});

describe('Mendix project sync', () => {
    it('is incremental: nothing changed writes nothing, a changed model alone makes the sync ask mxcli and write', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'small v2 mpr');
        fs.mkdirSync(path.join(root, 'javascriptsource'));
        fs.writeFileSync(path.join(root, 'javascriptsource', 'a.js'), 'export const a = 1;\n');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        const settings = { project: { graph_roots: ['.'], exclude_dirs: ['.mxcli'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const sync = createGraphSync({ root, settings, repository });
        const mendixNodes = async () => (await repository.loadGraph({ scopes: ['project'] })).nodes.filter(node => String(node.type).startsWith('Mendix')).length;
        expect(await sync.syncFiles()).toMatchObject({ wrote: true, added: 1 });
        expect(await sync.syncFiles()).toMatchObject({ wrote: false, unchanged: 1 });
        const before = await mendixNodes();
        expect(before).toBeGreaterThan(0);
        fs.mkdirSync(path.join(root, 'mprcontents'));
        fs.writeFileSync(path.join(root, 'mprcontents', 'unit.mxunit'), 'changed model');
        process.env.LENS_MXCLI_MODE = 'tree-only'; // the changed model has fewer elements: the stale ones go, the rest stay
        expect(await sync.syncFiles()).toMatchObject({ wrote: true, added: 0, updated: 0 });
        const after = await mendixNodes();
        expect(after).toBeGreaterThan(0);
        expect(after).toBeLessThan(before);
        expect(mendixChanged(root)).toBe(false);
    });

    const syncOf = (root) => {
        const settings = { project: { graph_roots: ['.'], exclude_dirs: ['.mxcli'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        return { repository, sync: createGraphSync({ root, settings, repository }) };
    };

    it('stores Mendix relations under their relation name (CONTAINS, REFERENCES)', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'small v2 mpr');
        process.env.LENS_MXCLI_PATH = 'test-mxcli';
        const { repository, sync } = syncOf(root);
        await sync.syncFiles();
        const { edges } = await repository.loadGraph({ scopes: ['project'] });
        const mendixEdges = edges.filter(edge => String(edge.from).startsWith('mendix:'));
        expect(mendixEdges.length).toBeGreaterThan(0);
        expect(mendixEdges.every(edge => ['CONTAINS', 'REFERENCES'].includes(edge.type))).toBe(true);
    });

    it('without a working mxcli a no-change sync still writes nothing', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'App.mpr'), 'small v2 mpr');
        fs.mkdirSync(path.join(root, 'javascriptsource'));
        fs.writeFileSync(path.join(root, 'javascriptsource', 'a.js'), 'export const a = 1;\n');
        process.env.LENS_MXCLI_PATH = 'missing-mxcli';
        const { sync } = syncOf(root);
        expect(await sync.syncFiles()).toMatchObject({ wrote: true, added: 1 });
        expect(mendixChanged(root)).toBe(false);
        expect(await sync.syncFiles()).toMatchObject({ wrote: false, unchanged: 1 });
    });
});
