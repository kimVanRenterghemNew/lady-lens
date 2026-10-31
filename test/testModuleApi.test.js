/**
 * Tests import a module through its index.js.
 * A test that deliberately tests internals is named `*.internal.test.js`. So an internal refactor only breaks
 * the tests that chose to depend on internals.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = ['core/', 'ui/', 'bin/', 'scripts/'];

function testFiles(dir = 'test', out = []) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) testFiles(rel, out);
        else if (/\.test\.m?js$/.test(entry.name) && !/\.internal\.test\.m?js$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('tests use the public module API', () => {
    it('no test (other than *.internal.test.js) imports a runtime file past its index.js', () => {
        const intoRuntime = moduleBypasses(testFiles()).filter(edge => RUNTIME.some(prefix => edge.split(' -> ')[1].startsWith(prefix)));
        expect(intoRuntime).toEqual([]);
    });
});
