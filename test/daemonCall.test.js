/**
 * `lens ask` asks the running daemon first (one HTTP call instead of loading lady-lens: 650-750 ms of a ~1 s call);
 * without a daemon that answers, the CLI runs the tool itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { askDaemon } from '../core/daemonCall/index.js';

let home;
let server;
const asked = [];

/** A daemon that answers like the MCP endpoint: one server-sent event per call. */
function answer(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        const url = new URL(req.url, 'http://localhost');
        const { params } = JSON.parse(body);
        asked.push({ repo: url.searchParams.get('repo'), ...params });
        if (url.searchParams.get('repo') === 'C:/unregistered') return res.writeHead(403).end('Forbidden');
        const result = params.name === 'definedIn'
            ? { content: [{ type: 'text', text: '{\n  "found": true\n}' }] }
            : { content: [{ type: 'text', text: `Error executing ${params.name}: MCP error -32601: Unknown tool: ${params.name}` }], isError: true };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`);
    });
}

beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-call-'));
    server = http.createServer(answer);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 1, mcpPort: server.address().port }));
});
afterAll(() => {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
});

describe('lens ask through the daemon', () => {
    it('gives the daemon\'s answer for the repository and the arguments asked', async () => {
        expect(await askDaemon({ home, repo: 'C:/git/app', tool: 'definedIn', json: '{"symbol":"run"}' })).toEqual({ text: '{\n  "found": true\n}', code: 0 });
        expect(asked.at(-1)).toEqual({ repo: 'C:/git/app', name: 'definedIn', arguments: { symbol: 'run' } });
    });

    it('an unknown tool says so, as without a daemon', async () => {
        expect(await askDaemon({ home, repo: 'C:/git/app', tool: 'nope', json: '{}' })).toEqual({ text: 'unknown tool "nope"; try: lens tools', code: 1 });
    });

    it('runs the tool itself when there is no daemon, the daemon refuses the repository, or the arguments are no JSON', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-no-daemon-'));
        try {
            expect(await askDaemon({ home: empty, repo: 'C:/git/app', tool: 'definedIn', json: '{}' })).toBeNull();
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
        expect(await askDaemon({ home, repo: 'C:/unregistered', tool: 'definedIn', json: '{}' })).toBeNull();
        expect(await askDaemon({ home, repo: 'C:/git/app', tool: 'definedIn', json: '{bad' })).toBeNull();
    });
});
