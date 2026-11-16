/**
 * Tests for Git hooks install and uninstall (backlog/snelheid-en-hooks.md AC5, AC7).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HOOK_NAMES, HOOK_START, HOOK_END, installHooks, uninstallHooks, hookInstallCommand } from '../core/git/index.js';

describe('git hooks management', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
        fs.mkdirSync(path.join(tempDir, '.git', 'hooks'), { recursive: true });
    });

    afterEach(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('installs non-blocking hooks without existing files', () => {
        const res = installHooks({ repo: tempDir });
        expect(res.ok).toBe(true);
        expect(res.results.every(r => r.status === 'installed')).toBe(true);

        for (const name of HOOK_NAMES) {
            const hookFile = path.join(tempDir, '.git', 'hooks', name);
            expect(fs.existsSync(hookFile)).toBe(true);
            const content = fs.readFileSync(hookFile, 'utf8');
            expect(content).toContain(HOOK_START);
            expect(content).toContain(HOOK_END);
            expect(content).toContain('LENS_HOOKS');
        }
    });

    it('preserves existing user hook content upon install and uninstall (AC7)', () => {
        const customScript = '#!/bin/sh\necho "my custom pre-existing check"';
        const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');
        fs.writeFileSync(postCommit, customScript);

        // Install hooks: appends block, keeps custom script
        const installRes = installHooks({ repo: tempDir });
        expect(installRes.ok).toBe(true);
        const installedContent = fs.readFileSync(postCommit, 'utf8');
        expect(installedContent).toContain('echo "my custom pre-existing check"');
        expect(installedContent).toContain(HOOK_START);

        // Uninstall hooks: removes only the lady-lens block
        const uninstallRes = uninstallHooks({ repo: tempDir });
        expect(uninstallRes.ok).toBe(true);
        const uninstalledContent = fs.readFileSync(postCommit, 'utf8');
        expect(uninstalledContent).not.toContain(HOOK_START);
        expect(uninstalledContent).toContain('echo "my custom pre-existing check"');
    });

    it('hookInstallCommand executes install and uninstall commands cleanly', () => {
        const installed = hookInstallCommand({ action: 'install', repo: tempDir });
        expect(installed.ok).toBe(true);
        const uninstalled = hookInstallCommand({ action: 'uninstall', repo: tempDir });
        expect(uninstalled.ok).toBe(true);
    });

    it('fails gracefully when repo has no .git folder', () => {
        const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'not-git-'));
        try {
            const res = installHooks({ repo: notGit });
            expect(res.ok).toBe(false);
            expect(res.text).toContain('No .git repository found');
            const unres = uninstallHooks({ repo: notGit });
            expect(unres.ok).toBe(false);
            expect(unres.text).toContain('No .git repository found');
        } finally {
            fs.rmSync(notGit, { recursive: true, force: true });
        }
    });

    it('supports dryRun, idempotency, updates to existing hook blocks, and worktrees', () => {
        // dryRun install
        const dryInstall = installHooks({ repo: tempDir, dryRun: true });
        expect(dryInstall.ok).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.git', 'hooks', 'post-commit'))).toBe(false);

        // Real install
        installHooks({ repo: tempDir });

        // Idempotent second install -> unchanged
        const secondInstall = installHooks({ repo: tempDir });
        expect(secondInstall.results.every(r => r.status === 'unchanged')).toBe(true);

        // Modify hook block to simulate old version
        const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');
        fs.writeFileSync(postCommit, `#!/bin/sh\n${HOOK_START}\n# old script\n${HOOK_END}\n`);
        const updateRes = installHooks({ repo: tempDir });
        expect(updateRes.results.find(r => r.name === 'post-commit').status).toBe('updated');

        // dryRun uninstall
        const dryUninstall = uninstallHooks({ repo: tempDir, dryRun: true });
        expect(dryUninstall.ok).toBe(true);

        // Uninstall when hooks are absent or not containing HOOK_START
        const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'other-git-'));
        fs.mkdirSync(path.join(otherRepo, '.git', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(otherRepo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho no hook start\n');
        try {
            const partialUninstall = uninstallHooks({ repo: otherRepo });
            expect(partialUninstall.results.find(r => r.name === 'post-commit').status).toBe('unchanged');
            expect(partialUninstall.results.find(r => r.name === 'post-merge').status).toBe('absent');
        } finally {
            fs.rmSync(otherRepo, { recursive: true, force: true });
        }

        // Worktree with .git file
        const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
        const realGitDir = path.join(tempDir, '.git', 'worktrees', 'wt1');
        fs.mkdirSync(path.join(realGitDir, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(worktreeDir, '.git'), `gitdir: ${realGitDir}\n`);
        try {
            const wtInstall = installHooks({ repo: worktreeDir });
            expect(wtInstall.ok).toBe(true);
            expect(fs.existsSync(path.join(realGitDir, 'hooks', 'post-commit'))).toBe(true);
        } finally {
            fs.rmSync(worktreeDir, { recursive: true, force: true });
        }
    });
});
