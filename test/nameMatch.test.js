/**
 * MCP tool name_match: which of the files a caller chooses fits a text by name, with the reasons.
 */
import { describe, it, expect } from 'vitest';
import { nameMatch } from '../core/search/index.js';

const node = (path, extra = {}) => ({ id: `file:${path}`, type: 'CodeFile', path, kind: path.startsWith('test/') ? 'test' : 'source', exports: [], symbols: [], ...extra });
const graphOf = (...nodes) => ({ nodes: new Map(nodes.map(n => [n.id, n])), edges: [] });
const deps = (graph) => ({ refresh: async () => ({ fresh: true }), load: async () => ({ graph }) });

const graph = graphOf(
    node('core/plan/taskRefs.js', { exports: ['TASK_ID_RE'], purpose: 'Recognises task references in a plan' }),
    node('core/queue/queueStore.js', { exports: ['saveQueue'] }),
    node('test/queueStore.test.js'),
    node('test/taskRefs.test.js'),
    { id: 'doc:README.md', type: 'Document', path: 'README.md' }
);

describe('name_match', () => {
    it('finds the file a text names, with the pair and words it shares', async () => {
        const result = await nameMatch({ text: 'recognise a task id in a plan' }, deps(graph));
        expect(result.matches[0]).toMatchObject({ path: 'core/plan/taskRefs.js', kind: 'source' });
        expect(result.matches[0].pairs).toContain('task id');
        expect(result.matches[0].words).toEqual(expect.arrayContaining(['task', 'id']));
        expect(result.candidates).toBe(4); // code and test files, no documents
    });

    it('chooses among the files of a glob, or a list: the test file of a source file', async () => {
        const byGlob = await nameMatch({ text: 'core/queue/queueStore.js', glob: 'test/**' }, deps(graph));
        expect(byGlob.matches[0].path).toBe('test/queueStore.test.js');
        expect(byGlob.candidates).toBe(2);
        const byList = await nameMatch({ text: 'queue store', files: ['core/queue/queueStore.js', 'core/plan/taskRefs.js'], limit: 1 }, deps(graph));
        expect(byList.matches.map(m => m.path)).toEqual(['core/queue/queueStore.js']);
    });

    it('with doc: a clear match among the files the document names comes first, marked fromDoc', async () => {
        const many = graphOf(
            node('core/plan/taskRefs.js', { exports: ['parseTaskRef'] }),
            node('core/legacy/taskIdParser.js', { exports: ['TASK_ID_RE'], purpose: 'Old parser of a task id' }),
            node('core/queue/queueStore.js')
        );
        const docs = { 'backlog/story.md': 'The plan uses `core/plan/taskRefs.js` and core/queue/queueStore.js.\n\nWe add a task ref check.' };
        const result = await nameMatch({ text: 'add a task ref check', doc: 'backlog/story.md' }, { ...deps(many), readFile: p => docs[p] ?? null });
        expect(result.docFiles).toBe(2);
        expect(result.matches[0]).toMatchObject({ path: 'core/plan/taskRefs.js', fromDoc: true });
        const unknownDoc = await nameMatch({ text: 'add a task ref check', doc: 'nowhere.md' }, { ...deps(many), readFile: () => null });
        expect(unknownDoc.docFiles).toBe(0);
        expect(unknownDoc.matches.every(m => !m.fromDoc)).toBe(true);
    });

    it('says what is missing: no text, or no file in files/glob', async () => {
        expect((await nameMatch({}, deps(graph))).error).toMatch(/text is required/);
        expect((await nameMatch({ text: 'x', glob: 'nowhere/**' }, deps(graph))).error).toMatch(/no code file/);
    });
});
