/**
 * Kura (2026-11-11, story 26.10): graph_query with kind "code" returned five documents. The kind filter only knew "doc";
 * the related neighbours graph_query adds to the answer were not filtered at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { graph_query } from '../core/search/index.js';
import { createGraphRepository, createGraphSync, nodeMatchesKind } from '../core/graph/index.js';
import { loadProjectSettings } from '../core/repository/index.js';
import { configureLensRoot, REPO_ROOT } from '../core/configuration/index.js';

let root, graphFlag;
const previousRoot = REPO_ROOT;
const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};

beforeAll(async () => {
    graphFlag = process.env.LENS_PROJECT_GRAPH;
    process.env.LENS_PROJECT_GRAPH = '1';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-query-kind-'));
    write('core/commandRouter.js', '/** Routes a line of user input to a command. */\nexport function routeInput(line) { return line; }\n');
    write('test/commandRouter.test.js', "import { routeInput } from '../core/commandRouter.js';\nrouteInput('route input');\n");
    write('docs/routing.md', '# Command routing\n\nHow `routeInput` in `core/commandRouter.js` routes user input to a command.\n');
    configureLensRoot(root);
    await createGraphSync({ root, repository: createGraphRepository(), settings: await loadProjectSettings() }).sync({ mode: 'full' });
});
afterAll(() => {
    configureLensRoot(previousRoot);
    if (graphFlag === undefined) delete process.env.LENS_PROJECT_GRAPH; else process.env.LENS_PROJECT_GRAPH = graphFlag;
    fs.rmSync(root, { recursive: true, force: true });
});

describe('graph_query kind filter', () => {
    it('kind "code" answers only source code: no document and no test, also not as a related neighbour', async () => {
        const result = await graph_query({ query: 'route user input command routing', kind: 'code', includeDocs: true });
        const nodes = result.nodes || [];
        expect(nodes.map(node => node.path)).toContain('core/commandRouter.js');
        expect(nodes.filter(node => node.type === 'Document' || node.kind === 'test')).toEqual([]);
    });

    it('nodeMatchesKind: all or an unknown kind keeps every node', () => {
        const doc = { type: 'Document' }, test = { type: 'CodeFile', kind: 'test' }, code = { type: 'CodeFile', kind: 'source' };
        expect([doc, test, code].map(node => nodeMatchesKind(node, 'code'))).toEqual([false, false, true]);
        expect([doc, test, code].map(node => nodeMatchesKind(node, 'test'))).toEqual([false, true, false]);
        expect([doc, test, code].every(node => nodeMatchesKind(node, 'all') && nodeMatchesKind(node, undefined) && nodeMatchesKind(node, 'toString'))).toBe(true);
    });
});
