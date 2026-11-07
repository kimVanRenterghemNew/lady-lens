import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
    execFile: vi.fn((file, args, options, callback) => {
        if (String(file).includes('missing')) return callback(new Error('mxcli not found'));
        const command = args[0];
        if (process.env.LENS_MXCLI_MODE === 'tree-only' && command !== 'project-tree') return callback(null, { stdout: 'null' });
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

import { findMendixProject, mendixContributor } from '../core/graph/index.js';

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

    it('writes the MDL text of every document from the catalog to .mxcli/mdl, so grep finds widget settings', async () => {
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
});
