/**
 * Non-blocking Git hooks installer and manager (backlog/snelheid-en-hooks.md AC5, AC6, AC7).
 * Hooks run after events (post-commit, post-checkout, post-merge, post-rewrite),
 * never block commits, and trigger a bundled background sync on the daemon.
 * @module core/git/hooks
 */
import fs from 'fs';
import path from 'path';

export const HOOK_NAMES = Object.freeze([
    'post-commit',
    'post-checkout',
    'post-merge',
    'post-rewrite'
]);

export const HOOK_START = '# lady-lens hook: start';
export const HOOK_END = '# lady-lens hook: end';

export const HOOK_SCRIPT = `${HOOK_START}
if [ "\${LENS_HOOKS:-1}" != "0" ]; then
  (curl -s --connect-timeout 5 -m 30 -X POST "http://127.0.0.1:4318/sync?repo=$(pwd)" >/dev/null 2>&1; [ $? -ne 7 ] || nohup lens sync >/dev/null 2>&1) >/dev/null 2>&1 </dev/null &
fi
${HOOK_END}`;

function gitHooksDir(repo) {
    const gitDir = path.join(repo, '.git');
    if (!fs.existsSync(gitDir)) return null;
    const stat = fs.statSync(gitDir);
    if (stat.isFile()) {
        const content = fs.readFileSync(gitDir, 'utf8');
        const match = /^gitdir:\s*(.+)$/m.exec(content);
        if (match) return path.resolve(repo, match[1].trim(), 'hooks');
    }
    return path.join(gitDir, 'hooks');
}

function updateHookContent(existing, hookScript) {
    if (!existing.includes(HOOK_START)) {
        const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
        return `${prefix}\n${hookScript}\n`;
    }
    const before = existing.slice(0, existing.indexOf(HOOK_START));
    const after = existing.slice(existing.indexOf(HOOK_END) + HOOK_END.length);
    return `${before}${hookScript}${after}`;
}

function removeHookContent(existing) {
    const before = existing.slice(0, existing.indexOf(HOOK_START));
    const after = existing.slice(existing.indexOf(HOOK_END) + HOOK_END.length);
    return `${before}${after}`.replace(/^\s*\n+/, '').trimEnd() + '\n';
}

function installSingleHook(dir, name, dryRun) {
    const filePath = path.join(dir, name);
    const exists = fs.existsSync(filePath);
    const current = exists ? fs.readFileSync(filePath, 'utf8') : '#!/bin/sh\n';
    const next = updateHookContent(current, HOOK_SCRIPT);
    if (current === next) return { name, status: 'unchanged' };
    if (!dryRun) fs.writeFileSync(filePath, next, { mode: 0o755 });
    return { name, status: exists ? 'updated' : 'installed' };
}

function ensureHooksDir(dir, dryRun) {
    if (!dryRun) fs.mkdirSync(dir, { recursive: true });
}

export function installHooks(options = {}) {
    const repo = options.repo || process.cwd();
    const dir = gitHooksDir(repo);
    if (!dir) return { ok: false, text: `No .git repository found in ${repo}` };
    ensureHooksDir(dir, Boolean(options.dryRun));
    const results = HOOK_NAMES.map(name => installSingleHook(dir, name, Boolean(options.dryRun)));
    return { ok: true, results, text: results.map(r => `${r.status.padEnd(10)} ${r.name}`).join('\n') };
}

function writeUninstalledHook(filePath, content) {
    const isBare = content.trim() === '' || content.trim() === '#!/bin/sh';
    if (isBare) {
        fs.rmSync(filePath, { force: true });
    } else {
        fs.writeFileSync(filePath, content, { mode: 0o755 });
    }
}

function uninstallSingleHook(dir, name, dryRun) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) return { name, status: 'absent' };
    const current = fs.readFileSync(filePath, 'utf8');
    if (!current.includes(HOOK_START)) return { name, status: 'unchanged' };
    const next = removeHookContent(current);
    if (!dryRun) writeUninstalledHook(filePath, next);
    return { name, status: 'removed' };
}

export function uninstallHooks(options = {}) {
    const repo = options.repo || process.cwd();
    const dir = gitHooksDir(repo);
    if (!dir) return { ok: false, text: `No .git repository found in ${repo}` };
    const results = HOOK_NAMES.map(name => uninstallSingleHook(dir, name, Boolean(options.dryRun)));
    return { ok: true, results, text: results.map(r => `${r.status.padEnd(10)} ${r.name}`).join('\n') };
}

export function hookInstallCommand(options = {}) {
    return options.action === 'uninstall' ? uninstallHooks(options) : installHooks(options);
}
