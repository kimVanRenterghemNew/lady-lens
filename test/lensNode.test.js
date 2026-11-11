/** lens node: the Node lens runs on, kept in ~/.lady-lens/lens.json so it holds at once (setx only reaches later terminals). */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chosenNode, lensNodeCommand, settingsFile } from '../core/update/index.js';

const homes = [];
const makeHome = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-node-')); homes.push(home); return home; };
afterEach(() => homes.splice(0).forEach(home => fs.rmSync(home, { recursive: true, force: true })));

const NODE = process.execPath; // an existing, working node
const fake = () => {
    const calls = [];
    return { calls, run: (command, args) => { calls.push([command, ...args].join(' ')); return 0; }, version: node => (node === NODE ? 'v24.0.0' : null) };
};

describe('lens node', () => {
    it('sets the Node in lens.json, stops lens and re-registers the agents; lens node shows it', () => {
        const home = makeHome();
        const daemonFile = path.join(home, 'daemon.json');
        fs.writeFileSync(daemonFile, '{}');
        const { calls, run, version } = fake();
        const out = lensNodeCommand(NODE, { home, daemonFile, run, version });
        expect(out).toMatchObject({ ok: true });
        expect(out.text).toContain(`lens now runs on ${NODE} (v24.0.0)`);
        expect(JSON.parse(fs.readFileSync(settingsFile(home), 'utf8'))).toEqual({ node: NODE });
        expect(calls).toEqual(['lens stop', 'lens install --refresh', 'lens mcp -d']);
        expect(chosenNode({ home, env: {} })).toBe(NODE);
        expect(lensNodeCommand(undefined, { home, daemonFile, run, version }).text).toBe(`lens runs on ${NODE} (v24.0.0)`);
    });

    it('refuses a path that is no working node, and changes nothing', () => {
        const home = makeHome();
        const { calls, run, version } = fake();
        const out = lensNodeCommand(path.join(home, 'nope.exe'), { home, daemonFile: path.join(home, 'daemon.json'), run, version });
        expect(out).toMatchObject({ ok: false });
        expect(fs.existsSync(settingsFile(home))).toBe(false);
        expect(calls).toEqual([]);
    });

    it('--clear goes back to the Node that starts lens; LENS_NODE wins over the file; a missing Node is ignored', () => {
        const home = makeHome();
        const { calls, run, version } = fake();
        lensNodeCommand(NODE, { home, daemonFile: path.join(home, 'daemon.json'), run, version });
        expect(chosenNode({ home, env: { LENS_NODE: path.join(home, 'gone.exe') } })).toBeNull();
        lensNodeCommand('--clear', { home, daemonFile: path.join(home, 'daemon.json'), run, version });
        expect(chosenNode({ home, env: {} })).toBeNull();
        expect(chosenNode({ home, env: { LENS_NODE: NODE } })).toBe(NODE);
        expect(calls).not.toContain('lens mcp -d'); // no daemon ran
        expect(lensNodeCommand(undefined, { home, daemonFile: path.join(home, 'daemon.json'), run, version }).text).toContain('Choose another');
    });
});
