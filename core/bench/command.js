/**
 * `npm run bench`, `lens bench` and `bench:compare`: run, save, show and compare. Returns `{ ok, text }`; the
 * caller prints it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGit } from '../git/index.js';
import { runBench } from './runBench.js';
import { formatRun } from './report.js';
import { saveRun, readRun, listRuns, BASELINE_FILE } from './store.js';
import { compareRuns, formatComparison } from './compare.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The version of this lady-lens and, in a checkout, its short commit (`-dirty` with uncommitted work). */
export function lensIdentity() {
    const { version } = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
    const git = createGit({ root: PACKAGE_DIR });
    const sha = git.resolveCommit('HEAD');
    const commit = sha ? `${sha.slice(0, 7)}${git.worktreeChanges().length ? '-dirty' : ''}` : `v${version}`;
    return { lensVersion: version, commit };
}

/** The comparison with the baseline in `dir`, or null when there is none (or this run is the baseline). */
function againstBaseline(run, dir, baseline) {
    const baselineFile = path.join(dir, BASELINE_FILE);
    if (baseline || !fs.existsSync(baselineFile)) return null;
    return formatComparison(compareRuns(run, readRun(baselineFile)), { currentName: 'this run', previousName: BASELINE_FILE });
}

/**
 * @param {{root: string, outDir: string, repoKey: string, runs?: number, baseline?: boolean, processes?: boolean, json?: boolean, log?: Function}} options
 */
export async function benchCommand(options) {
    const { outDir, baseline, json } = options;
    const run = await runBench({ ...options, ...lensIdentity() });
    const { file } = saveRun(run, outDir, { baseline });
    if (json) return { ok: true, text: JSON.stringify(run, null, 2), file };
    const comparison = againstBaseline(run, outDir, baseline);
    const saved = `saved: ${file}${baseline ? ` (also as ${BASELINE_FILE})` : ''}`;
    return { ok: true, text: [formatRun(run), '', saved, ...(comparison ? ['', comparison] : [])].join('\n'), file };
}

/** What `current` is compared with: `against`, else the baseline, else the run before it. */
function previousRun(outDir, runs, against) {
    const baselineFile = path.join(outDir, BASELINE_FILE);
    return against || (fs.existsSync(baselineFile) ? baselineFile : runs.at(-2));
}

/** The newest run (or `current`) against `against` (default: the baseline). A regression makes `ok` false. */
export function compareCommand({ outDir, current, against }) {
    const runs = listRuns(outDir);
    const currentFile = current || runs.at(-1);
    const previousFile = previousRun(outDir, runs, against);
    if (!currentFile || !previousFile) return { ok: false, text: `nothing to compare in ${outDir}: run npm run bench twice, or save a baseline (npm run bench -- --baseline)` };
    const comparison = compareRuns(readRun(currentFile), readRun(previousFile));
    return { ok: comparison.regressions.length === 0, text: formatComparison(comparison, { currentName: path.basename(currentFile), previousName: path.basename(previousFile) }) };
}
