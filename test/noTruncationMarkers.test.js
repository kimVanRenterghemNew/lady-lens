/**
 * text a MODEL sees is never cut with a "..." marker (models copied it into `edit.oldStr`).
 * Architecture test: no `.slice(...)`/`.substring(...)` followed by an appended "..." outside debug logging and user-facing output.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));
const CUT_THEN_DOTS = /\.(?:slice|substring|substr)\([^)]*\)[^\n]*\.\.\.['"`]/;
const HARMLESS = /\bdebug\(|\bout\.(?:log|warn|error|info)\(|console\.|\/\/|^\s*\*/;

describe('no "..." truncation markers in model-facing text', () => {
    it('core/ has none outside debug logs and user output', () => {
        const offenders = [];
        for (const file of walk(path.join(ROOT, 'core'))) {
            fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
                if (CUT_THEN_DOTS.test(line) && !HARMLESS.test(line)) offenders.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 140)}`);
            });
        }
        expect(offenders, `cut text with "..." (use a whole-line cut and a label like [cut: N chars]):\n${offenders.join('\n')}`).toEqual([]);
    });
});
