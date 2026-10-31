import { debug } from '../../observability/index.js';
import { findSemanticMatches, buildContextMarkdown } from './graphSemantic.js';

const asList = (value) => (Array.isArray(value) ? value : value ? [String(value)] : []);

/**
 * Build context block from graph query for prompt injection
 *
 * Phase 14.2 enhancement: Includes semantic matching and extracted concepts
 *
 * @param {Graph} graph - graphModel instance (or compatible query facade)
 * @param {string} featureDescription - User's request
 * @param {object} opts - Query options
 *   - includeInferred: include extracted (INFERRED) concepts (default true)
 *   - semanticThreshold: min semantic similarity (default 0.7)
 *   - limit: max decisions and max modules to return (default 5)
 * @returns {string} Markdown context block ready for prompt injection
 */
export async function buildContextFromGraph(graph, featureDescription, opts = {}) {
  const { includeInferred = true, semanticThreshold = 0.7, limit = 5 } = opts;

  const desc = featureDescription.toLowerCase();
  const descWords = desc.split(/\s+/);

  let block = '';

  if (includeInferred) {
    const conceptMatches = findSemanticMatches(graph, featureDescription, {
      limit: 5,
      threshold: semanticThreshold,
      currentOnly: true
    });

    if (conceptMatches.length > 0) {
      block += buildContextMarkdown(conceptMatches, graph) + '\n\n';
    }
  }

  const decisions = graph.getNodesByType('Decision')
    .filter(d => {
      const titleWords = (d.title || '').toLowerCase().split(/\s+/);
      return descWords.some(dw => titleWords.some(tw => tw.includes(dw) || dw.includes(tw)));
    })
    .slice(0, limit);

  const modules = [...graph.getNodesByType('Module'), ...graph.getNodesByType('CodeFile').filter(file => file.kind !== 'test')]
    .filter(m => {
      const path = (m.path || '').toLowerCase();
      const purpose = (m.purpose || '').toLowerCase();
      return descWords.some(dw => path.includes(dw) || purpose.includes(dw));
    })
    .slice(0, limit);

  const discussions = graph.getNodesByType('Discussion')
    .filter(d => {
      const titleWords = (d.title || d.name || d.topic || '').toLowerCase().split(/\s+/);
      return descWords.some(dw => titleWords.some(tw => tw.includes(dw) || dw.includes(tw)));
    })
    .slice(0, limit);

  if (decisions.length > 0) {
    block += '## Related Decisions\n\n';
    for (const dec of decisions) {
      block += `- **${dec.title}** (${dec.status})\n`;
      const consequences = asList(dec.consequences);
      const risks = asList(dec.risks);
      const open = asList(dec.open_questions);
      if (consequences.length > 0) block += `  - Consequences: ${consequences.join('; ')}\n`;
      if (risks.length > 0) block += `  - Risks: ${risks.join('; ')}\n`;
      if (open.length > 0) block += `  - Open: ${open.join('; ')}\n`;
    }
    block += '\n';
  }

  if (modules.length > 0) {
    block += '## Affected Modules\n\n';
    for (const mod of modules) {
      block += `- **${mod.path}**: ${mod.purpose}\n`;
      if (mod.tech_debt && mod.tech_debt.length > 0) {
        block += `  - Tech debt: ${mod.tech_debt.slice(0, 2).join('; ')}\n`;
      }
    }
    block += '\n';
  }

  if (discussions.length > 0) {
    block += '## Related Discussions\n\n';
    for (const disc of discussions) {
      block += `- **${disc.title || disc.name || disc.topic}**\n`;
      const preview = (disc.purpose || disc.body || '').replace(/\r?\n/g, ' ').slice(0, 160);
      if (preview) block += `  - ${preview}\n`;
    }
    block += '\n';
  }

  debug(2, 'graph:context', `Built context for "${featureDescription}": ${block.length} chars`);

  return block || '';
}
