/**
 * Git is only started by core/git (`run`), so everything else can be tested with `createFakeGit`.
 * Scope: runtime code (`core/`, `ui/`, `bin/`, `scripts/`); tests may start git to build a repository.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['core', 'ui', 'bin', 'scripts'];
const GIT_PROCESS = /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\(\s*['"`]git(?:\.exe)?(?:['"`\s])/;

function sourceFiles(dir) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(rel);
        return /\.(m?js|cjs)$/.test(entry.name) ? [rel] : [];
    });
}

const startsGit = (files, read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')) =>
    files.filter(file => !file.startsWith('core/git/')).filter(file => GIT_PROCESS.test(read(file)));

describe('git access', () => {
    it('only core/git starts the git binary', () => {
        expect(startsGit(SCOPES.flatMap(sourceFiles))).toEqual([]);
    });

    it('MUST reject: a git process outside core/git, in every call style', () => {
        const sources = { 'core/a.js': "execFileSync('git', ['log'])", 'core/b.js': 'execSync(`git log`)', 'bin/c.mjs': "spawn('git', args)", 'core/git/ok.js': "execFileSync('git', [])", 'core/d.js': "execFileSync('node', ['git'])" };
        expect(startsGit(Object.keys(sources), file => sources[file])).toEqual(['core/a.js', 'core/b.js', 'bin/c.mjs']);
    });
});
