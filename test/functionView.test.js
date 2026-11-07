/**
 * the function view. "What does X do and what are its tests" in one answer: where X is defined (lines),
 * what its file is for, who calls it, which tests use it, which stories name it; nothing else of the file.
 * Nulmeting 2026-10-29: the app 0/3 on these questions (the test was missing: tests import a module through index.js).
 */
import { describe, it, expect } from 'vitest';
import { createGraph, functionView } from '../core/graph/index.js';

const FILES = {
    'core/q/questions.js': "export function applyAnswers(a) {\n  return a;\n}\nexport function other() {}\nimport { trim } from '../t/index.js';\nexport function runAll(a) {\n  other();\n  return trim(a);\n}\n",
    'core/t/index.js': "export { trim } from './trim.js';\n",
    'core/t/trim.js': 'export function trim(x) {\n  return x;\n}\n',
    'core/q/index.js': "export { applyAnswers, other } from './questions.js';\n",
    'core/h/handler.js': "import { applyAnswers } from '../q/index.js';\nexport const run = () => applyAnswers([]);\n",
    'core/h/second.js': "import { applyAnswers } from '../q/index.js';\nconst x = applyAnswers;\n",
    'core/h/unrelated.js': "import { other } from '../q/index.js';\nother();\n",
    'test/questions.test.js': "import { applyAnswers } from '../core/q/index.js';\nit('applyAnswers skips a command', () => applyAnswers(['/x']));\n",
    'test/other.test.js': "import { other } from '../core/q/index.js';\nit('other', () => other());\n",
    'backlog/story-1.md': '# Story 1\napplyAnswers must skip commands.\n',
    'backlog/story-2.md': '# Story 2\nnothing here\n'
};

function fixture() {
    const graph = createGraph('t');
    const code = (path, extra = {}) => graph.addNode(`file:${path}`, 'CodeFile', { path, ...extra });
    code('core/q/questions.js', { kind: 'source', purpose: 'Questions at needs_human', exports: ['applyAnswers', 'other', 'runAll'], symbolRanges: { applyAnswers: [1, 3], other: [4, 4], runAll: [6, 9] } });
    code('core/t/index.js', { kind: 'source', exports: ['trim'] });
    code('core/t/trim.js', { kind: 'source', exports: ['trim'], symbolRanges: { trim: [1, 3] } });
    code('core/q/index.js', { kind: 'source', exports: ['applyAnswers', 'other'] });
    for (const path of ['core/h/handler.js', 'core/h/second.js', 'core/h/unrelated.js']) code(path, { kind: 'source' });
    for (const path of ['test/questions.test.js', 'test/other.test.js']) code(path, { kind: 'test' });
    graph.addNode('doc:backlog/story-1.md', 'Document', { path: 'backlog/story-1.md', kind: 'doc' });
    graph.addNode('doc:backlog/story-2.md', 'Document', { path: 'backlog/story-2.md', kind: 'doc' });
    const edge = (from, to, type = 'IMPORTS') => graph.addEdge(`file:${from}`, `file:${to}`, type, 1);
    edge('core/q/index.js', 'core/q/questions.js');
    for (const from of ['core/h/handler.js', 'core/h/second.js', 'core/h/unrelated.js']) edge(from, 'core/q/index.js');
    edge('core/q/questions.js', 'core/t/index.js');
    edge('core/t/index.js', 'core/t/trim.js');
    edge('test/questions.test.js', 'core/q/index.js', 'TESTS');
    edge('test/other.test.js', 'core/q/index.js', 'TESTS');
    return graph;
}
const readFile = (path) => FILES[path] ?? null;

describe('functionView', () => {
    it('gives the definition with lines, the purpose, both callers, the test and the story, and nothing else', () => {
        const view = functionView(fixture(), 'applyAnswers', { readFile });
        expect(view.found).toBe(true);
        expect(view.definitions).toEqual([{ path: 'core/q/questions.js', startLine: 1, endLine: 3, purpose: 'Questions at needs_human' }]);
        expect(view.callers.map(c => c.path)).toEqual(['core/h/handler.js', 'core/h/second.js']);
        // 2026-10-29: the call line only, no longer the import line (parsed call sites instead of name matches).
        expect(view.tests).toEqual([{ path: 'test/questions.test.js', lines: [2], names: ['applyAnswers skips a command'] }]);
        expect(view.stories.map(s => s.path)).toEqual(['backlog/story-1.md']);
        const all = JSON.stringify(view);
        expect(all).not.toMatch(/unrelated\.js|other\.test\.js|story-2\.md/);
    });

    it('names the calling function and the call line; a file that only passes X along is a reference, never a call', () => {
        const view = functionView(fixture(), 'applyAnswers', { readFile });
        expect(view.callers).toEqual([
            { path: 'core/h/handler.js', lines: [2], functions: ['run'] },
            { path: 'core/h/second.js', lines: [2], reference: true }
        ]);
    });

    it('lists what X calls, resolved through barrels to the defining file, with the call lines', () => {
        expect(functionView(fixture(), 'runAll', { readFile }).calls).toEqual([
            { name: 'other', path: 'core/q/questions.js', lines: [4, 4], at: [7] },
            { name: 'trim', path: 'core/t/trim.js', lines: [1, 3], at: [8] }
        ]);
    });

    it('MUST say not found for an unknown name instead of guessing', () => {
        expect(functionView(fixture(), 'doesNotExist', { readFile })).toMatchObject({ found: false, definitions: [], callers: [], tests: [] });
    });
});

describe('functionView: classes in other languages, given facts and unreadable files', () => {
    const CS = 'public class Base\n{\n    public int A() { return 1; }\n}\n';
    const SUB = 'public class Sub : Base\n{\n}\n';
    function classGraph({ functions } = {}) {
        const graph = createGraph('cs');
        graph.addNode('file:src/Base.cs', 'CodeFile', { path: 'src/Base.cs', exports: ['Base'], symbolRanges: { Base: [1, 4] }, ...(functions ? { functions, calls: [] } : {}) });
        graph.addNode('file:src/Sub.cs', 'CodeFile', { path: 'src/Sub.cs' });
        graph.addNode('file:src/Gone.cs', 'CodeFile', { path: 'src/Gone.cs' });
        graph.addNode('pathless', 'CodeFile', { calls: [['x', 'Base', 1]] });
        graph.addEdge('file:src/Sub.cs', 'file:src/Base.cs', 'IMPORTS', 1);
        graph.addEdge('file:src/Gone.cs', 'file:src/Base.cs', 'IMPORTS', 1);
        return graph;
    }
    const read = path => ({ 'src/Base.cs': CS, 'src/Sub.cs': SUB })[path] ?? null;

    it('a C# subclass (`: Base`) is an inheritor; an unreadable user and a node without path are skipped; a bad maxSites is the default', () => {
        const view = functionView(classGraph(), 'Base', { readFile: read, maxSites: 'x' });
        expect(view.inheritors).toEqual([{ name: 'Sub', path: 'src/Sub.cs', line: 1 }]);
        expect(view.unresolved).toBeGreaterThanOrEqual(1);
    });

    it('methods come from the functions the graph already has, without parsing the file again', () => {
        const view = functionView(classGraph({ functions: [{ name: 'A', loc: [3, 3] }, { name: 'Elsewhere', loc: [9, 9] }] }), 'Base', { readFile: read });
        expect(view.children).toEqual([{ name: 'A', path: 'src/Base.cs', line: 3 }]);
    });

    it('a definition file that cannot be read has no children', () => {
        expect(functionView(classGraph(), 'Base', { readFile: () => null }).children).toBeUndefined();
    });
});
