/**
 * Module architecture rules:
 *  1. A folder is a module. Its `index.js` is the deliberately chosen public API.
 *  2. Code outside a module only imports the module's `index.js`, never a file inside it.
 *  3. No dumping-ground folders (`tools`, `utils`, `helpers`, `common`, `shared`, `misc`, `lib`).
 *  4. No `class` (enforced by eslint): objects come from factories, errors are tagged.
 * Scope: runtime code (`core/`, `ui/`, `bin/`, `scripts/`). Tests may test internals (`*.internal.test.js`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleBypasses } from './helpers/moduleGraph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['core', 'ui', 'bin', 'scripts'];
const DUMP_FOLDER_NAMES = new Set(['tools', 'tool', 'utils', 'util', 'helpers', 'helper', 'common', 'shared', 'misc', 'lib']);
/**
 * Exists today, and is a deliberate public export (`lady-lens/tools` in package.json). May only shrink:
 * rename the folder, then remove the entry.
 */
const DUMP_FOLDER_EXCEPTIONS = Object.freeze([]);

function walk(dir, out = { files: [], dirs: [] }) {
    if (!fs.existsSync(path.join(ROOT, dir))) return out;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) { out.dirs.push(rel); walk(rel, out); }
        else if (/\.(m?js|cjs)$/.test(entry.name)) out.files.push(rel);
    }
    return out;
}

const tree = SCOPES.reduce((acc, scope) => walk(scope, acc), { files: [], dirs: [] });

/** Dumping-ground folders that are not on the exception list. */
const dumpFolders = (dirs, allowed = DUMP_FOLDER_EXCEPTIONS) =>
    dirs.filter(dir => DUMP_FOLDER_NAMES.has(path.posix.basename(dir))).filter(dir => !allowed.includes(dir));

describe('module architecture', () => {
    it('imports between modules go through index.js', () => {
        expect(moduleBypasses(tree.files)).toEqual([]);
    });

    it('every folder in core/ with code has an index.js', () => {
        const missing = tree.dirs.filter(dir => dir.startsWith('core/'))
            .filter(dir => fs.readdirSync(path.join(ROOT, dir)).some(name => /\.m?js$/.test(name)))
            .filter(dir => !fs.existsSync(path.join(ROOT, dir, 'index.js')));
        expect(missing).toEqual([]);
    });

    it('no dumping-ground folders (apart from the exceptions, which may only shrink)', () => {
        expect(dumpFolders(tree.dirs)).toEqual([]);
    });

    it('the exception list only holds folders that still exist', () => {
        expect(DUMP_FOLDER_EXCEPTIONS.filter(dir => !tree.dirs.includes(dir))).toEqual([]);
    });

    it('MUST reject: an import past an index.js, and a new dumping-ground folder', () => {
        const files = ['core/mcp/index.js'];
        const read = () => "import { decide } from '../graph/query/graphQuery.js';";
        const resolve = () => 'core/graph/query/graphQuery.js';
        expect(moduleBypasses(files, read, resolve)).toEqual(['core/mcp/index.js -> core/graph/query/graphQuery.js']);
        expect(moduleBypasses(files, () => "import { decide } from '../graph/index.js';", () => 'core/graph/index.js')).toEqual([]);
        expect(dumpFolders(['core/tools', 'core/utils', 'core/graph/helpers'])).toEqual(['core/tools', 'core/utils', 'core/graph/helpers']);
    });
});
