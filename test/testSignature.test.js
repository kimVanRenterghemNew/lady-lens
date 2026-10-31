import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(path.join(dir, entry.name))) : [path.join(dir, entry.name)]);

describe('Vitest 4+ signature', () => {
    it('no test passes options as the THIRD argument (`}, { timeout: N })`): removed in Vitest 4, breaks the whole file at collection', () => {
        const offenders = walk('test').filter(file => /\.test\.m?js$/.test(file) && file !== path.join('test', 'testSignature.test.js'))
            .filter(file => /^\s*\},\s*\{\s*(timeout|retry|repeats|concurrent|skip|only)\b[^}]*\}\s*\)/m.test(fs.readFileSync(file, 'utf8')));
        expect(offenders).toEqual([]);
    });
});
