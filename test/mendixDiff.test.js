/** mendix_diff: what a branch changes in a Mendix model, read from git (MPR v1 and v2), as data for a client. */
import { describe, it, expect, afterAll } from 'vitest';
import { mendixDiff, decodeBson } from '../core/mendix/index.js';
import { mendixRepo, unitId, encodeBson } from './helpers/mendixProject.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
const repos = [];
afterAll(() => repos.forEach(repo => repo.remove()));

const ids = { project: unitId(), module: unitId(), folder: unitId(), page: unitId(), flow: unitId(), extra: unitId(), gone: unitId() };
const mapping = (parameter, expression) => ({ $ID: `map-${parameter}-${expression}`, $Type: 'Forms$NanoflowParameterMapping', Parameter: parameter, Expression: expression });
const page = mappings => ({
    $ID: 'page', $Type: 'Forms$Page', Name: 'Order_New',
    Widgets: [2, { $ID: 'btn', $Type: 'Forms$ActionButton', Name: 'btnSave', Action: { $ID: 'act', $Type: 'Forms$CallNanoflowClientAction', Nanoflow: 'Sales.Save', ParameterMappings: [2, ...mappings] } }]
});
const nanoflow = withLog => ({
    $ID: 'nf', $Type: 'Microflows$Nanoflow', Name: 'ACT_Save',
    ObjectCollection: {
        $ID: 'oc', $Type: 'Microflows$MicroflowObjectCollection',
        Objects: [3,
            { $ID: 'start', $Type: 'Microflows$StartEvent' },
            { $ID: 'call', $Type: 'Microflows$ActionActivity', Caption: 'Activity', Action: { $ID: 'callAction', $Type: 'Microflows$MicroflowCallAction', MicroflowCall: { $ID: 'mc', $Type: 'Microflows$MicroflowCall', Microflow: 'Sales.SUB_Save' } } },
            ...(withLog ? [{ $ID: 'log', $Type: 'Microflows$ActionActivity', Caption: 'Activity', Action: { $ID: 'logAction', $Type: 'Microflows$NanoflowCallAction', NanoflowCall: { $ID: 'nc', $Type: 'Microflows$NanoflowCall', Nanoflow: 'Sales.Log' } } }] : []),
            { $ID: 'end', $Type: 'Microflows$EndEvent' }]
    },
    Flows: [3,
        { $ID: 'f1', $Type: 'Microflows$SequenceFlow', OriginPointer: 'start', DestinationPointer: 'call', CaseValues: [2] },
        withLog
            ? { $ID: 'f2', $Type: 'Microflows$SequenceFlow', OriginPointer: 'call', DestinationPointer: 'log', CaseValues: [2, { $ID: 'c1', $Type: 'Microflows$EnumerationCase', Value: 'true' }] }
            : { $ID: 'f2', $Type: 'Microflows$SequenceFlow', OriginPointer: 'call', DestinationPointer: 'end', CaseValues: [2] },
        ...(withLog ? [{ $ID: 'f3', $Type: 'Microflows$SequenceFlow', OriginPointer: 'log', DestinationPointer: 'end', CaseValues: [2] }] : [])]
});
const base = [
    { id: ids.project, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
    { id: ids.module, container: ids.project, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'Sales' } },
    { id: ids.folder, container: ids.module, doc: { $ID: 'fo', $Type: 'Projects$Folder', Name: 'Orders' } },
    { id: ids.page, container: ids.folder, doc: page([mapping('Sales.ACT_Save.Order', '$Order')]) },
    { id: ids.flow, container: ids.module, doc: nanoflow(false) },
    { id: ids.gone, container: ids.module, doc: { $ID: 'old', $Type: 'Microflows$Microflow', Name: 'ACT_Old' } }
];
const branch = [
    ...base.filter(unit => unit.id !== ids.page && unit.id !== ids.flow && unit.id !== ids.gone),
    { id: ids.page, container: ids.folder, doc: page([mapping('Sales.ACT_Save.Order', '$Order'), mapping('Sales.ACT_Save.Log', '$Log')]) },
    { id: ids.flow, container: ids.module, doc: nanoflow(true) },
    { id: ids.extra, container: ids.module, doc: { $ID: 'new', $Type: 'Microflows$Microflow', Name: 'ACT_New' } }
];

