/**
 * Code, tests, documentation, scripts and config are different kinds of files (Kim 2026-10-29: "vind het goed dat er
 * een verschil is tussen code, tests, documentatie, infra, scripts"). Config files are nodes of their own; code that
 * names a config file READS it; an npm script RUNS the script it starts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository, PROJECT_SCOPE } from '../core/graph/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js', '.mjs', '.md', '.yaml', '.yml', '.json'], script_paths: ['tools/**'] }, graph: { ast: { enabled: false } } };
const FILES = {
    'core/models.js': "import fs from 'fs';\nexport const load = () => fs.readFileSync('configs/models.yaml', 'utf8');\n",
    'scripts/report.mjs': "import { load } from '../core/models.js';\nload();\n",
    'tools/clean.mjs': 'export const clean = () => 1;\n',
    'test/models.test.js': "import { load } from '../core/models.js';\n",
    'configs/models.yaml': '# The models per role.\nroutes:\n  plan: big\n',
    'evals/cases.json': '{ "cases": [] }\n',
    'package.json': JSON.stringify({ name: 'demo', scripts: { report: 'node scripts/report.mjs', test: 'vitest run' } }),
    'README.md': '# Demo\n'
};

describe('file kinds, config nodes, READS and RUNS', () => {
    let root, repository;
    beforeEach(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-kinds-'));
        for (const [rel, text] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
        repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') });
        await createGraphSync({ root, repository, settings: SETTINGS }).sync();
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('MUST give every file its kind: source, test, script (scripts/, bin/, configured paths), config, doc', async () => {
        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
        const kind = Object.fromEntries(graph.nodes.filter(n => n.path).map(n => [n.path, n.kind]));
        expect(kind).toMatchObject({ 'core/models.js': 'source', 'test/models.test.js': 'test', 'scripts/report.mjs': 'script', 'tools/clean.mjs': 'script', 'configs/models.yaml': 'config', 'package.json': 'config', 'README.md': 'doc' });
        expect(kind['evals/cases.json']).toBeUndefined(); // data, not config: only package.json of the JSON files
    });

    it('MUST link code to the config it reads and package.json to the script it runs', async () => {
        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
        const pathOf = new Map(graph.nodes.map(n => [n.id, n.path]));
        const edges = graph.edges.map(e => `${pathOf.get(e.from)} -${e.type}-> ${pathOf.get(e.to)}`);
        expect(edges).toContain('core/models.js -READS-> configs/models.yaml');
        expect(edges).toContain('package.json -RUNS-> scripts/report.mjs');
        expect(edges.filter(e => e.includes('vitest'))).toEqual([]);
    });
});
