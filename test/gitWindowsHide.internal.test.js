/**
 * MCP smoke test (2026-11-11): the daemon runs detached, without a console. On Windows every git call without windowsHide
 * then opened a console and took ~1 s (75 ms with it): branch_impact took 85 s in the daemon and 8 s on the command line.
 */
import { describe, it, expect, vi } from 'vitest';

const execFileSync = vi.fn(() => 'main\n');
vi.mock('child_process', async (original) => ({ ...(await original()), execFileSync }));

const { createGit } = await import('../core/git/index.js');

describe('the git port starts git without a console window', () => {
    it('passes windowsHide on every git call', () => {
        createGit({ root: process.cwd() }).currentBranch();
        expect(execFileSync).toHaveBeenCalledWith('git', expect.any(Array), expect.objectContaining({ windowsHide: true }));
    });
});
