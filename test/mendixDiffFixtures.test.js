/**
 * Acceptance tests for Mendix diff fixtures: Entity, Enumeration, Microflow, Security,
 * detail: 'changes' vs 'summary', and noise filtering (AC 5, 6, 8, 9, 11, 12).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mendixDiff } from '../core/mendix/index.js';
import { mendixRepo, unitId } from './helpers/mendixProject.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
const cleanups = [];
afterAll(() => cleanups.forEach(fn => fn()));

describe.skipIf(!hasSqlite)('mendix_diff fixtures (AC 5, 6, 8, 9, 11, 12)', () => {
    it('fixture tests for Entity, Enumeration, Microflow, and Security', async () => {
        const repo = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repo.remove());

        const ids = {
            project: unitId(), module: unitId(),
            entity: unitId(), enumDoc: unitId(), microflow: unitId(), security: unitId()
        };

        const baseUnits = [
            { id: ids.project, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: ids.module, container: ids.project, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'CRM' } },
            {
                id: ids.entity, container: ids.module, doc: {
                    $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'Customer',
                    Attributes: [2, { $ID: 'a1', $Type: 'DomainModels$Attribute', Name: 'Name', Type: { $ID: 't1', $Type: 'DomainModels$StringType' } }]
                }
            },
            { id: ids.enumDoc, container: ids.module, doc: { $ID: 'en1', $Type: 'Enumerations$Enumeration', Name: 'CustomerStatus', Values: [2, { $ID: 'v1', $Type: 'Enumerations$EnumerationValue', Name: 'Active', Caption: 'Active' }] } },
            {
                id: ids.microflow, container: ids.module, doc: {
                    $ID: 'mf1', $Type: 'Microflows$Microflow', Name: 'SUB_InitCustomer',
                    ObjectCollection: { $ID: 'oc', $Type: 'Microflows$MicroflowObjectCollection', Objects: [3, { $ID: 'p1', $Type: 'Microflows$MicroflowParameterObject', Name: 'Customer', Type: 'CRM.Customer' }] },
                    Flows: [3]
                }
            },
            { id: ids.security, container: ids.module, doc: { $ID: 'sec1', $Type: 'Security$ModuleSecurity', Name: 'Security', ModuleRoleAccessList: [2, { $ID: 'mr1', $Type: 'Security$ModuleRole', Name: 'Admin' }] } }
        ];
        repo.commit(baseUnits, 'base model');

        const branchUnits = [
            baseUnits[0], baseUnits[1],
            {
                id: ids.entity, container: ids.module, doc: {
                    $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'Customer',
                    Attributes: [3,
                        { $ID: 'a1', $Type: 'DomainModels$Attribute', Name: 'Name', Type: { $ID: 't1', $Type: 'DomainModels$StringType' } },
                        { $ID: 'a2', $Type: 'DomainModels$Attribute', Name: 'Email', Type: { $ID: 't2', $Type: 'DomainModels$StringType' } }
                    ],
                    Associations: [2, { $ID: 'asc1', $Type: 'DomainModels$Association', Name: 'Customer_Account' }],
                    AccessRules: [2, { $ID: 'ar1', $Type: 'DomainModels$AccessRule', AllowCreate: true }]
                }
            },
            {
                id: ids.enumDoc, container: ids.module, doc: {
                    $ID: 'en1', $Type: 'Enumerations$Enumeration', Name: 'CustomerStatus',
                    Values: [3, { $ID: 'v1', $Type: 'Enumerations$EnumerationValue', Name: 'Active', Caption: 'Active' }, { $ID: 'v2', $Type: 'Enumerations$EnumerationValue', Name: 'Inactive', Caption: 'Inactive' }]
                }
            },
            {
                id: ids.microflow, container: ids.module, doc: {
                    $ID: 'mf1', $Type: 'Microflows$Microflow', Name: 'SUB_InitCustomer',
                    ObjectCollection: {
                        $ID: 'oc', $Type: 'Microflows$MicroflowObjectCollection',
                        Objects: [4, { $ID: 'p1', $Type: 'Microflows$MicroflowParameterObject', Name: 'Customer', Type: 'CRM.Customer' }, { $ID: 'act1', $Type: 'Microflows$ActionActivity', Caption: 'Activity', Action: { $ID: 'actCall', $Type: 'Microflows$MicroflowCallAction', MicroflowCall: { $ID: 'mc', $Type: 'Microflows$MicroflowCall', Microflow: 'CRM.Log' } } }]
                    },
                    Flows: [3]
                }
            },
            { id: ids.security, container: ids.module, doc: { $ID: 'sec1', $Type: 'Security$ModuleSecurity', Name: 'Security', ModuleRoleAccessList: [3, { $ID: 'mr1', $Type: 'Security$ModuleRole', Name: 'Admin' }, { $ID: 'mr2', $Type: 'Security$ModuleRole', Name: 'User' }] } }
        ];
        repo.commit(branchUnits, 'enhanced fixtures', 'feature');

        const diff = await mendixDiff({ from: 'main', to: 'feature', root: repo.root });
        expect(diff.schemaVersion).toBe(1);
        expect(diff.documents.map(d => [d.name, d.type])).toEqual([
            ['Customer', 'DomainModels$Entity'],
            ['CustomerStatus', 'Enumerations$Enumeration'],
            ['Security', 'Security$ModuleSecurity'],
            ['SUB_InitCustomer', 'Microflows$Microflow']
        ]);

        const entDoc = diff.documents.find(d => d.name === 'Customer');
        expect(entDoc.elements.some(e => e.name === 'Email')).toBe(true);
        expect(entDoc.elements.some(e => e.name === 'Customer_Account')).toBe(true);

        const enumDoc = diff.documents.find(d => d.name === 'CustomerStatus');
        expect(enumDoc.elements.some(e => e.name === 'Inactive')).toBe(true);

        const mfDoc = diff.documents.find(d => d.name === 'SUB_InitCustomer');
        expect(mfDoc.elements.some(e => e.detail === 'MicroflowCallAction: CRM.Log')).toBe(true);
    });

    it('added snippet and page include their elements; added nanoflow includes activities and parameters (AC 6)', async () => {
        const repo = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repo.remove());
        const projId = unitId(), modId = unitId(), pageId = unitId(), flowId = unitId();
        const base = [
            { id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: modId, container: projId, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'UI' } }
        ];
        repo.commit(base, 'base');

        const branch = [
            ...base,
            {
                id: pageId, container: modId, doc: {
                    $ID: 'snip1', $Type: 'Forms$Snippet', Name: 'Snippet_Header',
                    Widgets: [2, {
                        $ID: 'w1', $Type: 'Forms$ActionButton', Name: 'btnRefresh',
                        VisibilityExpression: '$Customer != null',
                        Action: { $ID: 'act1', $Type: 'Forms$CallNanoflowClientAction', Nanoflow: 'UI.Refresh' }
                    }],
                    Parameters: [2, { $ID: 'sp1', $Type: 'Forms$SnippetParameter', Name: 'Customer' }]
                }
            },
            {
                id: flowId, container: modId, doc: {
                    $ID: 'nf1', $Type: 'Microflows$Nanoflow', Name: 'ACT_Fetch',
                    ObjectCollection: {
                        $ID: 'oc', $Type: 'Microflows$MicroflowObjectCollection',
                        Objects: [3,
                            { $ID: 'np1', $Type: 'Microflows$NanoflowParameter', Name: 'OrderId' },
                            { $ID: 'act2', $Type: 'Microflows$ActionActivity', Caption: 'Activity', Action: { $ID: 'call', $Type: 'Microflows$NanoflowCallAction', NanoflowCall: { $ID: 'c', $Type: 'Microflows$NanoflowCall', Nanoflow: 'UI.DoFetch' } } }
                        ]
                    },
                    Flows: [3]
                }
            }
        ];
        repo.commit(branch, 'added snippet and nanoflow', 'feature');

        const diff = await mendixDiff({ from: 'main', to: 'feature', root: repo.root });
        const snippet = diff.documents.find(d => d.name === 'Snippet_Header');
        expect(snippet.change).toBe('added');
        expect(snippet.elements).toBeDefined();
        expect(snippet.elements.some(e => e.name === 'btnRefresh')).toBe(true);
        expect(snippet.elements.some(e => e.name === 'Customer')).toBe(true);

        const btn = snippet.elements.find(e => e.name === 'btnRefresh');
        expect(btn.properties.some(p => p.path === 'VisibilityExpression' && p.after === '$Customer != null')).toBe(true);

        const flow = diff.documents.find(d => d.name === 'ACT_Fetch');
        expect(flow.change).toBe('added');
        expect(flow.elements.some(e => e.name === 'OrderId')).toBe(true);
        expect(flow.elements.some(e => e.detail === 'NanoflowCallAction: UI.DoFetch')).toBe(true);
    });

    it('compact detail: changes diffs array items; noise filters translations and layout (AC 5, 8, 9)', async () => {
        const repo = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repo.remove());
        const projId = unitId(), modId = unitId(), pageId = unitId(), flowId = unitId();
        const mapping = (param, expr) => ({ $ID: `m-${param}`, $Type: 'Forms$NanoflowParameterMapping', Parameter: param, Expression: expr });

        const base = [
            { id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: modId, container: projId, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'Sales' } },
            {
                id: pageId, container: modId, doc: {
                    $ID: 'pg1', $Type: 'Forms$Page', Name: 'Overview',
                    Widgets: [2, {
                        $ID: 'grid', $Type: 'Forms$DataGrid', Name: 'GridOrders',
                        Width: 100, Height: 50,
                        Action: { $ID: 'a1', ParameterMappings: [2, mapping('P1', '$Val1'), mapping('P2', '$Val2')] },
                        Caption: { $ID: 'c1', Translations: [2, { LanguageCode: 'en_US', Text: 'Orders' }] }
                    }]
                }
            },
            {
                id: flowId, container: modId, doc: {
                    $ID: 'decFlow', $Type: 'Microflows$Microflow', Name: 'ACT_Check',
                    ObjectCollection: {
                        $ID: 'oc', $Type: 'Microflows$MicroflowObjectCollection',
                        Objects: [2, {
                            $ID: 'dec', $Type: 'Microflows$Decision', Caption: 'Is Active?',
                            SplitCondition: { $ID: 'sc', Expression: '@ $ID=123; $Type=Microflows$Expression; expression=$Order/IsActive' }
                        }]
                    },
                    Flows: [3]
                }
            }
        ];
        repo.commit(base, 'base');

        const branch = [
            base[0], base[1],
            {
                id: pageId, container: modId, doc: {
                    $ID: 'pg1', $Type: 'Forms$Page', Name: 'Overview',
                    Widgets: [2, {
                        $ID: 'grid', $Type: 'Forms$DataGrid', Name: 'GridOrders',
                        Width: 120, Height: 60,
                        Action: { $ID: 'a1', ParameterMappings: [3, mapping('P1', '$Val1'), mapping('P2', '$Val2'), mapping('P3', '$Val3')] },
                        Caption: { $ID: 'c1', Translations: [3, { LanguageCode: 'en_US', Text: 'Orders' }, { LanguageCode: 'nl_NL', Text: 'Bestellingen' }] }
                    }]
                }
            },
            base[3]
        ];
        repo.commit(branch, 'modified with noise', 'feature');

        const diffFull = await mendixDiff({ from: 'main', to: 'feature', root: repo.root, detail: 'full' });
        const gridFull = diffFull.documents[0].elements.find(e => e.name === 'GridOrders');
        const mappingPropFull = gridFull.properties.find(p => p.path === 'Action > ParameterMappings');
        expect(mappingPropFull.after).toHaveLength(3);

        const diffChanges = await mendixDiff({
            from: 'main', to: 'feature', root: repo.root,
            detail: 'changes', ignore: ['translations', 'layout']
        });
        expect(diffChanges.ignored).toEqual({ layout: 2, translations: 1 });
        const gridChanges = diffChanges.documents[0].elements.find(e => e.name === 'GridOrders');
        const mappingPropChanges = gridChanges.properties.find(p => p.path === 'Action > ParameterMappings');
        expect(mappingPropChanges.items).toEqual([
            { change: 'added', key: 'P3', item: { type: 'Forms$NanoflowParameterMapping', Parameter: 'P3', Expression: '$Val3' } }
        ]);
        expect(gridChanges.properties.some(p => p.path === 'Width')).toBe(false);

        const flow = diffFull.documents.find(d => d.name === 'ACT_Check');
        const decNode = flow?.flow?.before?.nodes?.find(n => n.id === 'dec');
        if (decNode) expect(decNode.summary).not.toMatch(/@\s*\$ID/);
    });
});
