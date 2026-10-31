/**
 * Discussion record representation and formatting.
 *
 * @module core/discussions/model/record
 */
import { parseFrontmatter } from '../../configuration/index.js';

/**
 * Format string as a filesystem-safe slug.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
    const slug = String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+|-+$)/g, '')
        .slice(0, 50);
    return slug || 'discussion';
}

/**
 * Build a structured discussion record.
 * @param {object} input
 * @param {string} input.question
 * @param {object|Array} [input.responses]
 * @param {Array} [input.sources]
 * @param {object} [input.metadata]
 * @param {string} [input.date]
 * @param {string} [input.key]
 * @returns {object}
 */
export function buildDiscussionRecord({ question, responses = {}, sources = [], metadata = {}, date = null, key = null } = {}) {
    if (!question || typeof question !== 'string') {
        throw new Error('buildDiscussionRecord requires a non-empty question string');
    }
    const responseEntries = Array.isArray(responses)
        ? responses
        : Object.entries(responses || {}).map(([speaker, text]) => ({ speaker, text: String(text) }));

    const body = responseEntries
        .map(r => `**${r.speaker}**: ${r.text}`)
        .join('\n\n');

    const discussionDate = date || new Date().toISOString().slice(0, 10);
    const recordKey = key || `${Date.now()}-${slugify(question)}`;

    return {
        key: recordKey,
        title: question,
        question,
        date: discussionDate,
        body,
        responses: responseEntries,
        sources: Array.isArray(sources) ? sources : [],
        tags: ['discussion'],
        metadata: { ...metadata }
    };
}

/**
 * Format discussion record as durable markdown content with frontmatter.
 * @param {object} record
 * @returns {string}
 */
export function formatDiscussionMarkdown(record) {
    const frontmatter = [
        '---',
        `title: ${JSON.stringify(record.title)}`,
        `date: ${JSON.stringify(record.date)}`,
        `tags: [${(record.tags || ['discussion']).map(t => JSON.stringify(t)).join(', ')}]`,
        'links:',
        ...(record.sources || []).map(s => {
            const target = typeof s === 'string' ? s : (s.file || s.target || s.id || '');
            const rel = (typeof s === 'object' && s.relation) || 'discussed';
            const weight = (typeof s === 'object' && s.weight) || (s.relevance ? Math.min(1, s.relevance / 10) : 0.5);
            return `  - target: ${JSON.stringify(target)}\n    relation: ${JSON.stringify(rel)}\n    weight: ${weight}`;
        }),
        '---',
        '',
        `# ${record.title}`,
        '',
        record.body || ''
    ].join('\n');
    return frontmatter;
}

/**
 * Parse a markdown discussion file into a structured discussion record.
 * @param {string} source
 * @param {string} [relativePath]
 * @returns {object}
 */
export function parseDiscussionMarkdown(source, relativePath = '') {
    const frontmatter = parseFrontmatter(source);
    const body = String(source || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
    const title = frontmatter.title || firstHeading || relativePath || 'Discussion';

    const personaRegex = /\*\*([^*]+)\*\*:\s*([\s\S]*?)(?=(?:\r?\n\r?\n\*\*[^*]+\*\*:|$))/g;
    const responses = [];
    let match;
    while ((match = personaRegex.exec(body)) !== null) {
        responses.push({ speaker: match[1].trim(), text: match[2].trim() });
    }

    const sources = (Array.isArray(frontmatter.links) ? frontmatter.links : []).map(l => ({
        target: l.target,
        relation: l.relation || 'discussed',
        weight: l.weight ?? 0.5
    }));

    const key = frontmatter.key || relativePath.replace(/^.*[/\\]/, '').replace(/\.md$/, '') || slugify(title);

    return {
        key,
        title,
        question: title,
        date: frontmatter.date || new Date().toISOString().slice(0, 10),
        body,
        responses,
        sources,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : ['discussion'],
        metadata: frontmatter
    };
}

/**
 * Builds discussion record, formatted markdown, and node/edge previews.
 * @param {object} input
 * @returns {object}
 */
export function buildDiscussion(input = {}) {
    const record = buildDiscussionRecord(input);
    const markdown = formatDiscussionMarkdown(record);
    return {
        record,
        markdown
    };
}

/**
 * Appends a response to an existing discussion record.
 * @param {object} record
 * @param {{speaker: string, text: string}} response
 * @returns {object}
 */
export function appendDiscussionResponse(record, { speaker, text }) {
    if (!speaker || !text) throw new Error('appendDiscussionResponse requires speaker and text');
    const responses = [...(record.responses || []), { speaker: String(speaker), text: String(text) }];
    const body = responses.map(r => `**${r.speaker}**: ${r.text}`).join('\n\n');
    return {
        ...record,
        responses,
        body
    };
}

