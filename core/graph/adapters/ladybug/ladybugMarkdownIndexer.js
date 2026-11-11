import crypto from 'crypto';
import path from 'path';
import { parseFrontmatter } from '../../../configuration/index.js';
import { normalizeNodeId, parseDecisions } from '../../model/index.js';
import { normalizeRelativePath } from '../../../repository/index.js';

function markdownBody(source) {
    return String(source).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function firstHeading(body) {
    return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

/** `doc:<repo-relative path>` through the shared normalizer. */
export function documentNodeId(relativePath) {
    return normalizeNodeId(`doc:${normalizeRelativePath(relativePath)}`);
}

const MAX_MENTIONS = 400;

/**
 * Pure: the code a document names: repo paths of code files, and code names (in backticks, or camelCase anywhere).
 * The sync turns them into MENTIONS relations, so "which stories name this function" is a lookup, not a scan.
 */
export function documentMentions(body) {
    const text = String(body);
    const paths = [...new Set((text.replace(/\\/g, '/').match(/[\w.-]+(?:\/[\w.-]+)+\.(?:js|mjs|cjs)\b/g) ?? []).map(p => p.replace(/^\.\//, '')))];
    const quoted = [...text.matchAll(/`([A-Za-z_$][\w$]{2,})(?:\(\))?`/g)].map(match => match[1]);
    const camel = text.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g) ?? [];
    return { paths: paths.slice(0, MAX_MENTIONS), names: [...new Set([...quoted, ...camel])].slice(0, MAX_MENTIONS) };
}

/**
 * Pure: extract explicit markdown links [x](target) and backtick paths `path/to/file` from body.
 */
export function documentReferences(relativePath, body) {
    const text = String(body);
    const sourceDir = path.posix.dirname(relativePath);
    const refs = [];

    for (const match of text.matchAll(/\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        let raw = match[1].split('#')[0].split('?')[0].trim();
        if (!raw || /^[a-z]+:\/\//i.test(raw) || raw.startsWith('mailto:')) continue;
        raw = raw.replace(/^\.\//, '').replace(/\\/g, '/');
        refs.push({ raw, fromSource: path.posix.normalize(path.posix.join(sourceDir, raw)), asRepo: path.posix.normalize(raw) });
    }

    for (const match of text.matchAll(/`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9_]+)\b`/g)) {
        const raw = match[1].replace(/^\.\//, '').replace(/\\/g, '/');
        refs.push({ raw, fromSource: path.posix.normalize(path.posix.join(sourceDir, raw)), asRepo: path.posix.normalize(raw) });
    }

    return refs;
}

/**
 * Pure: the project entity for one markdown file plus its declared `links:`.
 * Links are resolved later, once every document id is known.
 */
export function buildDocumentEntity(relativePath, source, { now = new Date().toISOString() } = {}) {
    const frontmatter = parseFrontmatter(source);
    const body = markdownBody(source);
    const links = (Array.isArray(frontmatter.links) ? frontmatter.links : [])
        .filter(link => link?.target && link?.relation)
        .map(link => ({ target: String(link.target), relation: String(link.relation), weight: link.weight ?? 1 }));
    return {
        id: documentNodeId(relativePath),
        type: 'Document',
        kind: 'doc',
        scope: 'project',
        path: relativePath,
        name: frontmatter.title || firstHeading(body) || path.basename(relativePath),
        documentation: body.slice(0, 4000),
        contentHash: crypto.createHash('sha256').update(source).digest('hex'),
        // the decisions file becomes Decision nodes at load time. shortcut: by file name, until docs declare `type: decisions`.
        metadata: {
            links,
            mentions: documentMentions(body),
            references: documentReferences(relativePath, body),
            ...(/(^|\/)besluiten\.md$/.test(relativePath) ? { decisions: parseDecisions(source) } : {})
        },
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}

/** Resolve a `links:` target of `sourcePath` to one of `knownPaths` (repo-relative), or null. */
export function resolveDocumentLink(sourcePath, target, knownPaths) {
    const candidates = targetCandidates(sourcePath, target);
    return candidates.find(candidate => knownPaths.has(candidate))
        || [...knownPaths].find(known => candidates.some(candidate => known.endsWith(`/${candidate}`)))
        || null;
}

function targetCandidates(sourcePath, target) {
    const normalizedTarget = normalizeRelativePath(target).replace(/\.md$/, '');
    const sourceDirectory = path.posix.dirname(sourcePath);
    return [
        `${sourceDirectory}/${normalizedTarget}.md`,
        `${normalizedTarget}.md`,
        `backlog/${normalizedTarget}.md`
    ].map(normalizeRelativePath);
}
