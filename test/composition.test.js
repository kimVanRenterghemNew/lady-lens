/**
 * Ports and adapters:
 *  1. An adapter lives in its own folder under the module that owns the port: `core/<module>/adapters/<impl>/index.js`.
 *  2. Only the owning module (`core/<module>/`) imports its adapters. Hosts and other modules get them through that
 *     module's `index.js` (as `createLadybugRepositoryStore`) or receive the port as a parameter.
 *  3. Every module that has adapters has a contract test `test/ports/<module>*.contract.test.js` that runs the same
 *     requirements over every adapter.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses, resolveImport, strip, IMPORT } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['core', 'ui', 'bin', 'scripts'];

function walk(dir, out = []) {
    if (!fs.existsSync(path.join(ROOT, dir))) return out;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel, out);
        else if (/\.m?js$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/** `core/graph/adapters/ladybug/index.js` -> { module: 'graph', impl: 'ladybug' }; anything else -> null. */
export const adapterOf = (rel) => {
    const match = rel.match(/^core\/([^/]+)\/adapters\/([^/]+)\//);
    return match ? { module: match[1], impl: match[2] } : null;
};

/** Imports of an adapter folder from outside its owning module. */
export function adapterChoosers(files, read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'), resolve = resolveImport) {
    const found = [];
    for (const rel of files) {
        for (const match of strip(read(rel)).matchAll(IMPORT)) {
            const target = resolve(rel, match[1] || match[2] || match[3]);
            const adapter = target && adapterOf(target);
            if (!adapter) continue;
            if (rel.startsWith(`core/${adapter.module}/`)) continue; // the owning module may use its own adapters
            found.push(`${rel} -> ${target}`);
        }
    }
    return found.sort();
}

export function modulesWithAdapters(files) {
    return [...new Set(files.map(adapterOf).filter(Boolean).map(a => a.module))].sort();
}

/** Modules with adapters that have no `test/ports/<module>*.contract.test.js`. */
export function modulesWithoutContract(modules, contractFiles) {
    return modules.filter(m => !contractFiles.some(f => f.startsWith(m) && f.endsWith('.contract.test.js')));
}

const runtimeFiles = SCOPES.flatMap(scope => walk(scope));
const contractFiles = fs.existsSync(path.join(ROOT, 'test', 'ports')) ? fs.readdirSync(path.join(ROOT, 'test', 'ports')) : [];

describe('ports and adapters', () => {
    it("only a module itself imports its adapters' folders", () => {
        expect(adapterChoosers(runtimeFiles)).toEqual([]);
    });

    it('every module with adapters has a port contract test', () => {
        expect(modulesWithoutContract(modulesWithAdapters(runtimeFiles), contractFiles)).toEqual([]);
    });

    it('the checks reject what they are there to catch (the checks themselves)', () => {
        const read = () => "import { createLadybugRepositoryStore } from '../graph/adapters/ladybug/index.js';";
        const resolve = () => 'core/graph/adapters/ladybug/index.js';
        expect(adapterChoosers(['core/mcp/server.js'], read, resolve)).toEqual(['core/mcp/server.js -> core/graph/adapters/ladybug/index.js']);
        expect(adapterChoosers(['core/graph/sync/graphSync.js'], read, resolve)).toEqual([]);
        expect(modulesWithAdapters(['core/graph/adapters/ladybug/index.js', 'core/graph/adapters/memory/index.js', 'core/mcp/index.js'])).toEqual(['graph']);
        expect(modulesWithoutContract(['graph', 'mcp'], ['graphStore.contract.test.js'])).toEqual(['mcp']);
        expect(moduleBypasses(['core/mcp/server.js'], read, resolve)).toEqual(['core/mcp/server.js -> core/graph/adapters/ladybug/index.js']);
    });
});
