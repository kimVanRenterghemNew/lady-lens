/**
 * The graph scan skips what .gitignore leaves out. A Mendix project, 2026-11-04: lens indexed the Mendix build
 * output deployment/ (1940 files, 50 MB generated JavaScript) and .mendix-cache/; the sync ran 55 s and then Ladybug's
 * buffer pool was full. 2026-11-13: in a folder git refuses ("dubious ownership") nothing was ignored any more, and the
 * sync parsed deployment/ again (65,858 functions, 82 s): without git's answer lens reads .gitignore itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { scanGraphFiles, gitignoredPaths } from '../core/repository/index.js';

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
    it('without git the .gitignore files still apply', async () => {
        expect(await scan()).toEqual(['src/a.js']);
    });

    it('in a git repository ignored folders and files are skipped', async () => {
        execFileSync('git', ['init', '-q'], { cwd: root });
        expect(await scan()).toEqual(['src/a.js']);
    });

    it('in a repository git refuses (another Windows user owns it) the .gitignore files still apply', async () => {
        process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
        try {
            expect(await scan()).toEqual(['src/a.js']);
        } finally { delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER; }
    });

    it('a given ignore list is used as it is', async () => {
        expect(await scan({ ignored: ['src/b.gen.js'] })).toEqual(['.mendix-cache/m/x.js', 'deployment/web/bundle.js', 'src/a.js']);
    });
});

describe('.gitignore read without git', () => {
    it('reads like git: anchored, any depth, folders only, **, a nested .gitignore and ! to bring a path back', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-gitignore-rules-'));
        const files = {
            '.gitignore': '# comment\n/build\n*.log\n!keep.log\ntemp/\n**/cache/**\n',
            'build/a.js': '', 'src/build/b.js': '', 'run.log': '', 'keep.log': '', 'src/temp/c.js': '', 'temp': '',
            'web/cache/d.js': '', 'web/.gitignore': 'gen/\n', 'web/gen/e.js': '', 'gen/f.js': '', 'src/ok.js': ''
        };
        try {
            for (const [file, text] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
                fs.writeFileSync(path.join(dir, file), text);
            }
            expect(gitignoredPaths(dir)).toEqual(['build/', 'run.log', 'src/temp/', 'web/cache/d.js', 'web/gen/']);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
