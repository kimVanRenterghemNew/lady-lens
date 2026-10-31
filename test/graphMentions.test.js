/**
 * Documents that name code: MENTIONS relations from a document to the code file it names (by path, or by a function
 * name only a few files declare), so the function view reads only those documents instead of every one.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, deriveProjectRelations, functionView, documentMentions, fileNodeId, documentNodeId } from '../core/graph/index.js';

describe('documentMentions', () => {
    it('finds code paths, names in backticks and camelCase names', () => {
        expect(documentMentions('See core/a/b.js, `applyAnswers()` and runPipeline; `trim` too.')).toEqual({ paths: ['core/a/b.js'], names: ['applyAnswers', 'trim', 'runPipeline'] });
    });

    it('MUST NOT take plain words, documents or a bare file name for code', () => {
        expect(documentMentions('Plain words, docs/plan.md and greeter.js only.')).toEqual({ paths: [], names: [] });
    });
});

describe('MENTIONS relations', () => {
    const code = (symbols) => ({ type: 'CodeFile', kind: 'source', metadata: { imports: [], symbolRanges: Object.fromEntries(symbols.map(name => [name, [1, 2]])) } });
    const files = new Map([
        ['core/q/questions.js', code(['applyAnswers', 'run'])],
        ...['a', 'b', 'c', 'd'].map(letter => [`core/${letter}.js`, code(['run'])]),
        ['backlog/story.md', { type: 'Document', kind: 'doc', metadata: { links: [], mentions: { paths: ['core/a.js', 'core/missing.js'], names: ['applyAnswers', 'run'] } } }]
    ]);

    it('point from the document to a named file (EXTRACTED) and to the file declaring a named function (INFERRED)', () => {
        const mentions = deriveProjectRelations(files, 'T').filter(relation => relation.relation === 'MENTIONS');
        expect(mentions).toEqual([
            { from: documentNodeId('backlog/story.md'), to: fileNodeId('core/a.js'), relation: 'MENTIONS', confidence: 'EXTRACTED', createdAt: 'T' },
            { from: documentNodeId('backlog/story.md'), to: fileNodeId('core/q/questions.js'), relation: 'MENTIONS', confidence: 'INFERRED', createdAt: 'T' }
        ]);
    });

    it('MUST NOT point at the files of a name many files declare (run: 5 files), nor at a path that does not exist', () => {
        const targets = deriveProjectRelations(files, 'T').filter(relation => relation.relation === 'MENTIONS').map(relation => relation.to);
        expect(targets).not.toContain(fileNodeId('core/b.js'));
        expect(targets).not.toContain(fileNodeId('core/missing.js'));
    });
});

describe('functionView stories through MENTIONS', () => {
    it('reads only the documents that mention the definition file; MUST NOT read one without that relation', () => {
        const graph = createGraph('t');
        graph.addNode('file:core/q.js', 'CodeFile', { path: 'core/q.js', kind: 'source', exports: ['applyAnswers'], symbolRanges: { applyAnswers: [1, 1] } });
        for (const path of ['backlog/one.md', 'backlog/two.md']) graph.addNode(`doc:${path}`, 'Document', { path, kind: 'doc' });
        graph.addEdge('doc:backlog/one.md', 'file:core/q.js', 'MENTIONS', 1);
        const read = [];
        const texts = { 'core/q.js': 'export function applyAnswers() {}\n', 'backlog/one.md': 'applyAnswers skips.\n', 'backlog/two.md': 'applyAnswers too.\n' };
        const view = functionView(graph, 'applyAnswers', { readFile: (path) => { read.push(path); return texts[path] ?? null; } });

        expect(view.stories).toEqual([{ path: 'backlog/one.md', lines: [1] }]);
        expect(read).not.toContain('backlog/two.md');
    });
});
