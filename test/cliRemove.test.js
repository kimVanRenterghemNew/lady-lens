import os from 'os';
/**
 * `lens remove <id|dir>` names the repository it removed (it printed "Removed undefined undefined"), and says so when
 * none matches. Runs the CLI against the worker's own lens home, never the developer's registry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const run = (...args) => execFileSync(process.execPath, ['bin/lens.mjs', ...args], { encoding: 'utf8', env: process.env });

describe('lens remove', () => {
    it('prints the id and path it removed, and "not found" for an unknown one', () => {
        const home = process.env.LENS_HOME;
        fs.mkdirSync(home, { recursive: true });
        const entry = { id: 'abc123', path: path.join(home, 'some-repo'), database: path.join(home, 'repos', 'abc123', 'graph.lbdb') };
        fs.writeFileSync(path.join(home, 'repos.json'), JSON.stringify({ repos: { abc123: entry } }));
        expect(run('remove', 'abc123').trim()).toBe(`Removed abc123 ${entry.path}`);
        expect(run('remove', 'abc123').trim()).toBe('Repository not found: abc123');
    });
});

describe('lens --repo', () => {
    // 2026-11-11: bin imported core before it set LENS_REPO_ROOT, so `lens sync --repo X` from another folder scanned the
    // wrong folder into the database of X (it replaced Kura's graph with the files of lady-lens)
    it('scans the folder given with --repo, not the working directory or the lens checkout', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cli-repo-'));
        try {
            fs.mkdirSync(path.join(tmp, 'repo', 'src'), { recursive: true });
            fs.mkdirSync(path.join(tmp, 'elsewhere'));
            fs.writeFileSync(path.join(tmp, 'repo', 'src', 'only.js'), 'export function onlyInThisRepo() { return 1; }\n');
            const lens = (...args) => execFileSync(process.execPath, [path.resolve('bin/lens.mjs'), ...args, '--repo', path.join(tmp, 'repo')], { encoding: 'utf8', cwd: path.join(tmp, 'elsewhere'), env: { ...process.env, LENS_GRAPH_DB: '' } });
            expect(JSON.parse(lens('sync')).nodes).toBe(1);
            expect(JSON.parse(lens('ask', 'definedIn', '{"symbol":"onlyInThisRepo"}')).locations.map(location => location.path)).toEqual(['src/only.js']);
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
});

describe('lens status', () => {
    // Kura (2026-11-11): `lens status` was in the help but printed the usage text
    it('shows the daemon status like lens ps, not the usage text', () => {
        fs.mkdirSync(process.env.LENS_HOME, { recursive: true });
        fs.rmSync(path.join(process.env.LENS_HOME, 'daemon.json'), { force: true });
        expect(run('status').trim()).toBe('No lady-lens processes tracked');
        expect(run('status').trim()).toBe(run('ps').trim());
    });
});
