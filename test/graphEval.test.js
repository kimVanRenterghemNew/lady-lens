/**
 * The graph eval is part of `npm test`, so a retrieval regression fails the build instead of being found in use.
 * Every scorer has an input it MUST reject.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { scoreQueries, scoreAnswer, pathsIn, FIXTURE_GOLD, formatGraphEval } from '../core/eval/index.js';
import { runLensEval, GOLD } from '../evals/graphEval.mjs';

describe('graph eval on the fixture and on lady-lens itself', () => {
    let report;
    beforeAll(async () => { report = await runLensEval(); });

    it('formats graph eval output for passing and failing reports', () => {
        const text = formatGraphEval(report);
        expect(text).toContain('GRAPH EVAL: PASS');

        const mockFailing = {
            fixture: {
                nodes: 5, edges: 4, syncMs: 12, recallAtK: null, mrr: null, negativesClean: null,
                byTag: { core: { passed: 0, total: 1 } },
                rows: [{ hit: false, id: 'fail-1', rank: null, got: [] }]
            },
            repo: null,
            freshness: { score: 0.5, rows: [{ id: 'fresh-1', pass: false }] },
            thresholds: { k: 5 },
            failures: ['fixture: graph has only 5 nodes'],
            pass: false
        };
        const failText = formatGraphEval(mockFailing);
        expect(failText).toContain('GRAPH EVAL: FAIL');
        expect(failText).toContain('fixture: graph has only 5 nodes');
    });

    it('meets the thresholds in evals/graph-gold.json', () => {
        expect(report.failures, report.failures.join('\n')).toEqual([]);
        expect(report.pass).toBe(true);
    });

    it('builds a graph from nothing and keeps the gold set honest (every expected path exists, negatives present)', () => {
        expect(report.fixture.nodes).toBe(Object.keys(FIXTURE_GOLD.files).length);
        expect(report.repo.nodes).toBeGreaterThan(50);
        expect(report.repo.goldMissing).toEqual([]);
        expect(GOLD.queries.some(item => item.expected.length === 0)).toBe(true);
        expect(FIXTURE_GOLD.queries.some(item => item.expected.length === 0)).toBe(true);
    });

    it('reflects added, changed and removed files after a sync', () => {
        expect(report.freshness.rows.map(row => [row.id, row.pass])).toEqual([['fx-fresh-added', true], ['fx-fresh-changed', true], ['fx-fresh-removed', true]]);
    });

    it('MUST rank a module above its test when the test repeats the question (fx-source-before-test, rank 1)', () => {
        expect(report.fixture.rows.find(row => row.id === 'fx-source-before-test')?.rank).toBe(1);
    });
});

describe('scoreQueries', () => {
    const queries = [{ id: 'a', query: 'login', expected: ['src/login.js'], tag: 't' }, { id: 'n', query: 'nothing', expected: [] }];

    it('scores a right answer by its rank', () => {
        const scored = scoreQueries(queries, new Map([['a', ['x.js', 'src/login.js']], ['n', []]]), null, 5);
        expect(scored).toMatchObject({ recallAtK: 1, mrr: 0.5, negativesClean: 1, byTag: { t: { passed: 1, total: 1 } } });
    });

    it('MUST reject an expected path below k, and any answer to a negative', () => {
        const scored = scoreQueries(queries, new Map([['a', ['1.js', '2.js', 'src/login.js']], ['n', ['noise.js']]]), null, 2);
        expect(scored).toMatchObject({ recallAtK: 0, mrr: 0, negativesClean: 0 });
    });

    it('MUST report a gold path that no longer exists', () => {
        const scored = scoreQueries([{ id: 'gone', query: 'q', expected: ['does/not/exist.js'] }], new Map(), process.cwd(), 5);
        expect(scored.goldMissing).toEqual([{ id: 'gone', file: 'does/not/exist.js' }]);
    });
});

describe('scoreAnswer (search bench)', () => {
    const question = { id: 'q', kind: 'definition', expect: ['core/a.js'], forbid: ['core/b.js'], names: ['doIt'] };

    it('accepts an answer that names every expected path and name', () => {
        expect(scoreAnswer(question, 'doIt is in core/a.js').correct).toBe(true);
    });

    it('MUST reject a forbidden path, a missing name or a missing path', () => {
        expect(scoreAnswer(question, 'doIt in core/a.js and core/b.js').correct).toBe(false);
        expect(scoreAnswer(question, 'core/a.js').correct).toBe(false);
        expect(scoreAnswer(question, 'doIt somewhere').correct).toBe(false);
    });

    it('MUST reject a JSON answer that says a missing file exists', () => {
        expect(scoreAnswer({ kind: 'exists', path: 'x/y.js', exists: false }, '{"exists": true}', { jsonAnswer: true }).correct).toBe(false);
        expect(scoreAnswer({ kind: 'exists', path: 'x/y.js', exists: false }, '{"exists": false}', { jsonAnswer: true }).correct).toBe(true);
    });

    it('ignores paths under ignorePrefixes', () => {
        expect(pathsIn('evals/.workspace/a/b.js and core/c.js', { ignorePrefixes: ['evals/.workspace/'] })).toEqual(['core/c.js']);
    });
});
