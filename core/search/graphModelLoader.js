// TODO(coverage): Current line coverage is 82.89% (< 85% target). Raise to >= 85%.
import fs from 'fs';
import path from 'path';
import { relativeToRepo, resolveInRepo, REPO_ROOT, lensEnv } from '../configuration/index.js';
import {
    createGraph,
    asksForDocuments,
    decisionNodes,
    createGraphRepository,
    PROJECT_SCOPE,
    sessionScope,
    createGraphSync,
    coverageFromSummary
} from '../graph/index.js';

export function readRepoFile(rel) {
    const abs = resolveInRepo(rel);
    try { return abs ? fs.readFileSync(abs, 'utf8') : null; } catch { return null; }
}

const COVERAGE_SUMMARIES = ['coverage/coverage-summary.json', 'outputs/coverage/coverage-summary.json'];
let coverageCache = null;

export function loadCoverage() {
    for (const candidate of [lensEnv('COVERAGE_SUMMARY'), ...COVERAGE_SUMMARIES].filter(Boolean)) {
        const abs = path.isAbsolute(candidate) ? candidate : path.join(REPO_ROOT, candidate);
        try {
            const stat = fs.statSync(abs);
            if (coverageCache && coverageCache.abs === abs && coverageCache.mtimeMs === stat.mtimeMs) {
                return coverageCache.result;
            }
            const coverage = coverageFromSummary(JSON.parse(fs.readFileSync(abs, 'utf8')), (file) => {
                const rel = relativeToRepo(file);
                return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
            });
            const result = { coverage, from: { file: relativeToRepo(abs), date: stat.mtime.toISOString().slice(0, 10) } };
            coverageCache = { abs, mtimeMs: stat.mtimeMs, result };
            return result;
        } catch { /* no summary here, or unreadable: try the next */ }
    }
    return { coverage: new Map(), from: null };
}

const GRAPH_MODEL_CACHE = new Map();
let lastFreshnessCheck = 0;
let lastFreshnessResult = null;
const FRESHNESS_DEBOUNCE_MS = Number(lensEnv('FRESHNESS_DEBOUNCE_MS')) || 60000;

export function invalidateGraphCache() {
    GRAPH_MODEL_CACHE.clear();
    lastFreshnessCheck = 0;
    lastFreshnessResult = null;
    coverageCache = null;
}

export async function loadGraphModel({ sessionId, text, includeProject, includeDocs, history = false }) {
    const repository = createGraphRepository();
    const dbPath = repository.databasePath();
    const scopes = [sessionScope(sessionId), ...(includeProject ? [PROJECT_SCOPE] : [])];
    const wantsDocs = includeDocs === true || asksForDocuments(String(text || ''));

    let dbMtime;
    try {
        dbMtime = fs.statSync(dbPath).mtimeMs;
    } catch {
        dbMtime = 0;
    }

    const cacheKey = `${dbPath}:${dbMtime}:${scopes.join(',')}:${wantsDocs}:${history}`;
    if (GRAPH_MODEL_CACHE.has(cacheKey)) {
        return GRAPH_MODEL_CACHE.get(cacheKey);
    }

    const loaded = await repository.loadGraph({ scopes, ...(wantsDocs ? {} : { exclude: { scope: PROJECT_SCOPE, types: ['Document'] } }) });
    const nodes = loaded.nodes.filter(node => wantsDocs || node.scope !== PROJECT_SCOPE || node.type !== 'Document');
    const kept = new Set(nodes.map(node => node.id));

    const graph = createGraph(sessionId);
    for (const { id, type, ...data } of nodes) graph.addNode(id, type, data);
    for (const doc of nodes.filter(node => node.type === 'Document' && node.decisions)) {
        const { nodes: decisions, edges } = decisionNodes(doc, { history });
        for (const { id, type, ...data } of decisions) graph.addNode(id, type, data);
        for (const edge of edges) graph.addEdge(edge.from, edge.to, edge.type, { weight: 1 });
    }
    for (const edge of loaded.edges) {
        if (!kept.has(edge.from) || !kept.has(edge.to)) continue;
        graph.addEdge(edge.from, edge.to, edge.type, {
            weight: edge.weight ?? 1, strength: edge.weight, confidence: edge.confidence, createdAt: edge.createdAt, updatedAt: edge.updatedAt
        });
    }
    const counts = (scope) => nodes.filter(node => node.scope === scope).length;
    const model = {
        graph,
        missing: !loaded.exists || graph.nodes.size === 0,
        source: relativeToRepo(repository.databasePath()),
        scopes: { session: counts(sessionScope(sessionId)), project: includeProject ? counts(PROJECT_SCOPE) : null }
    };
    GRAPH_MODEL_CACHE.set(cacheKey, model);
    return model;
}

export function freshnessFor(graph, now = Date.now()) {
    let excludedStaleCount = 0;
    let unknownTimestampCount = 0;
    for (const node of graph.nodes.values()) {
        if (node.timestampStatus === 'unknown') { unknownTimestampCount += 1; continue; }
        const age = node.updatedAt ?? node.createdAt ?? node.timestamp;
        if (Number.isFinite(Number(age)) && Number(age) < now - 365 * 24 * 60 * 60 * 1000) {
            excludedStaleCount += 1;
        }
    }
    return { asOf: new Date(now).toISOString(), excludedStaleCount, unknownTimestampCount };
}

export async function refreshProjectGraph({ force = false } = {}) {
    const now = Date.now();
    if (!force && lastFreshnessResult && (now - lastFreshnessCheck) < FRESHNESS_DEBOUNCE_MS) {
        return lastFreshnessResult;
    }
    const repository = createGraphRepository();
    const dbPath = repository.databasePath();
    try {
        const stats = fs.statSync(dbPath);
        if (!force && (now - stats.mtimeMs) < FRESHNESS_DEBOUNCE_MS) {
            lastFreshnessCheck = now;
            lastFreshnessResult = { checked: true, synced: false };
            return lastFreshnessResult;
        }
    } catch {
        // no db yet
    }
    try {
        const sync = createGraphSync();
        const status = await sync.status();
        lastFreshnessCheck = Date.now();
        if (!status.stale) {
            lastFreshnessResult = { checked: true, synced: false };
            return lastFreshnessResult;
        }
        await sync.sync();
        invalidateGraphCache();
        lastFreshnessResult = { checked: true, synced: true };
        return lastFreshnessResult;
    } catch (error) {
        lastFreshnessCheck = Date.now();
        return { checked: false, synced: false, error: error.message };
    }
}
