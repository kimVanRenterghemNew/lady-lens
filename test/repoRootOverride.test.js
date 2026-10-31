/**
 * the repository the graph is about. LENS_REPO_ROOT when set; stand-alone, this checkout; installed as a
 * dependency (inside node_modules), the working directory of the process, so a run in a sandbox copy sees the sandbox.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const rootOf = (file, { env = {}, cwd = process.cwd() } = {}) => execFileSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(path.resolve(file)).href)}).then(m => console.log(m.REPO_ROOT))`], { encoding: 'utf8', cwd, env: { ...process.env, ...env } }).trim();

const installed = path.resolve('node_modules', 'lens-root-probe');
afterAll(() => fs.rmSync(installed, { recursive: true, force: true }));

describe('REPO_ROOT', () => {
    it('follows LENS_REPO_ROOT, and is this checkout without it', () => {
        expect(rootOf('core/configuration/paths.js', { env: { LENS_REPO_ROOT: os.tmpdir() } })).toBe(path.resolve(os.tmpdir()));
        expect(rootOf('core/configuration/paths.js', { env: { LENS_REPO_ROOT: '' } })).toBe(path.resolve('.'));
    });

    it('MUST be the working directory when installed inside node_modules, not the package folder', () => {
        fs.mkdirSync(path.join(installed, 'core', 'configuration'), { recursive: true });
        fs.copyFileSync('core/configuration/paths.js', path.join(installed, 'core', 'configuration', 'paths.js'));
        const cwd = fs.realpathSync(os.tmpdir());
        expect(rootOf(path.join(installed, 'core', 'configuration', 'paths.js'), { env: { LENS_REPO_ROOT: '' }, cwd })).toBe(cwd);
    });
});

describe('configureLensRoot', () => {
    it('MUST move every root-relative answer to the host root (a host running a copy of itself in a sandbox)', async () => {
        const { configureLensRoot } = await import('../core/configuration/index.js');
        const { grep } = await import('../core/search/index.js');
        const host = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-host-'));
        fs.writeFileSync(path.join(host, 'marker.js'), 'export const ONLY_IN_HOST = 1;\n');
        try {
            configureLensRoot(host);
            expect(grep({ pattern: 'ONLY_IN_HOST' }).matches.map(m => m.file)).toEqual(['marker.js']);
        } finally {
            configureLensRoot(process.cwd());
            fs.rmSync(host, { recursive: true, force: true });
        }
    });
});
