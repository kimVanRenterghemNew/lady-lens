import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CSS_CONFIG, HTML_CONFIG } from '../core/graph/sync/languages/web.js';
import { POWERSHELL_CONFIG, BASH_CONFIG, BATCH_CONFIG } from '../core/graph/sync/languages/shell.js';
import { findIndentedBlockEnd } from '../core/graph/sync/languages/blocks.js';
import { CONFIDENCE, createDiscussionEdges, createDiscussionNode, discussionNodeId, normalizeConfidence, resolveTargetNodeId } from '../core/discussions/model/nodes.js';
import { appendDiscussionResponse, buildDiscussionRecord, formatDiscussionMarkdown, parseDiscussionMarkdown, slugify } from '../core/discussions/model/record.js';
import { extractDiscussionsFromDirectory } from '../core/discussions/storage/markdownExtractor.js';
import { configureGraphStore, createGraph, createMemoryRepositoryStore } from '../core/graph/index.js';
import { findDiscussionsForNode, queryDiscussions } from '../core/discussions/query/discussionQuery.js';
import { scanGraphFiles } from '../core/repository/projectScanner.js';
import { configGrep, configReferences } from '../core/mcp/index.js';
import { createMemoryDirectQueries } from '../core/graph/adapters/memory/directQueries.js';
import { exportsTool, fileExists } from '../core/search/index.js';

afterEach(() => configureGraphStore());

