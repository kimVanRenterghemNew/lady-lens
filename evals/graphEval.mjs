#!/usr/bin/env node
/**
 * The graph eval of lady-lens: the frozen fixture, freshness, and lady-lens itself against evals/graph-gold.json.
 *   npm run eval:graph            report, exit 1 on FAIL
 *   npm run eval:graph -- --json  machine readable
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runGraphEval, formatGraphEval } from '../core/eval/index.js';
import { loadProjectSettings } from '../core/repository/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'graph-gold.json'), 'utf8'));

export async function runLensEval() {
    const settings = await loadProjectSettings(path.join(ROOT, '.lady-lens.yaml'));
    return runGraphEval({ repo: { root: ROOT, queries: GOLD.queries, settings }, thresholds: GOLD.thresholds });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const report = await runLensEval();
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatGraphEval(report));
    process.exit(report.pass ? 0 : 1);
}
