import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createGraphSync } from '../core/graph/index.js';
import { createGraphRepository, PROJECT_SCOPE } from '../core/graph/index.js';
import { buildDocumentEntity, documentNodeId } from '../core/graph/adapters/ladybug/index.js';

const tempRoots = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('Ladybug markdown documents', () => {
    it('builds a Document entity with the shared id scheme and title from frontmatter', () => {
        const entity = buildDocumentEntity('docs/Decision.md', '---\ntitle: OAuth Decision\n---\nBody.');

        expect(entity.id).toBe(documentNodeId('docs/Decision.md'));
        expect(entity.id).toBe('doc:docs/decision.md');
        expect(entity).toMatchObject({ type: 'Document', name: 'OAuth Decision' });
    });

    it('indexes documents through GraphSync and resolves frontmatter links into relations', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kura-markdown-'));
        tempRoots.push(root);
        await fs.mkdir(path.join(root, 'docs'), { recursive: true });
        await fs.writeFile(path.join(root, 'docs', 'feature.md'), '# OAuth Feature\nFeature body.');
        await fs.writeFile(path.join(root, 'docs', 'decision.md'), [
            '---', 'title: OAuth Decision', 'links:', '  - target: feature', '    relation: implements', '    weight: 1', '---', 'Decision body.'
        ].join('\n'));
        const repository = createGraphRepository({ databasePath: path.join(root, 'graph.lbdb') });
        const settings = { project: { exclude_dirs: [], graph_roots: ['docs'], graph_extensions: ['.md'] } };

        const result = await createGraphSync({ root, repository, settings }).sync({ mode: 'full' });
        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });

        expect(result.nodes).toBe(2);
        expect(graph.edges).toEqual([expect.objectContaining({
            from: documentNodeId('docs/decision.md'), to: documentNodeId('docs/feature.md'), type: 'implements', confidence: 'EXTRACTED'
        })]);
        expect(graph.nodes.map(node => node.title).sort()).toEqual(['OAuth Decision', 'OAuth Feature']);
    });
});
