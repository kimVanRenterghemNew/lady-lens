/**
 * Journey tests for non-blocking Git hooks (backlog/snelheid-en-hooks.md AC5, J1, J2, J3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { installHooks, HOOK_NAMES } from '../core/git/index.js';
import { askDaemon } from '../core/daemonCall/index.js';

describe('git hooks journey tests (AC5, J1, J2, J3)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-journey-'));
        fs.mkdirSync(path.join(tempDir, '.git', 'hooks'), { recursive: true });
    });

    afterEach(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('J2: hook returns exit code 0 when daemon is not running (AC5)', () => {
        installHooks({ repo: tempDir });
        const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');

        const start = Date.now();
        const res = spawnSync('sh', [postCommit], { cwd: tempDir, env: { ...process.env, LENS_HOOKS: '1' } });
        const elapsed = Date.now() - start;

        expect(res.status).toBe(0);
        // Process spawn under heavy parallel test load on Windows can take ~1s; ensure hook finishes without blocking
        expect(elapsed).toBeLessThan(3000);
    });

    it('J3: hook does not block and returns exit 0 even if daemon hangs indefinitely (AC5)', async () => {
        let hangServer;
        const port = await new Promise(resolve => {
            hangServer = http.createServer(() => {
                // Deliberately hold connection open without sending response
            });
            hangServer.listen(0, '127.0.0.1', () => resolve(hangServer.address().port));
        });

        try {
            installHooks({ repo: tempDir });
            const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');
            const content = fs.readFileSync(postCommit, 'utf8').replace('4318', String(port));
            fs.writeFileSync(postCommit, content);

            const start = Date.now();
            const res = spawnSync('sh', [postCommit], { cwd: tempDir, env: { ...process.env, LENS_HOOKS: '1' } });
            const elapsed = Date.now() - start;

            expect(res.status).toBe(0);
            // Must return immediately without waiting for curl's timeout
            expect(elapsed).toBeLessThan(3000);
        } finally {
            await new Promise(resolve => hangServer.close(resolve));
        }
    });

    it('J1: hook sends background sync trigger when daemon is running (AC5, AC6)', async () => {
        let receivedUrl = null;
        let resolveRequest;
        const requestPromise = new Promise(resolve => { resolveRequest = resolve; });

        let server;
        const port = await new Promise(resolve => {
            server = http.createServer((req, res) => {
                receivedUrl = req.url;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
                resolveRequest();
            });
            server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        });

        try {
            installHooks({ repo: tempDir });
            const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');
            const content = fs.readFileSync(postCommit, 'utf8').replace('4318', String(port));
            fs.writeFileSync(postCommit, content);

            const res = spawnSync('sh', [postCommit], { cwd: tempDir, env: { ...process.env, LENS_HOOKS: '1' } });
            expect(res.status).toBe(0);

            // Wait for background curl to hit the server
            await Promise.race([
                requestPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for hook trigger')), 2000))
            ]);

            expect(receivedUrl).toContain('/sync?repo=');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('LENS_HOOKS=0 completely bypasses hook execution (AC5)', async () => {
        let hit = false;
        let server;
        const port = await new Promise(resolve => {
            server = http.createServer((_req, res) => {
                hit = true;
                res.end();
            });
            server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        });

        try {
            installHooks({ repo: tempDir });
            const postCommit = path.join(tempDir, '.git', 'hooks', 'post-commit');
            const content = fs.readFileSync(postCommit, 'utf8').replace('4318', String(port));
            fs.writeFileSync(postCommit, content);

            const res = spawnSync('sh', [postCommit], { cwd: tempDir, env: { ...process.env, LENS_HOOKS: '0' } });
            expect(res.status).toBe(0);

            // Wait a short duration to ensure no request was made
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(hit).toBe(false);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('J4: all hook types (post-commit, post-checkout, post-merge, post-rewrite) are installed and valid', () => {
        const installResult = installHooks({ repo: tempDir });
        expect(installResult.ok).toBe(true);

        for (const name of HOOK_NAMES) {
            const hookPath = path.join(tempDir, '.git', 'hooks', name);
            expect(fs.existsSync(hookPath)).toBe(true);
            const res = spawnSync('sh', ['-n', hookPath]);
            expect(res.status).toBe(0);
        }
    });

    it('J7: askDaemon returns null when daemon is down, and routes tool calls when up (AC8)', async () => {
        // Without daemon
        const resNoDaemon = await askDaemon({ home: tempDir, repo: tempDir, tool: 'functionView', json: '{"symbol":"test"}' });
        expect(resNoDaemon).toBeNull();

        // Mock daemon server
        let server;
        const port = await new Promise(resolve => {
            server = http.createServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    result: { content: [{ type: 'text', text: JSON.stringify({ symbol: 'test', found: true, callers: [] }) }] }
                }));
            });
            server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        });

        try {
            fs.writeFileSync(path.join(tempDir, 'daemon.json'), JSON.stringify({ mcpPort: port }));
            const resWithDaemon = await askDaemon({ home: tempDir, repo: tempDir, tool: 'functionView', json: '{"symbol":"test"}' });
            expect(resWithDaemon.code).toBe(0);
            expect(JSON.parse(resWithDaemon.text)).toMatchObject({ symbol: 'test', found: true });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