describe.skipIf(!hasSqlite).each(['mpr-v1', 'mpr-v2'])('mendix_diff on %s', format => {
    it('lists commits and changed documents with module, folders and type; deleted and added ones too', async () => {
        const repo = await mendixRepo({ format });
        repos.push(repo);
        repo.commit(base, 'base');
        repo.commit(branch, 'save logs', 'feature');
        const result = await mendixDiff({ from: 'main', to: 'feature', root: repo.root });
        expect(result).toMatchObject({ format, project: 'App.mpr', commits: [{ subject: 'save logs', author: 'Test' }] });
        expect(result.documents.map(doc => [doc.qualifiedName, doc.type, doc.change, doc.folders])).toEqual([
            ['Sales.ACT_New', 'Microflows$Microflow', 'added', []],
            ['Sales.ACT_Old', 'Microflows$Microflow', 'deleted', []],
            ['Sales.ACT_Save', 'Microflows$Nanoflow', 'modified', []],
            ['Sales.Order_New', 'Forms$Page', 'modified', ['Orders']]
        ]);
        const pageDoc = result.documents.find(doc => doc.name === 'Order_New');
        expect(pageDoc.elements).toEqual([{ change: 'modified', id: 'btn', type: 'Forms$ActionButton', name: 'btnSave', detail: 'CallNanoflowClientAction: Sales.Save', properties: [expect.objectContaining({ path: 'Action > ParameterMappings' })] }]);
        expect(pageDoc.elements[0].properties[0].after).toHaveLength(2);
    });

    it('a flow: the added activity with what it calls, changed pointers by name, before and after graphs with statuses', async () => {
        const repo = await mendixRepo({ format });
        repos.push(repo);
        repo.commit(base, 'base');
        repo.commit(branch, 'save logs', 'feature');
        const flow = (await mendixDiff({ from: 'main', to: 'feature', root: repo.root })).documents.find(doc => doc.name === 'ACT_Save');
        expect(flow.elements.filter(e => e.change === 'added').map(e => [e.type, e.detail ?? null])).toEqual([
            ['Microflows$ActionActivity', 'NanoflowCallAction: Sales.Log'], ['Microflows$SequenceFlow', null]
        ]);
        const pointer = flow.elements.find(e => e.id === 'f2').properties.find(p => p.path === 'DestinationPointer');
        expect(pointer).toEqual({ path: 'DestinationPointer', before: { element: { type: 'Microflows$EndEvent', name: null } }, after: { element: { type: 'Microflows$ActionActivity', name: 'Activity', detail: 'NanoflowCallAction: Sales.Log' } } });
        expect(flow.flow.before.nodes.map(n => [n.id, n.status])).toEqual([['start', 'unchanged'], ['call', 'unchanged'], ['end', 'unchanged']]);
        expect(flow.flow.after.nodes.find(n => n.id === 'log')).toMatchObject({ status: 'added', summary: 'NanoflowCallAction: Sales.Log' });
        expect(flow.flow.after.edges.map(e => [e.from, e.to, e.cases, e.status])).toEqual([['start', 'call', [], 'unchanged'], ['call', 'log', ['true'], 'modified'], ['log', 'end', [], 'added']]);
    });
});

describe('mendix_diff without a usable model', () => {
    it('reports missing arguments, unknown branches and a folder without .mpr', async () => {
        expect(await mendixDiff({ from: 'main' })).toEqual({ error: 'from and to are required' });
        const git = { resolveCommit: ref => (ref === 'main' ? 'a' : null) };
        expect(await mendixDiff({ from: 'main', to: 'nope', git })).toEqual({ error: 'unknown branch or commit: nope' });
        const noBase = { resolveCommit: () => 'a', mergeBase: () => null };
        expect((await mendixDiff({ from: 'a', to: 'b', git: noBase })).error).toMatch(/no common history/);
        const noMpr = { resolveCommit: () => 'a', mergeBase: () => 'a', listTree: () => ['src/a.js'] };
        expect((await mendixDiff({ from: 'a', to: 'b', git: noMpr, root: '/x/app' })).error).toMatch(/no \.mpr/);
    });

    it('decodes the BSON types Mendix writes, and refuses one it does not know', () => {
        const doc = { s: 'x', n: 7, b: true, z: null, o: { k: [1, 'a'] } };
        expect(decodeBson(encodeBson(doc))).toEqual(doc);
        const odd = encodeBson({ a: 'x' });
        odd[4] = 0x7f;
        expect(() => decodeBson(odd)).toThrow(/unsupported BSON type/);
    });
});
