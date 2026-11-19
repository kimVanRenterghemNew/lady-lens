/**
 * The learned name ranking and its public ports: a caller trains on the pairs it selects, ranks its own entries without
 * a graph, and gives lens its model (backlog/bloom-tree-compresier-match.md).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as lens from '../index.js';

const { rankGraphNodes, buildNameIndex, namePairsFromDocs, nameTrainingExamples, trainNameModel, rankWithNameModel, nameFeatureRow, scoreNameRow, configureNameModel, activeNameModel, NAME_MODEL, NAME_FEATURES } = lens;

const file = (path, extra = {}) => ({ id: `file:${path}`, type: 'CodeFile', path, name: path.split('/').pop(), kind: 'source', exports: [], symbols: [], ...extra });
const graphOf = (...nodes) => ({ nodes: new Map(nodes.map(node => [node.id, node])), edges: [] });

const code = [
    file('core/queue/workQueue.js', { exports: ['enqueueTask', 'nextTask'], purpose: 'The work queue of planned tasks' }),
    file('core/queue/queueStore.js', { exports: ['saveQueue', 'loadQueue'], purpose: 'Keeps the work queue on disk' }),
    file('core/plan/taskRefs.js', { exports: ['TASK_ID_RE'], purpose: 'Recognises task references in a plan' }),
    file('core/plan/planner.js', { exports: ['planStory'], purpose: 'Turns a story into tasks' })
];
const docs = [
    { path: 'docs/queue.md', text: 'The queue keeps planned tasks: `core/queue/workQueue.js` hands out the next task to the coder.\n\nSaving happens in queueStore.js, which writes the queue to disk after every change.' },
    { path: '.claude/docs/queue.md', text: 'Saving happens in queueStore.js, which writes the queue to disk after every change.' },
    { path: 'backlog/story-1.md', text: 'A task id like T-12 is recognised by taskRefs.js in every plan the planner writes.' }
];

afterEach(() => configureNameModel(null));

describe('name model: pairs from documents', () => {
    it('takes the named file out of the text, counts a mirrored paragraph once, and keeps a fixed order', () => {
        const pairs = namePairsFromDocs([...docs].reverse(), code.map(n => n.path));
        // documents in path order: the mirror (.claude/) sorts first, so its copy is the one that counts
        expect(pairs.map(p => p.doc)).toEqual(['.claude/docs/queue.md', 'backlog/story-1.md', 'docs/queue.md']);
        expect(pairs.find(p => p.files.includes('core/queue/queueStore.js')).text).not.toMatch(/queueStore/);
        expect(pairs.filter(p => p.files.includes('core/queue/queueStore.js'))).toHaveLength(1);
    });

    it('selects documents: include keeps only those, exclude leaves them out', () => {
        expect(namePairsFromDocs(docs, code.map(n => n.path), { exclude: ['backlog/'] }).map(p => p.doc)).not.toContain('backlog/story-1.md');
        expect(namePairsFromDocs(docs, code.map(n => n.path), { include: ['backlog/'] }).map(p => p.doc)).toEqual(['backlog/story-1.md']);
    });
});

describe('name model: training', () => {
    const index = buildNameIndex(code);
    const examples = () => nameTrainingExamples(index, namePairsFromDocs(docs, code.map(n => n.path)));

    it('gives byte-equal weights for the same input (deterministic)', () => {
        expect(JSON.stringify(trainNameModel(examples()))).toBe(JSON.stringify(trainNameModel(examples())));
    });

    it('learns a model that ranks the paired file above the others on its own pairs', () => {
        const model = trainNameModel(examples());
        expect(model.features).toEqual(NAME_FEATURES);
        for (const pair of examples()) {
            expect(pair.files).toContain(rankWithNameModel(index, pair.text, { model })[0].node.path);
        }
    });
});

describe('the default fusion (as in 1.8.1)', () => {
    it('keeps the term order when the gate stays shut, and fuses (keeping the tail beyond 20) when it opens', async () => {
        const { fuseWithNames } = await import('../core/graph/query/nameFusion.js');
        const nodes = Array.from({ length: 24 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}` })); // no path: ordered by id
        const lens = nodes.map((node, i) => ({ node, score: 30 - i }));
        const scored = lens.slice(0, 23); // the last node has no term score
        expect(fuseWithNames(lens, [{ node: nodes[23], score: 1, pairInName: false }], scored)).toBe(lens);
        const fused = fuseWithNames(lens, [{ node: nodes[23], score: 9, pairInName: true }], scored);
        expect(fused.map(e => e.node.id).slice(0, 3)).toEqual(['n00', 'n01', 'n02']);
        expect(fused.find(e => e.node === nodes[23]).score).toBe(0); // a name-only file keeps no term score
        expect(fused.map(e => e.node.id)).toEqual(expect.arrayContaining(['n20', 'n21', 'n22'])); // the tail beyond 20 follows
        expect(fused).toHaveLength(24);
    });
});

describe('name model: the role test', () => {
    it('reads the test names of JavaScript, Python and C# test files', async () => {
        const { testNamesOf } = await import('../core/graph/sync/index.js');
        expect(testNamesOf("describe('work queue', () => { it(\"hands out the next task\", () => {}); it.skip(`keeps order`, () => {}); });"))
            .toEqual(['work queue', 'hands out the next task', 'keeps order']);
        expect(testNamesOf('def test_retry_after_timeout():\n    pass')).toEqual(['retry after timeout']);
        expect(testNamesOf('[Fact]\npublic async Task Retry_Stops_After_MaxAttempts() { }\n[TestCase(1)]\npublic void ParsesTaskId(int n) { }'))
            .toEqual(['Retry Stops After MaxAttempts', 'ParsesTaskId']);
    });

    it('gives a code file the words and pairs of the tests that cover it, apart from its own names', () => {
        const index = buildNameIndex(code, { testNamesOf: node => (node.path === 'core/queue/queueStore.js' ? ['survives a restart of the daemon'] : []) });
        const vectors = lens.nameVectors(index, 'the queue survives a restart');
        const store = vectors.get(code[1]);
        expect(store['u|test']).toBeGreaterThan(0);
        expect(store['b|test']).toBeGreaterThan(0); // survives > restart
        expect(vectors.get(code[0])?.['u|test']).toBeUndefined();
    });

    it('takes the test names from the graph: TESTS edges from test files that stored them at sync', () => {
        const testFile = { id: 'file:test/queueStore.test.js', type: 'CodeFile', path: 'test/queueStore.test.js', kind: 'test', testNames: ['survives a restart of the daemon'] };
        const silentTest = { id: 'file:test/planner.test.js', type: 'CodeFile', path: 'test/planner.test.js', kind: 'test' };
        const graph = {
            nodes: new Map([...code, testFile, silentTest].map(n => [n.id, n])),
            edges: [
                { from: testFile.id, to: code[1].id, type: 'TESTS' },
                { from: silentTest.id, to: code[3].id, type: 'TESTS' }, // a test file synced before 1.8.2: no names
                { from: code[0].id, to: code[1].id, type: 'IMPORTS' }
            ]
        };
        const vectors = lens.nameVectors(lens.nameIndexFor(graph, code), 'survives a restart');
        expect(vectors.get(code[1])['b|test']).toBeGreaterThan(0);
        expect(vectors.get(code[3])).toBeUndefined();
        expect(lens.nameVectors({ postings: new Map(), size: 0 }, 'survives a restart').size).toBe(0); // an index without the role test
    });
});

describe('name model: warm-up', () => {
    it('after a first code query, builds the index of the next loaded graph in the background', async () => {
        rankGraphNodes(graphOf(...code), 'save the work queue', { kind: 'code' }); // this process ranks code
        const reloaded = graphOf(...code); // a sync loads a new graph
        expect(lens.warmNameIndex(reloaded, code)).toBe(true);
        expect(lens.nameIndexReady(reloaded)).toBe(false); // not on the load path itself
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(lens.nameIndexReady(reloaded)).toBe(true);
    });
});

describe('name model: ranking', () => {
    it('ranks a caller\'s own entries without a graph: the test file of a source file', () => {
        const tests = buildNameIndex([{ path: 'test/queueStore.test.js' }, { path: 'test/workQueue.test.js' }, { path: 'test/planner.test.js' }]);
        expect(rankWithNameModel(tests, 'core/queue/queueStore.js')[0].node.path).toBe('test/queueStore.test.js');
    });

    it('scores a row as Σ w · (x − mean) / std', () => {
        const row = nameFeatureRow({ 'b|name': 2 }, 0);
        const expected = row.reduce((sum, x, j) => sum + NAME_MODEL.w[j] * (x - NAME_MODEL.mean[j]) / NAME_MODEL.std[j], 0);
        expect(scoreNameRow(row)).toBeCloseTo(expected, 12);
    });

    it('uses a configured model in graph_query\'s ranking, and refuses a model with other features', () => {
        const graph = graphOf(...code);
        const termOnly = { features: NAME_FEATURES, mean: NAME_FEATURES.map(() => 0), std: NAME_FEATURES.map(() => 1), w: NAME_FEATURES.map(f => (f === 'term' ? 1 : 0)) };
        configureNameModel(termOnly);
        expect(activeNameModel()).toBe(termOnly);
        const question = 'save the work queue to disk';
        const terms = rankGraphNodes(graph, question, { kind: 'code', names: false }).map(e => e.node.path);
        expect(rankGraphNodes(graph, question, { kind: 'code' }).map(e => e.node.path).slice(0, terms.length)).toEqual(terms);
        expect(() => configureNameModel({ features: ['x'], mean: [0], std: [1], w: [1] })).toThrow(/features/);
    });
});
