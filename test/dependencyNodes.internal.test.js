/**
 * A package that many projects reference is one Dependency node, written once (a C# repository, 2026-11-12: 8,415 nodes
 * written for 3,747, and writing took 9.3 of 15 s).
 */
import { describe, it, expect } from 'vitest';
import { dependencyNodesOf } from '../core/graph/sync/fileEntity.js';

describe('dependency nodes', () => {
    it('makes one node per package, however many projects reference it', () => {
        const reference = { kind: 'package', name: 'Newtonsoft.Json', version: '13.0.3', type: 'PackageReference' };
        const project = name => ({ path: `${name}/${name}.csproj`, metadata: { references: [reference, { kind: 'package', name: `${name}.Only` }] } });
        const nodes = dependencyNodesOf([project('A'), project('B'), project('C')], '2026-11-12T00:00:00.000Z');
        expect(nodes.map(node => node.name).sort()).toEqual(['A.Only', 'B.Only', 'C.Only', 'Newtonsoft.Json']);
    });
});
