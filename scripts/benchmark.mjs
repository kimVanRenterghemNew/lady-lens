#!/usr/bin/env node
/**
 * Bench runs for lady-lens: every measurement N times after a warm-up (median and spread), the phases of the sync,
 * saved under outputs/bench and compared with the baseline there.
 *
 *   npm run bench                                 lady-lens itself
 *   npm run bench -- --baseline                   ... and save it as outputs/bench/baseline.json
 *   npm run bench -- --scale many-imports [--count N] [--seed S]   a generated repository (core/bench/scaleRepo.js)
 *   npm run bench -- --repo <dir>                 another repository (or: lens bench --repo <dir>)
 *   npm run bench -- --runs 3 --no-processes --json
 *   npm run bench:compare [-- --against <file>] [--scale <profile>]   newest run against the baseline
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { benchCommand, compareCommand, generateScaleRepo, SCALE_PROFILES } from '../core/bench/index.js';
import { idOfRepo } from '../core/repository/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = name => argv.includes(name);

/** What is measured, with the key that tells its runs apart and the folder they are saved in. */
function scaleTarget(profile) {
    if (!SCALE_PROFILES[profile]) throw new Error(`unknown --scale "${profile}": ${Object.keys(SCALE_PROFILES).join(', ')}`);
    const count = Number(value('--count')) || SCALE_PROFILES[profile].count;
    const seed = Number(value('--seed')) || 1;
    return { key: `scale:${profile}:${count}:${seed}`, dir: `scale-${profile}-${count}-${seed}`, scale: { profile, count, seed } };
}

function benchTarget() {
    if (value('--scale')) return scaleTarget(value('--scale'));
    const repo = value('--repo') && path.resolve(value('--repo'));
    return repo ? { key: `repo:${idOfRepo(repo)}`, dir: `repo-${idOfRepo(repo)}`, root: repo } : { key: 'lady-lens', dir: '', root: ROOT };
}

/** The generated repository of a scale target, in a temporary folder that `cleanup` removes. */
function prepareRoot(target) {
    if (!target.scale) return { root: target.root, cleanup: () => {} };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lens-bench-${target.scale.profile}-`));
    generateScaleRepo({ dir, ...target.scale });
    return { root: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function main() {
    const target = benchTarget();
    const outDir = path.join(ROOT, 'outputs', 'bench', target.dir);
    if (argv[0] === 'compare') return compareCommand({ outDir, against: value('--against') && path.resolve(value('--against')) });
    const { root, cleanup } = prepareRoot(target);
    try {
        return await benchCommand({
            root, outDir, repoKey: target.key, runs: Number(value('--runs')) || 5,
            baseline: has('--baseline'), processes: !has('--no-processes'), json: has('--json'),
            log: label => process.stderr.write(`  ${label}\n`)
        });
    } finally {
        cleanup();
    }
}

main().then(out => { console.log(out.text); process.exit(out.ok ? 0 : 1); }).catch(error => { console.error(`bench failed: ${error.stack || error}`); process.exit(1); });
