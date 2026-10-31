/**
 * Discussion persistence in graph repository and optional markdown storage.
 *
 * @module core/discussions/storage/discussionStore
 */
import fs from 'fs';
import path from 'path';
import { createGraphRepository, sessionScope } from '../../graph/index.js';
import { REPO_ROOT } from '../../configuration/index.js';
import {
    buildDiscussionRecord,
    formatDiscussionMarkdown,
    createDiscussionNode,
    createDiscussionEdges,
    resolveTargetNodeId
} from '../model/index.js';

let onSaveHook = null;

export function configureDiscussionSaveHook(fn) {
    onSaveHook = fn;
}

function createSourceStubNode(targetId, rawTarget, scope, now) {
    const isDoc = targetId.startsWith('doc:') || rawTarget.endsWith('.md');
    const isFile = targetId.startsWith('file:') || /\.(js|mjs|cjs)$/i.test(rawTarget);
    const isDecision = targetId.startsWith('decision:');
    const nodeType = isDoc ? 'Document' : (isFile ? 'CodeFile' : (isDecision ? 'Decision' : 'Entity'));
    const cleanPath = rawTarget.replace(/^(file|doc|decision|discussion):/, '');
    return {
        id: targetId, type: nodeType, kind: nodeType.toLowerCase(), path: cleanPath, name: cleanPath,
        scope, createdAt: now, updatedAt: now, observedAt: now
    };
}

export async function saveDiscussion({
    key = null, question, responses = {}, sources = [], sessionId = 'default', scope = null,
    writeMarkdown = false, markdownDir = null, baseDir = null, metadata = {},
    repository = null, now = new Date().toISOString()
} = {}) {
    const record = buildDiscussionRecord({ key, question, responses, sources, metadata, date: now.slice(0, 10) });
    const targetScope = scope || sessionScope(sessionId);
    const node = createDiscussionNode(record, { scope: targetScope, now });
    const edges = createDiscussionEdges(node.id, sources, { scope: targetScope, now });

    const repo = repository || createGraphRepository();
    const sourceStubs = [];
    for (const source of sources) {
        const rawTarget = typeof source === 'string' ? source : (source.file || source.target || source.id || source.node);
        const targetId = resolveTargetNodeId(rawTarget);
        if (targetId) {
            sourceStubs.push(createSourceStubNode(targetId, rawTarget, targetScope, now));
        }
    }

    if (sourceStubs.length) {
        await repo.upsertNodes(targetScope, sourceStubs);
    }
    await repo.upsertNodes(targetScope, [node]);
    if (edges.length) {
        await repo.relate(edges, { replaceFrom: [node.id] });
    }

    let savedPath = null;
    if (writeMarkdown || markdownDir || baseDir) {
        const root = baseDir || REPO_ROOT || process.cwd();
        const dir = markdownDir || (sessionId ? path.join(root, '.memory', sessionId, 'discussions') : path.join(root, 'knowledge', 'discussions'));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        savedPath = path.join(dir, `${record.key}.md`);
        fs.writeFileSync(savedPath, formatDiscussionMarkdown(record), 'utf8');
    }

    if (typeof onSaveHook === 'function') {
        try { onSaveHook({ sessionId, scope: targetScope, node, edges }); } catch { /* ignore */ }
    }

    return { success: true, node, edges, record, path: savedPath, scope: targetScope };
}

export async function loadDiscussions({ sessionId = 'default', scope = null, id = null, key = null, repository = null } = {}) {
    const targetScope = scope || sessionScope(sessionId);
    const repo = repository || createGraphRepository();
    const loaded = await repo.loadGraph({ scopes: [targetScope] });

    const nodes = (loaded?.nodes || []).filter(n => n.type === 'Discussion');
    const discIds = new Set(nodes.map(n => n.id));
    const edges = (loaded?.edges || []).filter(e => discIds.has(e.from) || discIds.has(e.to));

    if (id || key) {
        const matchId = (id ? (id.startsWith('discussion:') ? id : `discussion:${id}`) : `discussion:${key}`).toLowerCase();
        const single = nodes.find(n => n.id.toLowerCase() === matchId);
        return {
            found: Boolean(single),
            discussion: single || null,
            nodes: single ? [single] : [],
            edges: single ? edges.filter(e => e.from === single.id || e.to === single.id) : []
        };
    }

    return { nodes, edges, count: nodes.length };
}

export async function editDiscussion({
    id, key, sessionId = 'default', scope = null, appendResponse = null, addSources = [],
    question = null, writeMarkdown = false, baseDir = null, repository = null, now = new Date().toISOString()
} = {}) {
    const targetScope = scope || sessionScope(sessionId);
    const repo = repository || createGraphRepository();
    const loaded = await loadDiscussions({ sessionId, scope: targetScope, id, key, repository: repo });
    if (!loaded.discussion) throw new Error(`Discussion not found: ${id || key}`);

    const current = loaded.discussion;
    const responses = Array.isArray(current.responses) ? [...current.responses] : [];
    if (appendResponse?.speaker && appendResponse?.text) {
        responses.push({ speaker: String(appendResponse.speaker), text: String(appendResponse.text) });
    }

    const updatedTitle = question || current.title || current.name;
    const mergedSources = [...(current.sources || []), ...(addSources || [])];
    const recordKey = current.id.replace(/^discussion:/, '');

    const saved = await saveDiscussion({
        key: recordKey, question: updatedTitle, responses, sources: mergedSources,
        sessionId, scope: targetScope, writeMarkdown, baseDir, repository: repo, now
    });
    return { ...saved, saved: true, updated: true };
}
