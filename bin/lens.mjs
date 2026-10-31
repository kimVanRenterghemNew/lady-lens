#!/usr/bin/env node
// lady-lens: the code graph for any repository. Data per repo in ~/.lady-lens/repos/<id>/graph.lbdb.
//   lens sync [--repo <dir>] [--full] index (incremental by content hash)
//   lens ask <tool> '<json>' [--repo <dir>] definedIn, importedBy, imports, exports, exists, functionView, folderView, graph_query, grep, glob, read_chunk
//   lens mcp [-d|--daemon] [--port 4318] [--stdio] [--repo <dir>] run MCP server (HTTP/SSE or stdio)
//   lens stop stop any running detached lady-lens daemon (MCP & UI)
//   lens ui [--repo <dir>] [--port 4317] local search page (127.0.0.1)
//   lens list the repositories in ~/.lady-lens/repos.json
//   lens add <dir> register a repository and sync
//   lens remove <id|dir> unregister a repository
//   lens tools the tools and what they answer
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };

const HOME = path.join(os.homedir(), '.lady-lens');
const REGISTRY = path.join(HOME, 'repos.json');
const repo = path.resolve(flag('--repo', process.cwd()));
const id = crypto.createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 12);
const dbFlag = flag('--db');

const cfg = [flag('--config'), process.env.LENS_SETTINGS_PATH, 'config.json', 'lens.config.json', '.lady-lens.json', '.lady-lens.yaml']
    .map(p => p && (path.isAbsolute(p) ? p : path.join(repo, p))).find(p => p && fs.existsSync(p));
let fileConfig = {};
if (cfg) {
    try {
        fileConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        if (fileConfig.env) for (const [k, v] of Object.entries(fileConfig.env)) if (!process.env[`LENS_${k}`] && !process.env[k]) process.env[`LENS_${k}`] = String(v);
    } catch { /* ignore */ }
}

const readRegistry = () => { try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return { repos: {} }; } };
const registryData = readRegistry();
const existingEntry = registryData.repos[id];

let targetDb = process.env.LENS_GRAPH_DB;
if (!targetDb) {
    if (dbFlag) {
        const fromReg = registryData.repos[dbFlag];
        targetDb = fromReg?.database || (dbFlag.endsWith('.lbdb') ? path.resolve(dbFlag) : path.join(HOME, 'repos', dbFlag, 'graph.lbdb'));
    } else if (fileConfig.database || fileConfig.db) {
        targetDb = path.resolve(repo, fileConfig.database || fileConfig.db);
    } else if (existingEntry?.database) {
        targetDb = existingEntry.database;
    } else {
        targetDb = path.join(HOME, 'repos', id, 'graph.lbdb');
    }
}

// The graph modules read these once, at import: set them before importing anything of core/.
process.env.LENS_REPO_ROOT = repo;
process.env.LENS_GRAPH_DB = targetDb;
process.env.LENS_PROJECT_GRAPH = '1';

function remember(fields) {
    const registry = readRegistry();
    registry.repos[id] = { ...(registry.repos[id] ?? {}), id, path: repo, database: process.env.LENS_GRAPH_DB, ...fields };
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(`${REGISTRY}.tmp`, JSON.stringify(registry, null, 2));
    fs.renameSync(`${REGISTRY}.tmp`, REGISTRY);
}

const [command, ...rest] = args;
if (command === '-v' || command === '--version' || command === 'version' || has('-v') || has('--version')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(`lady-lens v${pkg.version}`);
    process.exit(0);
}
if (command === '-h' || command === '--help' || command === 'help' || has('-h') || has('--help') || !command) {
    console.log('usage: lens <mcp|ui|sync|status|stop|list|add|remove|ask|tools> [options]');
    console.log('\nCommands:\n  mcp        Start MCP server (stdio, or -d for SSE & UI)\n  ui         Start graph visualization\n  sync       Sync codebase into Ladybug DB\n  status     Show running daemon status\n  stop       Stop background daemon\n  list       List registered repositories\n  add/remove Manage repositories\n  ask        Run tool with JSON args\n  tools      List available research tools');
    process.exit(0);
}
if (command === 'list') {
    for (const entry of Object.values(readRegistry().repos)) console.log(`${entry.id}  ${entry.path}  ${entry.nodes ?? '?'} nodes  last sync ${entry.lastSync ?? 'never'}`);
    process.exit(0);
}

try { fs.mkdirSync(path.dirname(process.env.LENS_GRAPH_DB), { recursive: true }); } catch { /* ignore */ }
const { RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS } = await import('../core/search/index.js');
const { createGraphSync, createGraphRepository, PROJECT_SCOPE } = await import('../core/graph/index.js');

if (command === 'add') {
    const targetDir = path.resolve(rest[0] || process.cwd());
    const { registerRepo } = await import('../core/repository/index.js');
    const { activateRepoContext } = await import('../core/mcp/index.js');
    const entry = registerRepo(targetDir, dbFlag ? { database: targetDb } : {});
    activateRepoContext(entry);
    const result = await createGraphSync().sync({ mode: 'incremental' });
    registerRepo(targetDir, { ...(dbFlag ? { database: targetDb } : {}), lastSync: new Date().toISOString(), nodes: result.nodes });
    console.log(`Registered ${entry.id} ${targetDir} (${result.nodes} nodes) -> database: ${entry.database}`);
    process.exit(0);
}

