import { describe, expect, it } from 'vitest';
import { buildConfigEntity, buildDependencyEntity, dependencyNodeId, deriveProjectRelations } from '../core/graph/index.js';

const referenceManager = `<referenceManager><functionalblocks><functionalblock><name>Siemens.SimaticIT.TSK_OP</name><version>11.03.00</version><type>Library</type></functionalblock><functionalblock><name>Local.NoVersion</name></functionalblock></functionalblocks><projects /></referenceManager>`;

function relationLabels(relations) {
    return relations.map(relation => `${relation.from} -${relation.relation}-> ${relation.to}`);
}

describe('C# and reference-manager dependencies', () => {
    it('extracts project and package references from both csproj XML forms', () => {
        const entity = buildConfigEntity('App/App.csproj', '<Project><ItemGroup><ProjectReference Include="../Shared/Shared.csproj" /><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /><PackageReference Include="Serilog"><Version>3.1.1</Version></PackageReference></ItemGroup></Project>');

        expect(entity.metadata.references).toEqual([
            { kind: 'project', name: '../Shared/Shared.csproj', path: '../Shared/Shared.csproj' },
            { kind: 'package', name: 'Newtonsoft.Json', version: '13.0.3' },
            { kind: 'package', name: 'Serilog', version: '3.1.1' }
        ]);
    });

    it('extracts functional blocks and tolerates missing optional fields', () => {
        const entity = buildConfigEntity('referenceManager.xml', referenceManager);

        expect(entity.metadata.references).toEqual([
            { kind: 'functionalblock', name: 'Siemens.SimaticIT.TSK_OP', version: '11.03.00', type: 'Library' },
            { kind: 'functionalblock', name: 'Local.NoVersion' }
        ]);
    });

    it('keeps existing package and yaml config behavior', () => {
        expect(buildConfigEntity('package.json', '{"name":"demo","scripts":{"test":"node scripts/test.mjs"}}').metadata.runs).toEqual(['scripts/test.mjs']);
        expect(buildConfigEntity('package.json', '{').metadata.references).toBeUndefined();
        expect(buildConfigEntity('settings.yaml', '# settings\nname: demo').metadata.keys).toEqual(['name']);
    });

    it('derives local project references and external dependency relations', () => {
        const app = buildConfigEntity('src/App.csproj', '<Project><ProjectReference Include="../Shared/Shared.csproj" /><PackageReference Include="Serilog" Version="3.1.1" /></Project>');
        const shared = buildConfigEntity('Shared/Shared.csproj', '<Project />');
        const manager = buildConfigEntity('referenceManager.xml', referenceManager);
        const files = new Map([
            ['src/App.csproj', { ...app, hash: app.contentHash }],
            ['Shared/Shared.csproj', { ...shared, hash: shared.contentHash }],
            ['referenceManager.xml', { ...manager, hash: manager.contentHash }]
        ]);

        const labels = relationLabels(deriveProjectRelations(files));
        expect(labels).toContain('file:src/app.csproj -PROJECT_REFERENCE-> file:shared/shared.csproj');
        expect(labels).toContain(`file:src/app.csproj -DEPENDS_ON-> ${dependencyNodeId({ kind: 'package', name: 'Serilog', version: '3.1.1' })}`);
        expect(labels).toContain(`file:referencemanager.xml -DEPENDS_ON-> ${dependencyNodeId({ kind: 'functionalblock', name: 'Siemens.SimaticIT.TSK_OP', version: '11.03.00', type: 'Library' })}`);
    });

    it('builds dependency nodes with and without optional metadata', () => {
        expect(buildDependencyEntity({ kind: 'package', name: 'Serilog', version: '3.1.1' })).toMatchObject({ type: 'Dependency', kind: 'package', name: 'Serilog', path: '', metadata: { version: '3.1.1' } });
        expect(buildDependencyEntity({ kind: 'functionalblock', name: 'Local.NoVersion' })).toMatchObject({ type: 'Dependency', kind: 'functionalblock', name: 'Local.NoVersion', path: '', metadata: {} });
    });
});
