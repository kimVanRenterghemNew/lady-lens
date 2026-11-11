/**
 * Graph Semantic Matching
 *
 * Semantic query matching and SUPERSEDES chain filtering.
 * - Match queries to nodes by semantic similarity
 * - Filter SUPERSEDES chains (return only leaf nodes)
 * - Build context with confidence scores
 */

import { debug } from '../../observability/index.js';

/**
 * Compute Levenshtein distance between two strings.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();

  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,      // insertion
        matrix[j - 1][i] + 1,      // deletion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Compute semantic similarity between two words (0.0-1.0).
 *
 * Uses Levenshtein distance with normalization.
 * 1.0 = identical, 0.0 = completely different.
 *
 * @param {string} word1 - First word
 * @param {string} word2 - Second word
 * @returns {number} Similarity score 0.0-1.0
 */
export function semanticSimilarity(word1, word2) {
  if (!word1 || !word2) return 0.0;

  // Handle empty strings edge case
  if (word1.length === 0 && word2.length === 0) return 1.0;
  if (word1.length === 0 || word2.length === 0) return 0.0;

  if (word1.toLowerCase() === word2.toLowerCase()) return 1.0;

  const distance = levenshteinDistance(word1, word2);
  const maxLen = Math.max(word1.length, word2.length);

  // Similarity = 1 - normalized distance
  return Math.max(0, 1 - (distance / maxLen));
}

const STEM_SCORE = 0.75;

/**
 * Check if a query word matches a node's topics semantically.
 *
 * @param {string} queryWord - Query word to match
 * @param {string[]} topics - Node's semantic topics
 * @param {number} threshold - Min similarity score (default 0.7)
 * @returns {boolean} True if word matches any topic
 */
export function matchesTopics(queryWord, topics, threshold = 0.7) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return false;
  }

  const word = String(queryWord ?? '').toLowerCase();
  // A stem ("auth") names its topic ("authentication"); Levenshtein alone scores that 0.29. A stem counts as 0.75 similar.
  const score = (topic) => (word.length >= 3 && String(topic).toLowerCase().startsWith(word))
    ? Math.max(STEM_SCORE, semanticSimilarity(queryWord, topic))
    : semanticSimilarity(queryWord, topic);
  return topics.some(topic => score(topic) >= threshold);
}

/**
 * Get the SUPERSEDES edges that replace a node.
 *
 * detectSupersedes writes `new --supersedes--> old`, so a node is superseded by whatever points AT it (incoming edges).
 *
 * @param {Graph} graph - Graph instance
 * @param {string} nodeId - Node ID
 * @returns {object[]} Array of incoming SUPERSEDES edges (from = the newer node)
 */
export function getSupersededBy(graph, nodeId) {
  return graph.getIncoming(nodeId).filter(e => e.type === 'supersedes');
}

/**
 * A concept is "current" when no other concept supersedes it (no incoming SUPERSEDES edge); the newest one in a chain.
 *
 * @param {Graph} graph - Graph instance
 * @param {string} nodeId - Node ID
 * @returns {boolean} True if nothing supersedes this node
 */
export function isCurrentConcept(graph, nodeId) {
  return getSupersededBy(graph, nodeId).length === 0;
}

/**
 * Find all nodes matching a query, with semantic and keyword matching.
 *
 * @param {Graph} graph - Graph instance
 * @param {string} query - Query string
 * @param {object} opts - Options:
 *   - limit: max results (default 20)
 *   - threshold: min semantic similarity (default 0.7)
 *   - currentOnly: only return leaf nodes in SUPERSEDES chains (default true)
 * @returns {object[]} Matching nodes
 */
export function findSemanticMatches(graph, query, opts = {}) {
  const { limit = 20, threshold = 0.7, currentOnly = true } = opts;

  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0);

  if (queryWords.length === 0) {
    return [];
  }

  const matches = [];
  const seen = new Set();

  for (const node of graph.nodes.values()) {
    if (seen.has(node.id)) continue;
    if (matches.length >= limit) break;

    // Only Concept nodes participate in SUPERSEDES chains; skip the filter for other types
    if (node.type === 'Concept' && currentOnly && !isCurrentConcept(graph, node.id)) continue;

    let isMatch = false;

    // Direct keyword match in title
    if (queryWords.some(w => node.title?.toLowerCase().includes(w))) {
      isMatch = true;
    }

    // Semantic match in topics
    if (!isMatch && node.topics) {
      isMatch = queryWords.some(queryWord =>
        matchesTopics(queryWord, node.topics, threshold)
      );
    }

    if (isMatch) {
      seen.add(node.id);
      matches.push(node);
    }
  }

  debug(2, 'graph:semantic',
    `Found ${matches.length} semantic matches for "${query}" (query words: ${queryWords.length})`);

  return matches;
}

/**
 * Build markdown context block from matched nodes.
 *
 * Includes confidence scores for INFERRED (extracted) concepts.
 *
 * @param {object[]} nodes - Nodes to include in context
 * @param {Graph} graph - Graph instance (for edge traversal)
 * @returns {string} Markdown context block
 */
function renderConceptNode(node) {
  const confidence = node.confidence ? ` (confidence: ${node.confidence.toFixed(2)})` : '';
  const parts = [`### ${node.title}${confidence}`, node.content];
  if (node.topics && node.topics.length > 0) parts.push(`**Topics**: ${node.topics.join(', ')}`);
  return parts.join('\n');
}

function renderDecisionNode(node) {
  const parts = [`### ${node.title}`, `**Status**: ${node.status || 'active'}`];
  if (node.consequences) parts.push(`**Consequences**: ${node.consequences}`);
  if (node.risks) parts.push(`**Risks**: ${node.risks}`);
  return parts.join('\n');
}

function renderModuleNode(node) {
  const parts = [`### ${node.path}`];
  if (node.purpose) parts.push(`**Purpose**: ${node.purpose}`);
  return parts.join('\n');
}

export function buildContextMarkdown(nodes) {
  if (!nodes || nodes.length === 0) {
    return '(No matching concepts found)';
  }

  const sections = [];

  const extracted = nodes.filter(n => n.type === 'Concept');
  if (extracted.length > 0) {
    sections.push(`## Extracted Concepts\n\n${extracted.map(renderConceptNode).join('\n\n')}\n`);
  }

  const decisions = nodes.filter(n => n.type === 'Decision');
  if (decisions.length > 0) {
    sections.push(`## Decisions\n\n${decisions.map(renderDecisionNode).join('\n\n')}\n`);
  }

  const modules = nodes.filter(n => n.type === 'Module');
  if (modules.length > 0) {
    sections.push(`## Affected Modules\n\n${modules.map(renderModuleNode).join('\n\n')}\n`);
  }

  return sections.join('\n').trim();
}