if (command === 'remove') {
    const target = rest[0];
    if (!target) { console.error('usage: lens remove <id|dir>'); process.exit(1); }
    const { unregisterRepo } = await import('../core/repository/index.js');
    const removed = unregisterRepo(target);
    if (removed) console.log(`Removed ${removed.id} ${removed.path}`);
    else console.log(`Repository not found: ${target}`);
    process.exit(0);
}

if (command === 'stop') {
    const { stopDaemon } = await import('../core/mcp/index.js');
    const result = stopDaemon();
    console.log(result.message || (result.running ? `Stopped daemon PID ${result.pid}` : 'Daemon not running'));
    process.exit(result.error ? 1 : 0);
}

if (command === 'mcp') {
    const isDetached = has('-d') || has('--daemon') || has('--detached');
    const port = Number(flag('--port', fileConfig.mcp?.port || fileConfig.port || '4318')) || 4318;
    const uiPort = Number(flag('--ui-port', fileConfig.mcp?.uiPort || fileConfig.uiPort || '4317')) || 4317;
    const isChild = has('--child');
    const isStdio = has('--stdio');

    if (isDetached) {
        const thisScript = fileURLToPath(import.meta.url);
        const child = spawn(process.execPath, [thisScript, 'mcp', '--port', String(port), '--ui-port', String(uiPort), '--repo', repo, '--child'], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        const { writeDaemonInfo } = await import('../core/mcp/index.js');
        writeDaemonInfo({ pid: child.pid, mcpPort: port, uiPort, repo, startedAt: new Date().toISOString() });
        console.log(`lady-lens services running in background (detached)`);
        console.log(`  PID:          ${child.pid}`);
        console.log(`  MCP Link:     http://127.0.0.1:${port}/sse`);
        console.log(`  MCP Status:   http://127.0.0.1:${port}/`);
        console.log(`  UI Dashboard: http://127.0.0.1:${uiPort}/`);
        console.log(`  Repo:         ${repo}`);
        console.log(`  To stop:      lens stop`);
        process.exit(0);
    } else if (isStdio) {
        const { runMcpServer } = await import('../core/mcp/index.js');
        console.error(`lady-lens MCP server started on stdio (${repo})`);
        await runMcpServer({ defaultRepo: repo });
    } else {
        const { createMcpHttpServer, writeDaemonInfo, clearDaemonInfo } = await import('../core/mcp/index.js');
        const { createGraphUiServer } = await import('../ui/index.js');

        // Also start UI server on uiPort alongside MCP
        try {
            const loadOverview = () => createGraphRepository().loadGraph({ scopes: [PROJECT_SCOPE] });
            const uiServer = createGraphUiServer({ tools: RESEARCH_TOOLS, loadOverview, repo });
            uiServer.listen(uiPort, '127.0.0.1');
        } catch (uiErr) {
            console.warn(`Could not start UI server on port ${uiPort}: ${uiErr.message}`);
        }

        const mcpHttp = createMcpHttpServer({ defaultRepo: repo, port, uiPort });
        const { port: actualPort } = await mcpHttp.start(port);

        if (!isChild) {
            writeDaemonInfo({ pid: process.pid, mcpPort: actualPort, uiPort, repo, startedAt: new Date().toISOString() });
            process.on('SIGINT', () => { clearDaemonInfo(); process.exit(0); });
            process.on('SIGTERM', () => { clearDaemonInfo(); process.exit(0); });
        }

        console.log(`lady-lens services listening:\n  MCP Link:     http://127.0.0.1:${actualPort}/sse\n  MCP Status:   http://127.0.0.1:${actualPort}/\n  UI Dashboard: http://127.0.0.1:${uiPort}/\n  Repo:         ${repo}`);
        if (!isChild) console.log(`  (Ctrl+C or 'lens stop' to stop)`);
    }
} else if (command === 'sync') {
    try {
        const result = await createGraphSync().sync({ mode: has('--full') ? 'full' : 'incremental' });
        remember({ lastSync: new Date().toISOString(), nodes: result.nodes });
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error(`lens sync fout: ${err.message}`);
        if (err.code === 'ELOCKED') console.error('Tip: Stop een eventuele actieve achtergrondserver met "lens stop"');
        process.exit(1);
    }
} else if (command === 'ask') {
    const [tool, json = '{}'] = rest;
    if (!RESEARCH_TOOLS[tool]) { console.error(`unknown tool "${tool}"; try: lens tools`); process.exit(1); }
    let input;
    try { input = JSON.parse(json); } catch (error) { console.error(`arguments must be JSON: ${error.message}`); process.exit(1); }
    console.log(JSON.stringify(await RESEARCH_TOOLS[tool](input), null, 2));
} else if (command === 'ui') {
    const { createGraphUiServer } = await import('../ui/index.js');
    const port = Number(flag('--port', fileConfig.mcp?.uiPort || fileConfig.uiPort || '4317')) || 4317;
    const loadOverview = () => createGraphRepository().loadGraph({ scopes: [PROJECT_SCOPE] });
    createGraphUiServer({ tools: RESEARCH_TOOLS, loadOverview, repo }).listen(port, '127.0.0.1', () => console.log(`lady-lens ${repo}: http://127.0.0.1:${port}  (Ctrl+C to stop)`));
} else if (command === 'tools') {
    for (const schema of RESEARCH_TOOL_SCHEMAS) console.log(`${schema.name.padEnd(13)} ${schema.description}`);
} else {
    console.log('usage: lens sync|ask|ui|list|tools  (see the top of bin/lens.mjs or README.md)');
    process.exit(command ? 1 : 0);
}