describe('branch coverage for pure extractors and models', () => {
    it('covers CSS and HTML extraction branches', () => {
        const css = CSS_CONFIG.extract('/* Theme */\n@import "base.css";\n@import url("theme.css");\n@keyframes fade { from { opacity: 0; } }\n@mixin rounded { border-radius: 2px; }\n.card, #main { color: red; }');
        expect(css.purpose).toBe('Theme');
        expect(css.imports).toEqual(['base.css', 'theme.css']);
        expect(css.symbols).toEqual(expect.arrayContaining(['fade', 'rounded', '.card']));

        const html = HTML_CONFIG.extract('<!-- Page -->\n<script src="app.js"></script>\n<link rel="stylesheet" href="site.css">\n<template id="root"></template>\n<x-panel id="panel"></x-panel>\n<my-widget></my-widget>');
        expect(html.purpose).toBe('Page');
        expect(html.imports).toEqual(['app.js', 'site.css']);
        expect(html.symbols).toEqual(expect.arrayContaining(['#root', '#panel', 'x-panel', 'my-widget']));
        expect(HTML_CONFIG.extract('<title>Fallback</title>').purpose).toBe('Fallback');
        expect(CSS_CONFIG.extract('@import url(); .empty {}').purpose).toBe('');
        expect(HTML_CONFIG.extract('<script>inline</script><link href="data.txt">').imports).toEqual([]);
    });

    it('covers PowerShell, Bash, and batch extraction branches', () => {
        const ps = POWERSHELL_CONFIG.extract('<# .SYNOPSIS\nDeploy app\n#>\nusing module Core\nImport-Module Tools\nfunction Deploy($name) { if ($name) { return $name } }');
        expect(ps.purpose).toContain('Deploy app');
        expect(ps.imports).toEqual(['Core', 'Tools']);
        expect(ps.functions[0].name).toBe('Deploy');
        expect(POWERSHELL_CONFIG.extract('# Header\n# More\n').purpose).toContain('Header');
        expect(POWERSHELL_CONFIG.extract('<# help without synopsis #>').purpose).toContain('help');

        const bash = BASH_CONFIG.extract('# Header\nsource "common.sh"\n. config.sh\nfunction deploy { echo ok; }\nrun() { echo ok; }');
        expect(bash.imports).toEqual(['common.sh', 'config.sh']);
        expect(bash.symbols).toEqual(expect.arrayContaining(['deploy', 'run']));

        const batch = BATCH_CONFIG.extract(':: Header\n:deploy\ncall :deploy\ncall worker.bat');
        expect(batch.purpose).toBe('Header');
        expect(batch.symbols).toContain('deploy');
        expect(batch.calls).toHaveLength(2);
        expect(BATCH_CONFIG.extract('echo plain').symbols).toEqual([]);
    });

    it('covers shell extractor fallbacks and large functions', () => {
        const body = Array.from({ length: 85 }, () => '  echo x').join('\n');
        const ps = POWERSHELL_CONFIG.extract(`function Big {\n${body}\n}\nfunction Big {\n}\nfilter Other {}`);
        expect(ps.functions[0].issues).toEqual(['large-function']);
        expect(ps.symbols).toEqual(['Big', 'Other']);
        expect(POWERSHELL_CONFIG.extract('Import-Module').imports).toEqual([]);
        expect(POWERSHELL_CONFIG.extract('echo plain').purpose).toBe('');

        const bash = BASH_CONFIG.extract(`#!/bin/bash\n# Big script\nbig() {\n${body}\n}\nbig() {\n}`);
        expect(bash.purpose).toBe('Big script');
        expect(bash.functions[0].issues).toEqual(['large-function']);
        expect(bash.symbols).toEqual(['big']);
        expect(BASH_CONFIG.extract('echo plain').purpose).toBe('');

        const batch = BATCH_CONFIG.extract('REM Header\nrem More\n:a\n:a\ncall b.bat\n');
        expect(batch.purpose).toBe('Header More');
        expect(batch.symbols).toEqual(['a']);
    });

    it('covers confidence, target, node, and edge branches', () => {
        expect(normalizeConfidence()).toBe(CONFIDENCE.AMBIGUOUS);
        expect(normalizeConfidence('inferred')).toBe(CONFIDENCE.INFERRED);
        expect(() => normalizeConfidence('bad')).toThrow('invalid confidence');
        expect(resolveTargetNodeId('core/a.js')).toBe('file:core/a.js');
        expect(resolveTargetNodeId('docs/a.md')).toBe('doc:docs/a.md');
        expect(resolveTargetNodeId('file:core/a.js')).toBe('file:core/a.js');
        expect(resolveTargetNodeId('  ')).toBeNull();
        expect(discussionNodeId('Question One')).toBe('discussion:question-one');

        const node = createDiscussionNode({ key: 'q', question: 'Question', responses: [], sources: [] });
        expect(node.type).toBe('Discussion');
        const edges = createDiscussionEdges('discussion:q', ['core/a.js', { file: 'docs/a.md', relevance: 0.9 }, { target: 'x', confidence: 'INFERRED', weight: 2 }, {}]);
        expect(edges).toHaveLength(6);
    });

    it('covers discussion query and record branches', () => {
        expect(slugify('')).toBe('discussion');
        expect(slugify('A question!')).toBe('a-question');
        expect(() => buildDiscussionRecord({ question: '' })).toThrow();
        const record = buildDiscussionRecord({ question: 'Question', responses: [{ speaker: 'A', text: 'answer' }], sources: ['core/a.js'], date: '2026-01-01', key: 'q' });
        expect(formatDiscussionMarkdown(record)).toContain('core/a.js');
        expect(appendDiscussionResponse(record, { speaker: 'B', text: 'more' }).responses).toHaveLength(2);
        expect(() => appendDiscussionResponse(record, { speaker: '', text: 'x' })).toThrow();
        expect(parseDiscussionMarkdown('# Fallback\n\n**A**: text', 'fallback.md').title).toBe('Fallback');

        const graph = createGraph('discussion-test');
        graph.addNode('discussion:q', 'Discussion', { title: 'Question', topic: 'coverage', body: 'branch coverage' });
        graph.addNode('file:core/a.js', 'CodeFile', { path: 'core/a.js' });
        graph.addEdge('discussion:q', 'file:core/a.js', 'DISCUSSES', { confidence: 'EXTRACTED' });
        expect(findDiscussionsForNode(graph, 'core/a.js')).toHaveLength(1);
        expect(queryDiscussions(graph, { topic: 'coverage' })).toHaveLength(1);
        expect(queryDiscussions(graph, {}).length).toBe(1);
        expect(queryDiscussions(graph, { node: 'core/a.js' })).toHaveLength(1);
        expect(findDiscussionsForNode(null, 'core/a.js')).toEqual([]);
        expect(queryDiscussions(graph, { topic: 'absent' })).toEqual([]);
    });

    it('extracts nested discussions and ignores malformed or unrelated files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-discussion-'));
        fs.mkdirSync(path.join(root, 'nested'));
        fs.writeFileSync(path.join(root, 'discussion.md'), '# One\n\nBody');
        fs.writeFileSync(path.join(root, 'nested', 'notes.md'), '# Notes\n\nBody');
        fs.writeFileSync(path.join(root, 'nested', 'broken.md'), '---\n: broken');
        fs.writeFileSync(path.join(root, 'plain.txt'), 'not markdown');
        expect(extractDiscussionsFromDirectory(root).length).toBeGreaterThanOrEqual(1);
        expect(extractDiscussionsFromDirectory(path.join(root, 'missing'))).toEqual([]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('scans configured files and skips missing or excluded roots', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-scan-'));
        fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'node_modules'));
        fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;');
        fs.writeFileSync(path.join(root, 'node_modules', 'b.js'), 'module.exports = 1;');
        const found = await scanGraphFiles({ rootDir: root, settings: { project: { graph_roots: ['.', 'missing'], graph_extensions: ['.js'], exclude_dirs: ['node_modules'] } } });
        expect(found.some(file => file.endsWith(path.join('src', 'a.js')))).toBe(true);
        expect(found.some(file => file.includes('node_modules'))).toBe(false);
        const excludedRoot = await scanGraphFiles({
            rootDir: root,
            settings: { project: { graph_roots: ['node_modules'], graph_extensions: ['.js'], exclude_dirs: ['node_modules'] } }
        });
        expect(excludedRoot).toEqual([]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('covers indented block and config search validation branches', () => {
        expect(findIndentedBlockEnd('one', 0)).toBe(2);
        expect(findIndentedBlockEnd('one\n  two\nthree', 0)).toBeGreaterThan(0);
        expect(findIndentedBlockEnd('one\n  # comment\nthree', 0)).toBeGreaterThan(0);
        expect(configGrep({ pattern: '[' }).error).toContain('invalid pattern');
        expect(configReferences({}).error).toBe('reference is required');
    });

    it('covers memory direct-query exact, ambiguous, missing, and graph branches', async () => {
        const row = (id, type, file, name, metadata, kind = 'source') => ({ id, type, path: file, name, kind, scope: 'project', metadata_json: JSON.stringify(metadata) });
        const nodes = new Map([
            ['file:core/a.js', row('file:core/a.js', 'CodeFile', 'core/a.js', 'a.js', { symbolRanges: { run: [1, 2] }, exports: ['run', 'a'] })],
            ['file:other/a.js', row('file:other/a.js', 'CodeFile', 'other/a.js', 'a.js', { exports: ['other'] })],
            ['file:caller.js', row('file:caller.js', 'CodeFile', 'caller.js', 'caller.js', { exports: [] })],
            ['file:test.js', row('file:test.js', 'CodeFile', 'test.js', 'test.js', { exports: ['run'] }, 'test')],
            ['doc:notes.md', row('doc:notes.md', 'Document', 'notes.md', 'notes.md', { }, 'doc')]
        ]);
        const edge = (from, to, relation) => ({ from_id: from, to_id: to, relation, confidence: 'EXTRACTED', weight: 1 });
        const edges = new Map([
            ['a-b', edge('file:core/a.js', 'file:caller.js', 'IMPORTS')],
            ['c-a', edge('file:caller.js', 'file:core/a.js', 'IMPORTS')],
            ['barrel-a', edge('file:index.js', 'file:core/a.js', 'IMPORTS')]
        ]);
        nodes.set('file:index.js', row('file:index.js', 'CodeFile', 'index.js', 'index.js', { exports: [] }));
        let written = true;
        const queries = createMemoryDirectQueries(nodes, edges, () => written);

        expect(await queries.directDefinedIn('run')).toHaveLength(1);
        expect((await queries.directExports('core/a.js')).names).toContain('run');
        expect((await queries.directExports('a.js')).candidates).toHaveLength(2);
        expect((await queries.directExports('missing.js')).found).toBe(false);
        expect((await queries.directExists('core/a.js')).exists).toBe(true);
        expect((await queries.directExists('a.js')).similar).toContain('other/a.js');
        expect((await queries.directImports('core/a.js')).found).toBe(true);
        expect((await queries.directImports('a.js')).candidates).toHaveLength(2);
        expect((await queries.directImportedBy('core/a.js')).files).toContain('caller.js');
        expect((await queries.directFunctionViewGraph('run')).nodes.length).toBeGreaterThan(0);
        written = false;
        expect(await queries.directImports('core/a.js')).toMatchObject({ found: false });
    });

    it('covers graph exports and exists answers through the memory adapter', async () => {
        const store = createMemoryRepositoryStore();
        configureGraphStore(() => store);
        await store.applyProjectChanges('project', {
            upserts: [{ id: 'file:core/a.js', type: 'CodeFile', kind: 'source', scope: 'project', path: 'core/a.js', name: 'a.js', metadata: { exports: ['a'] } }]
        });
        const refresh = async () => ({ asOf: 'now' });
        expect((await exportsTool({}, { refresh })).error).toContain('file is required');
        expect((await exportsTool({ file: 'missing.js' }, { refresh })).error).toContain('not in the project graph');
        expect((await exportsTool({ file: 'core/a.js' }, { refresh })).names).toEqual(['a']);
        expect((await fileExists({ file: 'core/a.js' }, { refresh })).exists).toBe(true);
    });
});
