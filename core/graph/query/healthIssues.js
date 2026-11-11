/**
 * Issue rule table and summary calculation for code health.
 * Evaluates file health issues using pure predicate rules.
 */
export const LARGE_LINES = 400;
export const HIGH_FAN_IN = 40;
export const HIGH_FAN_OUT = 20;
export const LOW_COVERAGE = 50;

export const ISSUE_RULES = [
    {
        issue: 'untested',
        when: (entry, ctx) => !entry.tested && ctx.kind === 'source' && !ctx.isBarrel
    },
    {
        issue: 'untested-exports',
        when: (entry) => entry.untestedExports.length > 0
    },
    {
        issue: 'low-coverage',
        when: (entry) => entry.coverage !== undefined && entry.coverage < LOW_COVERAGE
    },
    {
        issue: 'live-failures',
        when: (entry) => Boolean(entry.live && Object.values(entry.live).some(count => count > 0))
    },
    {
        issue: 'cycle',
        when: (entry) => entry.inCycle
    },
    {
        issue: 'boundary',
        when: (entry) => entry.boundaryViolations.length > 0
    },
    {
        issue: 'large',
        when: (entry) => entry.lines > LARGE_LINES
    },
    {
        issue: 'high-fan-in',
        when: (entry, ctx) => !ctx.isBarrel && entry.fanIn >= HIGH_FAN_IN
    },
    {
        issue: 'high-fan-out',
        when: (entry, ctx) => !ctx.isBarrel && entry.fanOut >= HIGH_FAN_OUT
    }
];

export function evaluateIssues(entry, ctx) {
    return ISSUE_RULES.filter(rule => rule.when(entry, ctx)).map(rule => rule.issue);
}

export function buildHealthSummary(files, zoneOfPain, complexFunctions, designSmells) {
    return {
        files: files.length,
        untested: files.filter(entry => entry.issues.includes('untested')).length,
        inCycles: files.filter(entry => entry.inCycle).length,
        boundary: files.filter(entry => entry.boundaryViolations.length).length,
        large: files.filter(entry => entry.issues.includes('large')).length,
        zoneOfPain: zoneOfPain.length,
        complexFunctions: complexFunctions.length,
        designSmells: designSmells.length
    };
}

function recordPathCoverage(coverage, path, value) {
    const pct = value?.lines?.pct;
    if (path && Number.isFinite(pct)) coverage.set(path, pct);
}

/**
 * Pure: an istanbul `coverage-summary.json` (keys are absolute paths, plus `total`) -> repo-relative path -> % lines covered.
 * @param {Object} summary - the parsed file
 * @param {(absolute: string) => string|null} toRepoPath - null for a path outside the repository
 */
export function coverageFromSummary(summary, toRepoPath) {
    const coverage = new Map();
    const entries = Object.entries(summary || {});
    for (const [key, value] of entries) {
        if (key !== 'total') {
            recordPathCoverage(coverage, toRepoPath(key), value);
        }
    }
    return coverage;
}

const DEFAULT_HEALTH_OPTIONS = {
    file: undefined,
    module: undefined,
    only: undefined
};

export function normalizeHealthOptions(options) {
    const opts = Object.assign({}, DEFAULT_HEALTH_OPTIONS, options);
    return {
        readFile: opts.readFile || (() => null),
        churn: opts.churn || new Map(),
        coverage: opts.coverage || new Map(),
        signals: opts.signals || new Map(),
        file: opts.file,
        module: opts.module,
        only: opts.only
    };
}

export function assembleHealthEntry(meta, metrics, extras) {
    const entry = {
        ...meta,
        ...metrics,
        ...(extras.covered === undefined ? {} : { coverage: extras.covered }),
        ...(extras.live ? { live: extras.live } : {})
    };
    entry.issues = evaluateIssues(entry, { kind: meta.kind, isBarrel: extras.barrel });
    return entry;
}

export function topHotspots(files) {
    return files.filter(entry => entry.hotspot > 0)
        .sort((a, b) => b.hotspot - a.hotspot)
        .slice(0, 10)
        .map(({ path, churn: commits, lines, hotspot }) => ({ path, churn: commits, lines, hotspot }));
}

export function filterHealthFiles(files, file, module) {
    let result = files;
    if (file) result = result.filter(entry => entry.path === file);
    if (module) {
        const prefix = `${module.replace(/\/$/, '')}/`;
        result = result.filter(entry => entry.path.startsWith(prefix));
    }
    return result.sort((a, b) => b.issues.length - a.issues.length || b.hotspot - a.hotspot || a.path.localeCompare(b.path));
}

const dirOf = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

function resolveModuleDir(path, barrels) {
    for (let dir = dirOf(path); dir; dir = dirOf(dir)) {
        if (barrels.has(dir)) return dir;
    }
    return dirOf(path) || '.';
}

function applyRollupIssues(rollup, entry) {
    if (entry.issues.includes('untested')) rollup.untested++;
    if (entry.inCycle) rollup.cycles++;
    if (entry.boundaryViolations.length) rollup.boundary++;
}

export function rollupModules(files, barrels) {
    const modules = new Map();
    for (const entry of files) {
        const name = resolveModuleDir(entry.path, barrels);
        const rollup = modules.get(name) || { module: name, files: 0, lines: 0, untested: 0, cycles: 0, boundary: 0, churn: 0 };
        rollup.files++;
        rollup.lines += entry.lines;
        rollup.churn += entry.churn;
        applyRollupIssues(rollup, entry);
        modules.set(name, rollup);
    }
    return [...modules.values()].sort((a, b) => a.module.localeCompare(b.module));
}
