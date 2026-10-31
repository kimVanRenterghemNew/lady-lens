/**
 * decisions as nodes. Each `- **Title**: text` under a `## date` heading of backlog/besluiten.md is a
 * Decision with its date and line; `(vervangt: <title>)` supersedes an older one. A plain question sees only current
 * decisions; the history only on request.
 */
import { describe, it, expect } from 'vitest';
import { parseDecisions, decisionNodes, rankGraphNodes, createGraph } from '../core/graph/index.js';

const BESLUITEN = `# Besluiten

## 2026-10-29

- **Cloudmodel**: online modellen mogen voor review (vervangt: Lokaal alleen).
- **Graph-data centraal**: één database per repo in ~/.lady-lens/.

## 2026-10-23 (voorcoder.md)

- **Lokaal alleen**: 100% lokaal op Ollama; eerst de context strak.
`;

describe('parseDecisions', () => {
    it('one decision per bold bullet, with date, title, text and line; a replacement names what it supersedes', () => {
        const decisions = parseDecisions(BESLUITEN);
        expect(decisions.map(d => [d.date, d.title, d.line])).toEqual([
            ['2026-10-29', 'Cloudmodel', 5], ['2026-10-29', 'Graph-data centraal', 6], ['2026-10-23', 'Lokaal alleen', 10]
        ]);
        expect(decisions[0]).toMatchObject({ supersedes: 'Lokaal alleen', text: 'online modellen mogen voor review (vervangt: Lokaal alleen).' });
    });

    it('MUST NOT read bullets of a document without dated headings as decisions', () => {
        expect(parseDecisions('# Story\n\n- **Status**: done\n')).toEqual([]);
    });
});

describe('decision nodes', () => {
    const doc = { id: 'doc:backlog/besluiten.md', type: 'Document', kind: 'doc', path: 'backlog/besluiten.md', decisions: parseDecisions(BESLUITEN) };

    it('a superseded decision is hidden by default, shown with history, and linked by SUPERSEDES', () => {
        const current = decisionNodes(doc);
        expect(current.nodes.map(n => n.name)).toEqual(['Cloudmodel', 'Graph-data centraal']);
        const all = decisionNodes(doc, { history: true });
        expect(all.nodes.find(n => n.name === 'Lokaal alleen')).toMatchObject({ type: 'Decision', status: 'superseded', supersededBy: 'Cloudmodel', line: 10 });
        expect(all.edges).toContainEqual({ from: all.nodes[0].id, to: all.nodes.find(n => n.name === 'Lokaal alleen').id, type: 'SUPERSEDES' });
    });

    it('a decision question ranks the current decision first; a code question does not get decisions', () => {
        const graph = createGraph('t');
        graph.addNode('file:core/models.js', 'CodeFile', { path: 'core/models.js', exports: ['pickModel'], symbols: ['model', 'cloud'] });
        for (const n of decisionNodes(doc).nodes) graph.addNode(n.id, n.type, n);
        expect(rankGraphNodes(graph, 'wat werd besloten over het cloudmodel', { limit: 3 })[0].node.name).toBe('Cloudmodel');
        expect(rankGraphNodes(graph, 'pickModel cloud model', { limit: 1 })[0].node.path).toBe('core/models.js');
    });
});

describe('a decision question puts decisions first', () => {
    it('MUST rank the decision above a long document that shares more words (live: decision on place 4)', () => {
        const doc = { id: 'doc:backlog/besluiten.md', type: 'Document', path: 'backlog/besluiten.md', decisions: parseDecisions(BESLUITEN) };
        const graph = createGraph('t');
        graph.addNode('doc:backlog/story-26-6.md', 'Document', { path: 'backlog/story-26-6.md', name: 'Story 26.6: een rol kan naar een cloudmodel', purpose: 'cloud model lokaal ollama cloud model budget privacy lokaal' });
        for (const n of decisionNodes(doc).nodes) graph.addNode(n.id, n.type, n);
        expect(rankGraphNodes(graph, 'wat werd besloten over cloud model lokaal Ollama', { limit: 3 })[0].node.type).toBe('Decision');
        expect(rankGraphNodes(graph, 'story cloud model lokaal Ollama', { limit: 1 })[0].node.type).toBe('Document');
    });
});
