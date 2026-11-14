/**
 * Bench runs on disk: one JSON file per run (`<date>-<short commit>.json`) and an optional `baseline.json`.
 */
import fs from 'fs';
import path from 'path';

export const BASELINE_FILE = 'baseline.json';

const stamp = date => date.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');

/** Writes the run, and also as the baseline when asked. Returns the paths written. */
export function saveRun(run, dir, { baseline = false } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp(new Date(run.createdAt))}-${run.commit}.json`);
    const text = `${JSON.stringify(run, null, 2)}\n`;
    fs.writeFileSync(file, text);
    if (!baseline) return { file };
    const baselineFile = path.join(dir, BASELINE_FILE);
    fs.writeFileSync(baselineFile, text);
    return { file, baselineFile };
}

export function readRun(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The runs in `dir`, oldest first (the baseline not included). */
export function listRuns(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => name.endsWith('.json') && name !== BASELINE_FILE).sort().map(name => path.join(dir, name));
}
