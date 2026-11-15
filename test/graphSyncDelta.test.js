/**
 * An incremental sync writes only the relations that changed (backlog/snelheid-en-hooks.md AC3; one changed package.json
 * rewrote all 1699 relations, 1.3 s, 2026-11-15). The graph it leaves MUST equal the graph of a full sync of the same
 * files: removed, added and re-weighted relations included. Real Ladybug, real files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository, PROJECT_SCOPE } from '../core/graph/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js', '.md'] }, graph: { ast: { enabled: false } } };

const BEFORE = {
    'main.js': "import { a } from './core/a.js';\nimport { b } from './core/b.js';\nexport const main = () => a() + b();\n",
    'core/a.js': "export function a() { return 1; }\n",
    'core/b.js': "export const b = () => 2;\n",
    'docs/a.md': 'See `core/a.js`.\n',
    'docs/b.md': 'See `core/b.js`.\n'
};
// main.js drops b, b.js imports a new c.js, docs/a.md names a.js twice (its weight changes), docs/b.md is removed
const AFTER = {
    'main.js': "import { a } from './core/a.js';\nexport const main = () => a();\n",
    'core/a.js': BEFORE['core/a.js'],
    'core/b.js': "import { c } from './c.js';\nexport const b = () => c();\n",
    'core/c.js': "export const c = () => 3;\n",
    'docs/a.md': 'See `core/a.js`, twice: `core/a.js`.\n'
};

const roots = [];
function repoWith(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-delta-'));
    roots.push(root);
    writeFiles(root, files);
    return root;
}
function writeFiles(root, files) {
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

async function edgesAfter(root, run) {
    const repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') });
    await run(createGraphSync({ root, repository, settings: SETTINGS }));
    const { edges } = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
    return edges.map(edge => `${edge.from} -${edge.type}(${edge.confidence}, ${edge.weight})-> ${edge.to}`).sort();
}

describe('an incremental sync writes only what changed', () => {
    it('leaves the same relations as a full sync of the same files', async () => {
        const changed = repoWith(BEFORE);
        const incremental = await edgesAfter(changed, async sync => {
            await sync.sync();
            fs.rmSync(path.join(changed, 'docs', 'b.md'));
            writeFiles(changed, AFTER);
            await sync.sync();
        });
        const full = await edgesAfter(repoWith(AFTER), sync => sync.sync({ mode: 'full' }));

        expect(incremental).toEqual(full);
        expect(incremental).toContain('file:core/b.js -IMPORTS(EXTRACTED, 1)-> file:core/c.js');
        expect(incremental.some(edge => edge.startsWith('file:main.js') && edge.endsWith('file:core/b.js'))).toBe(false);
        expect(incremental).toContain('doc:docs/a.md -REFERENCES(EXTRACTED, 2)-> file:core/a.js');
        expect(incremental.some(edge => edge.startsWith('doc:docs/b.md'))).toBe(false);
    }, 60_000);
});
