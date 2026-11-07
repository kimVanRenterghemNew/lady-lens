/**
 * Kura on 1.0.20 (2026-11-04): "bewaar de sessie status" put core/memory/sessionState.js on place 6, behind the barrel
 * core/knowledge/index.js (13.10 vs 10.08). The compound bonus (+6 when every word of the file name is in the query) never
 * fired for a camelCase name: the name was split after lowercasing, so "sessionstate" was one word.
 */
import { describe, it, expect } from 'vitest';
import { rankGraphNodes } from '../core/graph/index.js';

const file = (path, exports, purpose = '') => ({ id: `file:${path}`, type: 'CodeFile', path, name: path.split('/').pop(), exports, symbols: exports, purpose });

const graph = {
    nodes: new Map([
        file('core/memory/sessionState.js', ['sessionRoot', 'listSessions', 'initializeSession', 'readSessionVision', 'updateSessionState', 'readSessionState', 'addArtifacts']),
        file('core/knowledge/index.js', ['createKnowledgeStore', 'saveKnowledge', 'loadKnowledge', 'exportGraph', 'persistSessionGraph'], 'governance knowledge stored in and read from the graph'),
        file('core/knowledge/sessionGraph.js', ['sessionNodeId', 'toSessionGraph', 'persistSessionGraph']),
        file('core/handlers/sessionHandlers.js', ['handleSession', 'handleClear']),
        file('commands/status.js', ['statusCommand'])
    ].map(node => [node.id, node])),
    edges: []
};

describe('compound file name', () => {
    it('a camelCase file whose name words are all in the query beats a barrel that shares a word', () => {
        expect(rankGraphNodes(graph, 'bewaar de sessie status')[0].node.path).toBe('core/memory/sessionState.js');
    });
});
