/** Live failures per file, handed in by the host: a live-failures risk in the health report. */
import { describe, it, expect, afterEach } from 'vitest';
import { createGraph, codeHealth, configureLensHealthSignals, healthSignals } from '../core/graph/index.js';

function graph() {
    const g = createGraph('t');
    for (const path of ['core/stuck.js', 'core/fine.js']) g.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10 });
    return g;
}

describe('live failure signals in code health', () => {
    afterEach(() => configureLensHealthSignals(null));

    it('reports the host counts per file and marks live-failures; MUST NOT mark a file without failures or with only zeros', async () => {
        configureLensHealthSignals(() => [['core/stuck.js', { 'rejected-edit': 2, 'failed-verify': 1 }], ['core/fine.js', { 'rejected-edit': 0 }]]);
        const signals = await healthSignals({ root: '.' });
        const files = Object.fromEntries(codeHealth(graph(), { signals }).files.map(entry => [entry.path, entry]));

        expect(files['core/stuck.js']).toMatchObject({ live: { 'rejected-edit': 2, 'failed-verify': 1 } });
        expect(files['core/stuck.js'].issues).toContain('live-failures');
        expect(files['core/fine.js'].issues).not.toContain('live-failures');
    });

    it('MUST keep working when the host source fails: no signals, and the failure is logged', async () => {
        const logged = [];
        configureLensHealthSignals(() => { throw new Error('metrics unreadable'); });
        expect(await healthSignals({ root: '.', log: (message) => logged.push(message) })).toEqual(new Map());
        expect(logged.join()).toMatch(/metrics unreadable/);
    });

    it('has no signals without a host source', async () => {
        expect(await healthSignals({ root: '.' })).toEqual(new Map());
    });
});
