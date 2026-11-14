#!/usr/bin/env node
/**
 * The performance gate, apart from the rest of the suite: `npm run check` runs every test file in parallel workers under
 * coverage, and a time measured there swung 5x from run to run (load graph cold: 288 ms in one run, 1494 ms in the next).
 * Here the performance tests run alone, without coverage, one file after the other.
 *
 *   node scripts/perf.mjs              the gate (npm run test:perf, part of npm run check)
 *   node scripts/perf.mjs --ratchet    make the budgets in test/perf-budgets.json stricter (npm run bench:ratchet)
 *   node scripts/perf.mjs --ratchet --reset   measure them again from scratch (only after the way of measuring changed)
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const ratchet = process.argv.includes('--ratchet');
if (ratchet && process.argv.includes('--reset')) fs.writeFileSync(path.join(ROOT, 'test', 'perf-budgets.json'), '{}\n');
const files = ['test/performance.test.js', 'test/performance.branch.test.js'];
const env = { ...process.env, PERF_TESTS: '1', ...(ratchet ? { PERF_RATCHET: '1' } : {}) };
const result = spawnSync(process.execPath, [vitest, 'run', '--no-file-parallelism', ...files], { cwd: ROOT, stdio: 'inherit', env });
process.exit(result.status ?? 1);
