import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLadyLensMcpServer } from './server.js';
import { findRegisteredRepo } from '../repository/index.js';

export async function handleStreamableHttpRequest(req, res, { defaultRepo, createServer = createLadyLensMcpServer, createTransport = () => new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }) }) {
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, POST, DELETE' }).end('Method Not Allowed');
        return;
    }
    // A client picks its project with /mcp?repo=<folder|id> (or X-Lens-Repo); only registered repos are accepted.
    const hint = new URL(req.url || '/', 'http://localhost').searchParams.get('repo') || req.headers?.['x-lens-repo'];
    if (hint) {
        const registered = findRegisteredRepo(hint);
        if (!registered) {
            res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `Repository not registered: ${hint}. Run 'lens add <folder>' first.` }));
            return;
        }
        defaultRepo = registered.path;
    }
    const streamableServer = createServer({ defaultRepo });
    const transport = createTransport();
    try {
        await streamableServer.connect(transport);
        await transport.handleRequest(req, res);
    } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        if (!res.writableEnded) res.end(JSON.stringify({ error: error.message }));
    } finally {
        await transport.close().catch(() => {});
        await streamableServer.close().catch(() => {});
    }
}