/**
 * `lens ask` through the running daemon: the daemon has every module and the graph loaded, so a question costs one HTTP
 * call instead of loading lady-lens in a new process (650-750 ms of a ~1 s `lens ask`, 2026-11-13). Light on purpose:
 * no import of the rest of lady-lens. Without a daemon that answers, the caller runs the tool itself.
 * @module core/daemonCall
 */
import fs from 'fs';
import path from 'path';

const readJson = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const parseArgs = (json) => {
    try { return JSON.parse(json ?? '{}'); } catch { return null; }
};

// a sync inside the daemon may take minutes on a big repository; a daemon that hangs longer is treated as absent
const TIMEOUT_MS = 10 * 60 * 1000;

/** The JSON-RPC message in a streamable HTTP answer: plain JSON, or the `data:` line of a server-sent event. */
function messageOf(body) {
    const line = body.split(/\r?\n/).find(text => text.startsWith('data:'));
    try { return JSON.parse(line ? line.slice(5) : body); } catch { return null; }
}

const UNKNOWN_TOOL = -32601;
const isUnknownTool = (message, text) => message?.error?.code === UNKNOWN_TOOL || String(text).includes(`MCP error ${UNKNOWN_TOOL}`);

const textOf = (message) => message?.result?.content?.[0]?.text;

/** What the CLI prints, as `lens ask` without a daemon does: the tool's text, or a failure on stderr with exit code 1. */
function answerOf(message, tool) {
    const text = textOf(message);
    if (isUnknownTool(message, text)) return { text: `unknown tool "${tool}"; try: lens tools`, code: 1 };
    if (typeof text !== 'string') return null;
    return { text, code: message.result.isError ? 1 : 0 };
}

async function post(port, repo, tool, args) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp?repo=${encodeURIComponent(repo)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return response.ok ? messageOf(await response.text()) : null;
}

/**
 * Ask `tool` with `json` (the CLI's argument) through the daemon of `home` for repository `repo`.
 * @returns {Promise<{text: string, code: number}|null>} null when there is no daemon, it refuses the repository (not
 *   registered), it fails, or `json` is not valid JSON (the CLI then reports that itself)
 */
export async function askDaemon({ home, repo, tool, json }) {
    const port = readJson(path.join(home, 'daemon.json'))?.mcpPort;
    const args = parseArgs(json);
    if (![port, tool, args].every(Boolean)) return null;
    try {
        return answerOf(await post(port, repo, tool, args), tool);
    } catch {
        return null;
    }
}
