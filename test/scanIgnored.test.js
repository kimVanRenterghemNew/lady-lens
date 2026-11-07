/**
 * The graph scan skips what .gitignore leaves out. Puratos/ProductionTerminal 2026-11-04: lens indexed the Mendix build
 * output deployment/ (1940 files, 50 MB generated JavaScript) and .mendix-cache/; the sync ran 55 s and then Ladybug's
 * buffer pool was full.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { scanGraphFiles } from '../core/repository/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git'], graph_extensions: ['.js'] } };
let root;
const scan = async options => (await scanGraphFiles({ rootDir: root, settings: SETTINGS, ...options })).map(file => path.relative(root, file).split(path.sep).join('/')).sort();

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-scan-ignored-'));
    for (const [file, text] of Object.entries({ '.gitignore': '/deployment/\n.mendix-cache/\n*.gen.js\n', 'src/a.js': 'a', 'src/b.gen.js': 'b', 'deployment/web/bundle.js': 'c', '.mendix-cache/m/x.js': 'd' })) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('graph scan and .gitignore', () => {
    it('without git every file is scanned', async () => {
        expect(await scan()).toEqual(['.mendix-cache/m/x.js', 'deployment/web/bundle.js', 'src/a.js', 'src/b.gen.js']);
    });

    it('in a git repository ignored folders and files are skipped', async () => {
        execFileSync('git', ['init', '-q'], { cwd: root });
        expect(await scan()).toEqual(['src/a.js']);
    });

    it('a given ignore list is used as it is', async () => {
        expect(await scan({ ignored: ['src/b.gen.js'] })).toEqual(['.mendix-cache/m/x.js', 'deployment/web/bundle.js', 'src/a.js']);
    });
});
