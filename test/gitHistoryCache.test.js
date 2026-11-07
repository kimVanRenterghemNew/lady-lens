import { describe, it, expect } from 'vitest';
import { createGit } from '../core/git/index.js';

/** A `run` that answers rev-parse with the current HEAD and counts the `git log` calls. */
function stubRun(state) {
    return (root, args) => {
        if (args[0] === 'rev-parse') return `${state.head}\n`;
        if (args[0] === 'log') { state.logs += 1; return `@@\n${state.head}.js\n`; }
        throw new Error(`unexpected git ${args.join(' ')}`);
    };
}

describe('commitFiles cache', () => {
    it('asks git log once per HEAD, and again when HEAD moves', () => {
        const state = { head: 'aaa', logs: 0 };
        const root = `cache-test-${Math.random()}`;
        expect(createGit({ root, run: stubRun(state) }).commitFiles()).toEqual([['aaa.js']]);
        expect(createGit({ root, run: stubRun(state) }).commitFiles()).toEqual([['aaa.js']]);
        expect(state.logs).toBe(1);
        state.head = 'bbb';
        expect(createGit({ root, run: stubRun(state) }).commitFiles()).toEqual([['bbb.js']]);
        expect(state.logs).toBe(2);
    });

    it('does not cache without a HEAD', () => {
        const state = { head: '', logs: 0 };
        const root = `cache-test-${Math.random()}`;
        createGit({ root, run: stubRun(state) }).commitFiles();
        createGit({ root, run: stubRun(state) }).commitFiles();
        expect(state.logs).toBe(2);
    });
});
