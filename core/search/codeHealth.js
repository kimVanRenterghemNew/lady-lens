import { debug } from '../observability/index.js';
import { REPO_ROOT } from '../configuration/index.js';
import { codeHealth, healthSignals, commitFiles } from '../graph/index.js';
import { refreshProjectGraph, loadGraphModel, readRepoFile, loadCoverage } from './graphModelLoader.js';

let churnCache = { root: null, time: 0, churn: new Map() };
const CHURN_TTL_MS = 60000;

export function invalidateChurnCache() {
    churnCache = { root: null, time: 0, churn: new Map() };
}

export function getRepoChurn(root, history = commitFiles) {
    const now = Date.now();
    if (churnCache.root === root && (now - churnCache.time) < CHURN_TTL_MS) {
        return churnCache.churn;
    }
    const churn = new Map();
    try {
        for (const files of history(root)) {
            for (const path of new Set(files)) {
                churn.set(path, (churn.get(path) || 0) + 1);
            }
        }
    } catch {
        // git failed or not available
    }
    churnCache = { root, time: now, churn };
    return churn;
}

export async function healthTool(args = {}, { refresh = refreshProjectGraph, history = commitFiles } = {}) {
    const { file, module, limit = 20 } = args ?? {};
    const freshness = await refresh();
    let loaded;
    try {
        loaded = await loadGraphModel({ sessionId: 'default', text: '', includeProject: true, includeDocs: false });
    } catch (error) {
        return { error: `could not load graph: ${error.message}` };
    }
    const churn = getRepoChurn(REPO_ROOT, history);
    const { coverage, from: coverageFrom } = loadCoverage();
    const signals = await healthSignals({ root: REPO_ROOT, log: (message) => debug(1, 'graph:health', message) });
    const report = codeHealth(loaded.graph, { readFile: readRepoFile, churn, coverage, signals, file: typeof file === 'string' ? file.trim() : undefined, module: typeof module === 'string' ? module.trim() : undefined });
    if (file && !report.files.length) return { error: `${file} is not a code file in the project graph. Check the path with glob.`, freshness };
    const max = Math.max(1, Math.min(Number(limit) || 20, 200));
    const modules = module || file ? [] : report.modules.filter(item => item.untested || item.cycles || item.boundary).sort((a, b) => b.untested - a.untested).slice(0, max);
    const files = report.files.slice(0, max).map(({ tests, ...entry }) => ({ ...entry, tests: tests.length }));
    return {
        relation: 'health',
        summary: report.summary,
        coverageFrom,
        files,
        modules,
        cycles: report.cycles,
        hotspots: report.hotspots,
        topCentralNodes: report.topCentralNodes || [],
        zoneOfPain: report.zoneOfPain || [],
        complexFunctions: (report.complexFunctions || []).slice(0, max),
        truncated: report.files.length > max,
        source: loaded.source,
        freshness
    };
}
