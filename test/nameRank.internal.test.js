/**
 * A question with the words of a name finds the file that defines that name (backlog/bloom-tree-compresier-match.md).
 */
import { describe, it, expect } from 'vitest';
import { rankGraphNodes } from '../core/graph/index.js';
import { nameParts, features, nameScores, buildNameIndex, gateOpens } from '../core/graph/query/nameRank.js';

const file = (path, extra = {}) => ({ id: `file:${path}`, type: 'CodeFile', path, name: path.split('/').pop(), kind: 'source', exports: [], symbols: [], ...extra });
const graphOf = (...nodes) => ({ nodes: new Map(nodes.map(node => [node.id, node])), edges: [] });
const ranked = (graph, question) => rankGraphNodes(graph, question, { kind: 'code' }).map(entry => entry.node.path);
const purpose = 'Checks the references of a task in a plan before it runs';

describe('name ranking', () => {
    it('splits a name into its words, keeping two-letter words', () => {
        expect(nameParts('TASK_ID_RE')).toEqual(['task', 'id', 're']);
        expect(nameParts('planIds')).toEqual(['plan', 'ids']);
        expect(nameParts('HTTPServer')).toEqual(['http', 'server']);
    });

    it('a pair keeps its order; a skip pair reaches three words far', () => {
        const f = features(['task', 'id', 'of', 'plan', 'step', 'run']);
        expect(f).toEqual(expect.arrayContaining(['u:task', 'u:id', 'b:task>id', 's:task>plan', 'b:id>plan', 's:task>step']));
        expect(f).not.toContain('u:of'); // a stop word drops out before the pairs form
        expect(f).not.toContain('b:id>task');
        expect(f).not.toContain('s:task>run');
    });

    it('a file that defines the pair outscores one that only has the words apart', () => {
        const defines = file('core/plan/refs.js', { purpose, exports: ['TASK_ID_RE', 'planIds'] });
        const loose = file('core/plan/check.js', { purpose, exports: ['taskCount', 'idOf'] });
        const scores = nameScores(buildNameIndex([defines, loose]), 'recognise a task id as a reference of a plan');
        expect(scores[0].node).toBe(defines);
        expect(scores[0].pairInName).toBe(true);
    });

    it('a question with the words of a name brings the defining file higher', () => {
        const others = Array.from({ length: 6 }, (_, i) => file(`core/plan/step${i}.js`, { purpose: `Plan step ${i}: recognise the reference of a task in a plan` }));
        const defines = file('core/plan/refs.js', { purpose, exports: ['TASK_ID_RE', 'planIds'] });
        const loose = file('core/plan/taskReference.js', { purpose, exports: ['referenceOf', 'idOf'] });
        const graph = graphOf(loose, defines, ...others);
        const question = 'recognise a task id as a reference of a plan';
        const without = rankGraphNodes(graph, question, { kind: 'code', names: false }).map(e => e.node.path);
        expect(without[0]).toBe('core/plan/taskReference.js');
        expect(ranked(graph, question).indexOf('core/plan/refs.js')).toBeLessThan(without.indexOf('core/plan/refs.js'));
    });

    it('a Dutch question without code words keeps the order of now (the gate stays closed)', () => {
        const nodes = [file('core/storage/fileStore.js', { purpose: 'Bewaart de wachtrij op schijf' }), file('core/storage/lock.js', { purpose: 'Veilig schrijven' })];
        const question = 'bewaar de wachtrij veilig';
        const withoutNames = rankGraphNodes(graphOf(...nodes), question, { kind: 'code', names: false }).map(e => e.node.path);
        expect(ranked(graphOf(...nodes), question)).toEqual(withoutNames);
    });

    it('with ranking learned, the same question keeps the term order of what it finds; a file only names find comes after', () => {
        const nodes = [file('core/storage/fileStore.js', { purpose: 'Bewaart de wachtrij op schijf' }), file('core/storage/lock.js', { purpose: 'Veilig schrijven' })];
        const question = 'bewaar de wachtrij veilig';
        const withoutNames = rankGraphNodes(graphOf(...nodes), question, { kind: 'code', names: false }).map(e => e.node.path);
        const learned = rankGraphNodes(graphOf(...nodes), question, { kind: 'code', ranking: 'learned' }).map(e => e.node.path);
        expect(learned.slice(0, withoutNames.length)).toEqual(withoutNames);
        expect(learned).toContain('core/storage/lock.js');
    });

    it('after a sync that renames a symbol, the next question finds the new name', () => {
        const other = file('core/plan/step.js', { purpose: 'Runs a step' });
        const before = file('core/plan/refs.js', { exports: ['oldChecker'] });
        expect(ranked(graphOf(other, before), 'match a task id')).not.toContain('core/plan/refs.js');
        const after = file('core/plan/refs.js', { exports: ['TASK_ID_RE'] }); // a sync loads a new graph
        expect(ranked(graphOf(other, after), 'match a task id')[0]).toBe('core/plan/refs.js');
    });

    it('the gate stays closed when the best name hit does not clearly lead the fifth', () => {
        const hit = (score, pairInName = true) => ({ score, pairInName });
        expect(gateOpens([hit(3, false)])).toBe(false);
        expect(gateOpens([hit(3)])).toBe(true);
        expect(gateOpens([hit(3), hit(2), hit(2), hit(2), hit(2)])).toBe(true);
        expect(gateOpens([hit(3), hit(3), hit(3), hit(3), hit(2.5)])).toBe(false);
    });

    it('is public from the package entry: a caller matches its own entries (a source file to test files) without a graph', async () => {
        const api = await import('../index.js');
        expect(api.nameParts('modeClassifier')).toEqual(['mode', 'classifier']);
        expect(api.nameFeatures('task id')).toEqual(['u:task', 'b:task>id', 'u:id']);
        const tests = [{ path: 'test/queueStore.test.js' }, { path: 'test/commandRouter.test.js' }, { path: 'test/queueSwitch.test.js' }];
        expect(api.nameScores(api.buildNameIndex(tests), 'core/storage/queueStore.js')[0].node.path).toBe('test/queueStore.test.js');
    });
});
