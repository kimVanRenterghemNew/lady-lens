import { documentNodeId, resolveDocumentLink, fileNodeId } from '../adapters/ladybug/index.js';

const MAX_DECLARERS = 3;

function resolveReferenceTarget(ref, { codePaths, docPaths }) {
    for (const candidate of [ref.fromSource, ref.asRepo, `${ref.fromSource}.md`, `${ref.asRepo}.md`]) {
        if (codePaths.has(candidate) || docPaths.has(candidate)) return candidate;
    }
    return null;
}

/**
 * Pure: derive document relations for a document:
 * 1. Declared frontmatter `links:` (take priority).
 * 2. `REFERENCES` edges from markdown links and backtick paths (weight = count).
 * 3. `MENTIONS` edges to code paths and declared function names.
 */
export function deriveDocumentRelations(file, info, { codePaths, docPaths, declarers, now = new Date().toISOString() }) {
    const relations = [];
    const frontmatterTargets = new Set();

    // 1. Declared frontmatter links:
    for (const link of info.metadata?.links || []) {
        const target = resolveDocumentLink(file, link.target, docPaths);
        if (!target || target === file) continue;
        frontmatterTargets.add(target);
        relations.push({
            from: documentNodeId(file),
            to: documentNodeId(target),
            relation: link.relation,
            confidence: 'EXTRACTED',
            weight: link.weight ?? 1,
            createdAt: now
        });
    }

    // 2. Body references (markdown links & backtick paths):
    const refCounts = new Map();
    for (const ref of info.metadata?.references || []) {
        const target = resolveReferenceTarget(ref, { codePaths, docPaths });
        if (!target || target === file || frontmatterTargets.has(target)) continue;
        refCounts.set(target, (refCounts.get(target) || 0) + 1);
    }

    for (const [target, weight] of refCounts) {
        const toId = docPaths.has(target) ? documentNodeId(target) : fileNodeId(target);
        relations.push({
            from: documentNodeId(file),
            to: toId,
            relation: 'REFERENCES',
            confidence: 'EXTRACTED',
            weight,
            createdAt: now
        });
    }

    // 3. Mentions (document names a code file path or function):
    const mentioned = new Map();
    for (const target of info.metadata?.mentions?.paths || []) {
        if (codePaths.has(target)) mentioned.set(target, 'EXTRACTED');
    }
    for (const name of info.metadata?.mentions?.names || []) {
        const declaring = declarers().get(name) || [];
        if (declaring.length <= MAX_DECLARERS) {
            for (const target of declaring) {
                if (!mentioned.has(target)) mentioned.set(target, 'INFERRED');
            }
        }
    }
    for (const [target, confidence] of mentioned) {
        relations.push({
            from: documentNodeId(file),
            to: fileNodeId(target),
            relation: 'MENTIONS',
            confidence,
            createdAt: now
        });
    }

    return relations;
}
