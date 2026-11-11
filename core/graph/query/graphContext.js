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
function formatDecision(dec) {
  let lines = `- **${dec.title}** (${dec.status})\n`;
  const consequences = asList(dec.consequences);
  const risks = asList(dec.risks);
  const open = asList(dec.open_questions);
  if (consequences.length > 0) lines += `  - Consequences: ${consequences.join('; ')}\n`;
  if (risks.length > 0) lines += `  - Risks: ${risks.join('; ')}\n`;
  if (open.length > 0) lines += `  - Open: ${open.join('; ')}\n`;
  return lines.trimEnd();
}

function formatModule(mod) {
  let lines = `- **${mod.path}**: ${mod.purpose}\n`;
  if (mod.tech_debt && mod.tech_debt.length > 0) {
    lines += `  - Tech debt: ${mod.tech_debt.slice(0, 2).join('; ')}\n`;
  }
  return lines.trimEnd();
}

function pickField(obj, keys) {
  for (const k of keys) {
    if (obj[k]) return obj[k];
  }
  return '';
}

function formatDiscussion(disc) {
  const heading = pickField(disc, ['title', 'name', 'topic']);
  const preview = pickField(disc, ['purpose', 'body']).replace(/\r?\n/g, ' ').slice(0, 160);
  const detail = preview ? `\n  - ${preview}` : '';
  return `- **${heading}**${detail}`;
}

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
    block += `## Related Decisions\n\n${decisions.map(formatDecision).join('\n')}\n\n`;
  }

  if (modules.length > 0) {
    block += `## Affected Modules\n\n${modules.map(formatModule).join('\n')}\n\n`;
  }

  if (discussions.length > 0) {
    block += `## Related Discussions\n\n${discussions.map(formatDiscussion).join('\n')}\n\n`;
  }

  debug(2, 'graph:context', `Built context for "${featureDescription}": ${block.length} chars`);

  return block || '';
}
