/**
 * Tests for Story 23.1: Discussions as Graph Nodes.
 *
 * Verifies that:
 * 1. Saved discussions register a Discussion node in the graph.
 * 2. Edges to grounded targets use confidence conventions (EXTRACTED / INFERRED / AMBIGUOUS).
 * 3. graph_query finds discussions and their references (both incoming and outgoing).
 * 4. Sessions without discussions return a valid empty graph without crashing.
 * 5. Markdown export/persistence behavior is preserved alongside graph nodes.
 * 6. MCP discussion tools and search ranking work seamlessly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    saveDiscussion,
    loadDiscussions,
    editDiscussion,
    buildDiscussionRecord,
    parseDiscussionMarkdown,
    formatDiscussionMarkdown,
    findDiscussionsForNode,
    queryDiscussions,
    CONFIDENCE
} from '../core/discussions/index.js';
import {
    createGraph,
    createMemoryRepositoryStore,
    configureGraphStore,
    sessionScope,
    rankGraphNodes,
    buildContextFromGraph,
    fileImpact,
    functionView
} from '../core/graph/index.js';
import { graph_query } from '../core/search/index.js';

describe('Story 23.1: Discussions as Graph Nodes', () => {
    let memoryStore;
    beforeEach(() => {
        // Use in-memory graph store for fast, isolated test execution
        memoryStore = createMemoryRepositoryStore();
        configureGraphStore(() => memoryStore);
    });

    it('builds structured discussion records and frontmatter markdown', () => {
        const record = buildDiscussionRecord({
            question: 'Should we use Ladybug for discussions?',
            responses: {
                Architect: 'Yes, it unifies code and knowledge.',
                Coder: 'Agreed, simpler queries.'
            },
            sources: [
                { file: 'core/graph/index.js', relevance: 0.9 }
            ]
        });

        expect(record.title).toBe('Should we use Ladybug for discussions?');
        expect(record.responses).toHaveLength(2);
        expect(record.body).toContain('**Architect**: Yes');
        expect(record.body).toContain('**Coder**: Agreed');

        const md = formatDiscussionMarkdown(record);
        expect(md).toContain('tags: ["discussion"]');
        expect(md).toContain('target: "core/graph/index.js"');

        const parsed = parseDiscussionMarkdown(md);
        expect(parsed.title).toBe(record.title);
        expect(parsed.responses).toHaveLength(2);
        expect(parsed.sources[0].target).toBe('core/graph/index.js');
    });

    it('saves a discussion node and grounding edges with proper confidence in session scope', async () => {
        const sessionId = `test-session-${Date.now()}`;
        const result = await saveDiscussion({
            sessionId,
            question: 'How to structure graph models?',
            responses: {
                Lead: 'Separate models from storage adapters.'
            },
            sources: [
                { file: 'core/graph/model/graphModel.js', relevance: 0.95, confidence: 'EXTRACTED' },
                { file: 'core/graph/adapters/memory/index.js', relevance: 0.5, confidence: 'INFERRED' },
                { file: 'decision:cloud-model', confidence: 'AMBIGUOUS' }
            ]
        });

        expect(result.success).toBe(true);
        expect(result.node.type).toBe('Discussion');
        expect(result.node.kind).toBe('discussion');
        expect(result.node.scope).toBe(sessionScope(sessionId));
        expect(result.node.name).toBe('How to structure graph models?');

        // Edges should include both forward (DISCUSSES) and reverse (DISCUSSED_IN)
        const forwardEdges = result.edges.filter(e => e.type === 'DISCUSSES');
        expect(forwardEdges).toHaveLength(3);

        const extractedEdge = forwardEdges.find(e => e.to === 'file:core/graph/model/graphmodel.js');
        expect(extractedEdge).toBeDefined();
        expect(extractedEdge.confidence).toBe(CONFIDENCE.EXTRACTED);

        const inferredEdge = forwardEdges.find(e => e.to === 'file:core/graph/adapters/memory/index.js');
        expect(inferredEdge).toBeDefined();
        expect(inferredEdge.confidence).toBe(CONFIDENCE.INFERRED);

        const ambiguousEdge = forwardEdges.find(e => e.to === 'decision:cloud-model');
        expect(ambiguousEdge).toBeDefined();
        expect(ambiguousEdge.confidence).toBe(CONFIDENCE.AMBIGUOUS);

        // Verify retrieval through loadDiscussions
        const loaded = await loadDiscussions({ sessionId });
        expect(loaded.nodes).toHaveLength(1);
        expect(loaded.nodes[0].id).toBe(result.node.id);
        expect(loaded.edges.length).toBeGreaterThan(0);

        const singleLoaded = await loadDiscussions({ sessionId, id: result.node.id });
        expect(singleLoaded.found).toBe(true);
        expect(singleLoaded.discussion.id).toBe(result.node.id);
        expect(singleLoaded.edges.length).toBeGreaterThan(0);
    });

    it('graph_query finds discussions via incoming and outgoing traversals', async () => {
        const sessionId = `query-session-${Date.now()}`;
        const saveResult = await saveDiscussion({
            sessionId,
            question: 'Cache strategy for graph queries',
            responses: { Agent: 'Use in-memory LRU cache.' },
            sources: [
                { file: 'core/search/graphModelLoader.js', relevance: 0.9 }
            ]
        });

        const discId = saveResult.node.id;

        // 1. Query by discussion node ID with outgoing: true (find grounded files)
        const outgoingRes = await graph_query({
            sessionId,
            node: discId,
            outgoing: true
        });
        expect(outgoingRes.available).toBe(true);
        expect(outgoingRes.nodes.some(n => n.id.includes('graphmodelloader'))).toBe(true);

        // 2. Query by discussion node ID with incoming: true (find incoming references)
        const incomingRes = await graph_query({
            sessionId,
            node: discId,
            incoming: true
        });
        expect(incomingRes.available).toBe(true);
        expect(incomingRes.nodes.some(n => n.id.includes('graphmodelloader'))).toBe(true);

        // 3. Reverse lookup: query from target file with incoming: true (finds the discussion)
        const reverseRes = await graph_query({
            sessionId,
            node: 'file:core/search/graphmodelloader.js',
            incoming: true
        });
        expect(reverseRes.available).toBe(true);
        expect(reverseRes.nodes.some(n => n.id === discId)).toBe(true);
    });

    it('session without discussions returns a valid empty graph and does not crash', async () => {
        const sessionId = `empty-session-${Date.now()}`;
        const loaded = await loadDiscussions({ sessionId });
        expect(loaded.nodes).toEqual([]);
        expect(loaded.edges).toEqual([]);

        const queryRes = await graph_query({
            sessionId,
            node: 'discussion:non-existent'
        });
        expect(queryRes.available).toBe(true);
        expect(queryRes.matchCount).toBe(0);
        expect(queryRes.nodes).toEqual([]);
    });

    it('preserves existing markdown persistence when writeMarkdown is true', async () => {
        const sessionId = `md-session-${Date.now()}`;
        const tempDir = path.join(process.cwd(), 'scratch', 'test-discussions', sessionId);

        const result = await saveDiscussion({
            sessionId,
            markdownDir: tempDir,
            writeMarkdown: true,
            question: 'Decoupling packages',
            responses: { Architect: 'Package boundaries must be clean.' },
            sources: ['core/graph/index.js']
        });

        expect(result.path).toBeDefined();
        expect(fs.existsSync(result.path)).toBe(true);

        const content = fs.readFileSync(result.path, 'utf8');
        expect(content).toContain('Decoupling packages');
        expect(content).toContain('Package boundaries must be clean.');

        // Clean up scratch file
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('findDiscussionsForNode and queryDiscussions locate relevant discussions', () => {
        const graph = createGraph('test-graph');
        const discNode = {
            id: 'discussion:1-auth-flow',
            type: 'Discussion',
            name: 'Authentication flow discussion',
            topic: 'OAuth vs JWT',
            body: 'Decision made to support JWT tokens.'
        };
        const fileNode = {
            id: 'file:core/auth.js',
            type: 'CodeFile',
            path: 'core/auth.js'
        };

        graph.addNode(discNode.id, discNode.type, discNode);
        graph.addNode(fileNode.id, fileNode.type, fileNode);
        graph.addEdge(discNode.id, fileNode.id, 'DISCUSSES', { weight: 0.9, confidence: 'EXTRACTED' });
        graph.addEdge(fileNode.id, discNode.id, 'DISCUSSED_IN', { weight: 0.9, confidence: 'EXTRACTED' });

        const forFile = findDiscussionsForNode(graph, 'file:core/auth.js');
        expect(forFile).toHaveLength(1);
        expect(forFile[0].id).toBe('discussion:1-auth-flow');

        const byTopic = queryDiscussions(graph, { topic: 'JWT' });
        expect(byTopic).toHaveLength(1);
        expect(byTopic[0].id).toBe('discussion:1-auth-flow');

        const nonMatch = queryDiscussions(graph, { topic: 'PostgreSQL' });
        expect(nonMatch).toHaveLength(0);
    });

    it('rankGraphNodes boosts Discussion nodes when query words mention discussions', () => {
        const graph = createGraph('rank-graph');
        graph.addNode('doc:notes.md', 'Document', { path: 'notes.md', documentation: 'general discussion notes' });
        graph.addNode('discussion:db-choice', 'Discussion', {
            id: 'discussion:db-choice',
            type: 'Discussion',
            name: 'Database Choice',
            topic: 'Database choice discussion',
            purpose: 'Discussed Ladybug graph database engine'
        });

        const ranked = rankGraphNodes(graph, 'wat werd besproken in de discussie over database', { limit: 5 });
        expect(ranked.length).toBeGreaterThan(0);
        expect(ranked[0].node.type).toBe('Discussion');
    });

    it('buildContextFromGraph renders Related Discussions section', async () => {
        const graph = createGraph('ctx-graph');
        graph.addNode('discussion:cache', 'Discussion', {
            id: 'discussion:cache',
            type: 'Discussion',
            title: 'Cache Invalidation Strategy',
            purpose: 'Clear cache upon graph changes'
        });

        const context = await buildContextFromGraph(graph, 'cache invalidation');
        expect(context).toContain('## Related Discussions');
        expect(context).toContain('Cache Invalidation Strategy');
    });

    it('editDiscussion appends responses and new sources to existing discussions', async () => {
        const sessionId = `edit-session-${Date.now()}`;
        const initial = await saveDiscussion({
            sessionId,
            question: 'Architecture refactor',
            responses: [{ speaker: 'User', text: 'Should we refactor the router?' }],
            sources: ['core/router.js']
        });

        const edited = await editDiscussion({
            sessionId,
            id: initial.node.id,
            appendResponse: { speaker: 'Claude', text: 'Yes, extract route matching.' },
            addSources: ['core/routeMatcher.js']
        });

        expect(edited.saved).toBe(true);
        expect(edited.node.responses).toHaveLength(2);
        expect(edited.node.responses[0].speaker).toBe('User');
        expect(edited.node.responses[1].speaker).toBe('Claude');
        expect(edited.node.sources).toContain('core/router.js');
        expect(edited.node.sources).toContain('core/routeMatcher.js');

        const reloaded = await loadDiscussions({ sessionId, id: initial.node.id });
        expect(reloaded.found).toBe(true);
        expect(reloaded.discussion.responses).toHaveLength(2);
    });

    it('fileImpact surfaces discussions attached to code files', () => {
        const graph = createGraph('impact-disc-test');
        graph.addNode('file:core/auth.js', 'CodeFile', { path: 'core/auth.js' });
        graph.addNode('discussion:auth-jwt', 'Discussion', {
            id: 'discussion:auth-jwt',
            title: 'OAuth vs JWT decision',
            type: 'Discussion'
        });
        graph.addEdge('discussion:auth-jwt', 'file:core/auth.js', 'DISCUSSES', {});
        graph.addEdge('file:core/auth.js', 'discussion:auth-jwt', 'DISCUSSED_IN', {});

        const impact = fileImpact(graph, ['core/auth.js']);
        const authImpact = impact.get('core/auth.js');
        expect(authImpact).toBeDefined();
        expect(authImpact.discussions).toContain('OAuth vs JWT decision');
    });

    it('functionView surfaces discussions attached to function definition file or symbol', () => {
        const graph = createGraph('function-disc-test');
        graph.addNode('file:core/auth.js', 'CodeFile', {
            path: 'core/auth.js',
            kind: 'source',
            exports: ['authenticate'],
            symbolRanges: { authenticate: [1, 5] }
        });
        graph.addNode('discussion:auth-flow', 'Discussion', {
            id: 'discussion:auth-flow',
            title: 'Authentication Security Review',
            type: 'Discussion'
        });
        graph.addEdge('discussion:auth-flow', 'file:core/auth.js', 'DISCUSSES', {});

        const result = functionView(graph, 'authenticate', { readFile: () => 'export function authenticate() {}\n' });
        expect(result.found).toBe(true);
        expect(result.discussions).toHaveLength(1);
        expect(result.discussions[0].title).toBe('Authentication Security Review');
    });

    it('rankGraphNodes boosts Discussion nodes when asking about afspraken or besprekingen', () => {
        const graph = createGraph('rank-disc-test');
        graph.addNode('file:core/auth.js', 'CodeFile', { path: 'core/auth.js', exports: ['authenticate'] });
        graph.addNode('discussion:afspraak-auth', 'Discussion', {
            id: 'discussion:afspraak-auth',
            title: 'Afspraak over authenticatie protocol',
            purpose: 'Afgesproken om JWT tokens te gebruiken'
        });

        const ranked = rankGraphNodes(graph, 'wat is er afgesproken over authenticatie?');
        expect(ranked.length).toBeGreaterThan(0);
        expect(ranked[0].node.id).toBe('discussion:afspraak-auth');
    });
});
