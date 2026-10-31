import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    extractDiscussionsFromDirectory,
    handleDiscussionTool
} from '../core/discussions/index.js';
import { createMemoryRepositoryStore, configureGraphStore } from '../core/graph/index.js';

describe('discussions branch coverage (extractor and tools)', () => {
    let tmpDir;
    let sharedMemoryStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-disc-test-'));
        sharedMemoryStore = createMemoryRepositoryStore();
        configureGraphStore(() => sharedMemoryStore);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('extractDiscussionsFromDirectory handles invalid paths and directory structures', () => {
        expect(extractDiscussionsFromDirectory(null)).toEqual([]);
        expect(extractDiscussionsFromDirectory('')).toEqual([]);
        expect(extractDiscussionsFromDirectory(path.join(tmpDir, 'nonexistent'))).toEqual([]);

        // Create subdirectories and markdown files
        const nestedDir = path.join(tmpDir, 'nested', 'discussions');
        fs.mkdirSync(nestedDir, { recursive: true });
        const dummyMd = path.join(nestedDir, 'decision.md');
        const content = '---\ntitle: DB Choice\ntags: [discussion]\n---\n# Topic\n';
        fs.writeFileSync(dummyMd, content);

        const regularMd = path.join(tmpDir, 'readme.md');
        fs.writeFileSync(regularMd, '# Just a readme\n');

        const extracted = extractDiscussionsFromDirectory(tmpDir);
        expect(extracted.length).toBeGreaterThanOrEqual(1);
        const choice = extracted.find(r => r.title === 'DB Choice');
        expect(choice).toBeDefined();
        expect(choice.title).toBe('DB Choice');
    });

    it('handleDiscussionTool routes all tools and throws on unknown tool', async () => {
        const buildRes = await handleDiscussionTool('discussion_build', {
            question: 'Architecture tool choice?',
            responses: { Team: 'Use Hexagonal' }
        });
        expect(buildRes.record).toBeDefined();

        let savedResult = null;
        const saveRes = await handleDiscussionTool('discussion_save', {
            question: 'Architecture tool choice?',
            responses: { Team: 'Use Hexagonal' }
        }, { onSave: (r) => { savedResult = r; } });
        expect(saveRes.saved).toBe(true);
        expect(savedResult).toBeDefined();

        const editRes = await handleDiscussionTool('discussion_edit', {
            key: saveRes.nodeId.replace('discussion:', ''),
            appendResponse: { speaker: 'Lead', text: 'Agreed' }
        }, { onSave: () => {} });
        expect(editRes.saved).toBe(true);
        expect(editRes.updated).toBe(true);

        const loadRes = await handleDiscussionTool('discussion_load', {
            sessionId: 'default'
        });
        expect(loadRes.sessionId).toBe('default');

        const queryRes = await handleDiscussionTool('discussion_query', {
            topic: 'Architecture',
            limit: 5
        });
        expect(queryRes.sessionId).toBe('default');
        expect(Array.isArray(queryRes.discussions)).toBe(true);

        await expect(handleDiscussionTool('non_existent_tool', {}))
            .rejects.toThrow('Unknown discussion tool: non_existent_tool');
    });
});
