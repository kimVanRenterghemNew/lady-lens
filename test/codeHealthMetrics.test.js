import { describe, it, expect } from 'vitest';
import { analyzeSource, createGraph, codeHealth } from '../core/graph/index.js';
import { healthTool } from '../core/search/index.js';

describe('Story 23.13: NDepend-style Code Health & Complexity Metrics', () => {
    describe('AST Function Complexity', () => {
        it('calculates cyclomatic complexity, lines, and params for functions with if, while, catch, and ternaries', () => {
            const code = `
export function complexAlgorithm(a, b, c, d, e, f) {
    let result = 0;
    if (a > 0) {
        result += a;
    } else if (b > 0) {
        result += b;
    }

    while (c > 0) {
        c--;
        if (c % 2 === 0) {
            result += (d ? 1 : 2);
        }
    }

    try {
        if (e && f) {
            result *= 2;
        }
    } catch (err) {
        result = -1;
    }

    return result;
}
`;
            const facts = analyzeSource(code);
            expect(facts.functions).toBeDefined();
            expect(facts.functions.length).toBe(1);

            const fn = facts.functions[0];
            expect(fn.name).toBe('complexAlgorithm');
            expect(fn.loc).toEqual([2, 26]);
            expect(fn.lines).toBe(25);
            expect(fn.params).toBe(6);
            // Base 1 + if(1) + else if(1) + while(1) + if(1) + ternary(1) + catch(1) + if(1) + &&(1) = 9
            expect(fn.cyclomaticComplexity).toBe(9);
            expect(fn.issues).toContain('too-many-params');
        });

        it('flags functions with high cyclomatic complexity (CC > 15) and large functions (lines > 60)', () => {
            // Build function with 16 branches
            const branches = Array.from({ length: 16 }, (_, i) => `    if (x === ${i}) return ${i};`).join('\n');
            const code = `
function dispatch(x) {
${branches}
    return -1;
}

class Service {
    handle(a, b, c, d, e, f) {
        if (a) return b;
        return c;
    }
}

const obj = {
    run: (x) => {
        if (x) return 1;
        return 0;
    }
};
`;
            const facts = analyzeSource(code);
            const fn = facts.functions.find(f => f.name === 'dispatch');
            expect(fn).toBeDefined();
            expect(fn.cyclomaticComplexity).toBe(17); // 1 + 16 = 17
            expect(fn.issues).toContain('high-cyclomatic-complexity');

            const method = facts.functions.find(f => f.name === 'handle');
            expect(method).toBeDefined();
            expect(method.params).toBe(6);
            expect(method.issues).toContain('too-many-params');

            const arrow = facts.functions.find(f => f.name === 'run');
            expect(arrow).toBeDefined();
            expect(arrow.cyclomaticComplexity).toBe(2);
        });
    });

    describe('Graph Architecture Metrics & Top Central Nodes', () => {
        it('identifies the most central hub (highest Ca, low instability I) when 10 modules depend on it', () => {
            const graph = createGraph('metrics');
            // Central hub
            graph.addNode('file:core/utils/coreHub.js', 'CodeFile', {
                path: 'core/utils/coreHub.js',
                kind: 'source',
                lines: 100,
                exports: ['coreUtility']
            });

            // 10 dependent files
            for (let i = 1; i <= 10; i++) {
                const path = `core/modules/module_${i}.js`;
                graph.addNode(`file:${path}`, 'CodeFile', {
                    path,
                    kind: 'source',
                    lines: 50,
                    exports: [`action${i}`]
                });
                graph.addEdge(`file:${path}`, 'file:core/utils/coreHub.js', 'IMPORTS');
            }

            const report = codeHealth(graph);
            expect(report.topCentralNodes).toBeDefined();
            expect(report.topCentralNodes.length).toBeGreaterThan(0);

            const topNode = report.topCentralNodes[0];
            expect(topNode.path).toBe('core/utils/coreHub.js');
            expect(topNode.afferentCoupling).toBe(10);
            expect(topNode.efferentCoupling).toBe(0);
            expect(topNode.instability).toBe(0.0);
            expect(topNode.centralityScore).toBeGreaterThan(0);
        });

        it('flags a foundational hub in the Zone of Pain when it has high complexity or untested status', () => {
            const graph = createGraph('zone-of-pain');
            // Hub with complex function
            graph.addNode('file:core/riskyHub.js', 'CodeFile', {
                path: 'core/riskyHub.js',
                kind: 'source',
                lines: 150,
                exports: ['riskyFunc'],
                functions: [{
                    name: 'riskyFunc',
                    loc: [10, 80],
                    lines: 71,
                    params: 6,
                    cyclomaticComplexity: 18,
                    issues: ['high-cyclomatic-complexity', 'large-function', 'too-many-params']
                }]
            });

            // 5 callers
            for (let i = 1; i <= 5; i++) {
                const path = `core/client_${i}.js`;
                graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 30 });
                graph.addEdge(`file:${path}`, 'file:core/riskyHub.js', 'IMPORTS');
            }

            const report = codeHealth(graph);
            expect(report.zoneOfPain).toBeDefined();
            const risky = report.zoneOfPain.find(item => item.path === 'core/riskyHub.js');
            expect(risky).toBeDefined();
            expect(risky.instability).toBeLessThan(0.3);

            const fileEntry = report.files.find(f => f.path === 'core/riskyHub.js');
            expect(fileEntry.issues).toContain('zone-of-pain');
            expect(report.complexFunctions.length).toBeGreaterThan(0);
            expect(report.complexFunctions[0].name).toBe('riskyFunc');
        });
    });

    describe('healthTool response shape', () => {
        it('includes topCentralNodes, zoneOfPain, and complexFunctions in healthTool result', async () => {
            const mockLoaded = {
                graph: createGraph('tool-test'),
                source: 'mock.lbdb'
            };
            mockLoaded.graph.addNode('file:src/hub.js', 'CodeFile', {
                path: 'src/hub.js',
                kind: 'source',
                lines: 50,
                exports: ['hubFn'],
                functions: [{
                    name: 'hubFn',
                    loc: [1, 20],
                    lines: 20,
                    params: 2,
                    cyclomaticComplexity: 16,
                    issues: ['high-cyclomatic-complexity']
                }]
            });
            mockLoaded.graph.addNode('file:src/caller.js', 'CodeFile', { path: 'src/caller.js', kind: 'source', lines: 20 });
            mockLoaded.graph.addEdge('file:src/caller.js', 'file:src/hub.js', 'IMPORTS');

            const res = await healthTool({}, {
                refresh: async () => ({ isStale: false }),
                history: () => []
            });

            // Even on the actual repo or mock, the response must have the new fields
            expect(res).toHaveProperty('topCentralNodes');
            expect(res).toHaveProperty('zoneOfPain');
            expect(res).toHaveProperty('complexFunctions');
            expect(Array.isArray(res.topCentralNodes)).toBe(true);
            expect(Array.isArray(res.zoneOfPain)).toBe(true);
            expect(Array.isArray(res.complexFunctions)).toBe(true);
        });
    });
});
