import { describe, it, expect } from 'vitest';
import { buildDocumentEntity } from '../core/graph/adapters/ladybug/index.js';
import { deriveProjectRelations } from '../core/graph/sync/index.js';

describe('Story 23.4: Document REFERENCES Relations', () => {
    it('extracts markdown links and backtick paths as REFERENCES relations', () => {
        const docPath = 'backlog/story-1.md';
        const docSource = [
            '# Story 1',
            'Zie [Auth](../core/auth.js) en `core/token.js`.',
            'Zie nogmaals `core/token.js` voor details.',
            'Zie ook [andere story](story-2.md).',
            'En een niet bestaand bestand `core/nonexistent.js`.'
        ].join('\n');

        const docEntity = buildDocumentEntity(docPath, docSource);
        expect(docEntity.metadata.references.length).toBeGreaterThan(0);

        const files = new Map([
            [docPath, docEntity],
            ['backlog/story-2.md', { type: 'Document', path: 'backlog/story-2.md', metadata: {} }],
            ['core/auth.js', { type: 'CodeFile', path: 'core/auth.js', kind: 'source', metadata: {} }],
            ['core/token.js', { type: 'CodeFile', path: 'core/token.js', kind: 'source', metadata: {} }]
        ]);

        const relations = deriveProjectRelations(files);
        const refEdges = relations.filter(r => r.relation === 'REFERENCES');

        // REFERENCES to core/auth.js
        const authRef = refEdges.find(r => r.to === 'file:core/auth.js');
        expect(authRef).toBeDefined();
        expect(authRef.confidence).toBe('EXTRACTED');
        expect(authRef.weight).toBe(1);

        // REFERENCES to core/token.js with weight 2 (mentioned twice)
        const tokenRef = refEdges.find(r => r.to === 'file:core/token.js');
        expect(tokenRef).toBeDefined();
        expect(tokenRef.weight).toBe(2);

        // REFERENCES to backlog/story-2.md (doc -> doc)
        const docRef = refEdges.find(r => r.to === 'doc:backlog/story-2.md');
        expect(docRef).toBeDefined();

        // Non-existent path core/nonexistent.js produces no edge
        const nonExistent = refEdges.find(r => r.to.includes('nonexistent'));
        expect(nonExistent).toBeUndefined();

        // No self-link
        const selfLink = refEdges.find(r => r.to === 'doc:backlog/story-1.md');
        expect(selfLink).toBeUndefined();
    });

    it('frontmatter links take precedence over body references', () => {
        const docPath = 'backlog/story-frontmatter.md';
        const docSource = [
            '---',
            'links:',
            '  - target: story-2.md',
            '    relation: SUPERSEDES',
            '    weight: 5',
            '---',
            '# Story With Frontmatter',
            'Verwijst naar [Story 2](story-2.md).'
        ].join('\n');

        const docEntity = buildDocumentEntity(docPath, docSource);
        const files = new Map([
            [docPath, docEntity],
            ['backlog/story-2.md', { type: 'Document', path: 'backlog/story-2.md', metadata: {} }]
        ]);

        const relations = deriveProjectRelations(files);
        const toStory2 = relations.filter(r => r.to === 'doc:backlog/story-2.md');

        // Frontmatter SUPERSEDES wins; no duplicate REFERENCES edge
        expect(toStory2).toHaveLength(1);
        expect(toStory2[0].relation).toBe('SUPERSEDES');
        expect(toStory2[0].weight).toBe(5);
    });
});
