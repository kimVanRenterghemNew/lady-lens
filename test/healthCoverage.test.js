/** Coverage per file in the health report: from an istanbul json-summary, a risk below 50% of lines. */
import { describe, it, expect } from 'vitest';
import { createGraph, codeHealth, coverageFromSummary } from '../core/graph/index.js';

const SUMMARY = {
    total: { lines: { pct: 70 } },
    'C:\\repo\\core\\low.js': { lines: { pct: 12.5 } },
    'C:\\repo\\core\\fine.js': { lines: { pct: 50 } },
    'C:\\elsewhere\\x.js': { lines: { pct: 0 } }
};
const toRepoPath = (file) => (file.startsWith('C:\\repo\\') ? file.slice('C:\\repo\\'.length).replace(/\\/g, '/') : null);

describe('coverage in code health', () => {
    it('reads % lines per repo file from the summary, without the total or files outside the repository', () => {
        expect([...coverageFromSummary(SUMMARY, toRepoPath)]).toEqual([['core/low.js', 12.5], ['core/fine.js', 50]]);
    });

    it('marks low-coverage below 50%; MUST NOT mark a file at 50% or a file without coverage data', () => {
        const graph = createGraph('t');
        for (const path of ['core/low.js', 'core/fine.js', 'core/unknown.js']) graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10 });
        const files = Object.fromEntries(codeHealth(graph, { coverage: coverageFromSummary(SUMMARY, toRepoPath) }).files.map(entry => [entry.path, entry]));

        expect(files['core/low.js']).toMatchObject({ coverage: 12.5 });
        expect(files['core/low.js'].issues).toContain('low-coverage');
        expect(files['core/fine.js'].issues).not.toContain('low-coverage');
        expect(files['core/unknown.js'].issues).not.toContain('low-coverage');
        expect(files['core/unknown.js']).not.toHaveProperty('coverage');
    });
});
