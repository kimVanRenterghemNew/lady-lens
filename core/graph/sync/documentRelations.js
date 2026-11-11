import { documentNodeId, resolveDocumentLink, fileNodeId } from '../adapters/ladybug/index.js';

const MAX_DECLARERS = 3;

function inferMentionsForName(name, declarersMap, mentioned) {
    const declaring = declarersMap.get(name) || [];
    if (declaring.length > MAX_DECLARERS) return;
    for (const target of declaring) {
        if (!mentioned.has(target)) mentioned.set(target, 'INFERRED');
    }
}

function resolveReferenceTarget(ref, { codePaths, docPaths }) {
    for (const candidate of [ref.fromSource, ref.asRepo, `${ref.fromSource}.md`, `${ref.asRepo}.md`]) {
        if (codePaths.has(candidate) || docPaths.has(candidate)) return candidate;
    }
    return null;
}

function buildFrontmatterRelation(file, link, docPaths, now) {
    const target = resolveDocumentLink(file, link.target, docPaths);
    if (!target || target === file) return null;
    return {
        target,
        relation: {
            from: documentNodeId(file),
            to: documentNodeId(target),
            relation: link.relation,
            confidence: 'EXTRACTED',
            weight: link.weight ?? 1,
            createdAt: now
        }
    };
}

function deriveFrontmatterRelations(file, links, docPaths, now) {
    const relations = [];
    const targets = new Set();
    for (const link of links) {
        const item = buildFrontmatterRelation(file, link, docPaths, now);
        if (item) {
            targets.add(item.target);
            relations.push(item.relation);
        }
    }
    return { relations, targets };
}

function recordReference(ref, paths, frontmatterTargets, file, refCounts) {
    const target = resolveReferenceTarget(ref, paths);
    if (!target || target === file || frontmatterTargets.has(target)) return;
    const current = refCounts.get(target) || 0;
    refCounts.set(target, current + 1);
}

function collectReferenceCounts(references, paths, frontmatterTargets, file) {
    const refCounts = new Map();
    for (const ref of references) {
        recordReference(ref, paths, frontmatterTargets, file, refCounts);
    }
    return refCounts;
}

function toReferenceRelation(file, target, weight, docPaths, now) {
    const toId = docPaths.has(target) ? documentNodeId(target) : fileNodeId(target);
    return {
        from: documentNodeId(file),
        to: toId,
        relation: 'REFERENCES',
        confidence: 'EXTRACTED',
        weight,
        createdAt: now
    };
}

function deriveReferenceRelations(file, references, paths, frontmatterTargets, now) {
    const refCounts = collectReferenceCounts(references, paths, frontmatterTargets, file);
    return [...refCounts.entries()].map(([target, weight]) =>
        toReferenceRelation(file, target, weight, paths.docPaths, now)
    );
}

function recordPathMentions(paths, codePaths, mentioned) {
    for (const target of paths) {
        if (codePaths.has(target)) mentioned.set(target, 'EXTRACTED');
    }
}

function recordNameMentions(names, declarers, mentioned) {
    const decls = declarers();
    for (const name of names) {
        inferMentionsForName(name, decls, mentioned);
    }
}

function collectMentioned(mentions, codePaths, declarers) {
    const mentioned = new Map();
    recordPathMentions(mentions?.paths || [], codePaths, mentioned);
    recordNameMentions(mentions?.names || [], declarers, mentioned);
    return mentioned;
}

function toMentionRelation(file, target, confidence, now) {
    return {
        from: documentNodeId(file),
        to: fileNodeId(target),
        relation: 'MENTIONS',
        confidence,
        createdAt: now
    };
}

function deriveMentionRelations(file, mentions, codePaths, declarers, now) {
    const mentioned = collectMentioned(mentions, codePaths, declarers);
    return [...mentioned.entries()].map(([target, confidence]) =>
        toMentionRelation(file, target, confidence, now)
    );
}

/**
 * Pure: derive document relations for a document:
 * 1. Declared frontmatter `links:` (take priority).
 * 2. `REFERENCES` edges from markdown links and backtick paths (weight = count).
 * 3. `MENTIONS` edges to code paths and declared function names.
 */
export function deriveDocumentRelations(file, info, { codePaths, docPaths, declarers, now = new Date().toISOString() }) {
    const metadata = info.metadata || {};
    const { relations: frontmatterRels, targets } = deriveFrontmatterRelations(file, metadata.links || [], docPaths, now);
    const refRels = deriveReferenceRelations(file, metadata.references || [], { codePaths, docPaths }, targets, now);
    const mentionRels = deriveMentionRelations(file, metadata.mentions, codePaths, declarers, now);

    return [...frontmatterRels, ...refRels, ...mentionRels];
}
