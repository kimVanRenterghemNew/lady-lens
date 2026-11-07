#!/usr/bin/env node
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
const repoExplicit = args.includes('--repo');
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

process.env.LENS_REPO_ROOT = repo;
process.env.LENS_GRAPH_DB = targetDb;
process.env.LENS_PROJECT_GRAPH = '1';

const [command, ...rest] = args;
if (command === '-v' || command === '--version' || command === 'v' || command === 'version' || has('-v') || has('--version')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(`lady-lens v${pkg.version}`);
    process.exit(0);
}
if (command === '-' || command === '?' || command === '-h' || command === '--help' || command === 'help' || has('-h') || has('--help') || !command) {
    console.log('usage: lens <mcp|ui|sync|status|stop|ps|list|add|remove|ask|tools|install|uninstall|v|version> [options]');
    console.log('\nCommands:\n  v/version  Print the installed lady-lens version\n  install    Register MCP; add --skill for the skill and the lady-lens-first policy, --mendix for the Mendix skill\n  uninstall  Remove MCP registration, or skill and policy with --skill, or the Mendix skill with --mendix\n  mcp        Start MCP server (stdio, or -d for SSE & UI)\n  ui         Start graph visualization\n  sync       Sync codebase into Ladybug DB\n  status     Show running daemon status\n  stop       Stop background daemon (or one process: lens stop <pid>)\n  ps         List tracked daemon PIDs per folder\n  list       List registered repositories\n  add/remove Manage repositories\n  ask        Run tool with JSON args\n  tools      List available research tools');
    process.exit(0);
}
if (command === 'list') {
    for (const entry of Object.values(readRegistry().repos)) console.log(`${entry.id}  ${entry.path}  ${entry.nodes ?? '?'} nodes  last sync ${entry.lastSync ?? 'never'}`);
    process.exit(0);
}

if (command === 'install' || command === 'uninstall') { const { agentInstallCommand } = await import('../core/mcp/index.js'); const out = agentInstallCommand({ action: command, ids: rest.filter(a => !a.startsWith('-')), lensPath: fileURLToPath(import.meta.url), repo: repoExplicit ? repo : null, dryRun: has('--dry-run'), skill: has('--skill'), mendix: has('--mendix') }); console.log(out.text); process.exit(out.ok ? 0 : 1); }
try { fs.mkdirSync(path.dirname(process.env.LENS_GRAPH_DB), { recursive: true }); } catch { /* ignore */ }
const { RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS } = await import('../core/search/index.js');
const { buildMcpToolSchemas } = await import('../core/mcp/index.js');
const { createGraphRepository, PROJECT_SCOPE } = await import('../core/graph/index.js');

if (command === 'add') {
    const { repoAdd, activateRepoContext } = await import('../core/mcp/index.js');
    const { registered, sync } = await repoAdd({ path: rest[0] || process.cwd(), ...(dbFlag && { database: targetDb }) }, { activate: activateRepoContext });
    console.log(`Registered ${registered.id} ${registered.path} (${sync.nodes} nodes) -> database: ${registered.database}`);
    process.exit(0);
}

if (command === 'remove') {
    const target = rest[0];
    if (!target) { console.error('usage: lens remove <id|dir>'); process.exit(1); }
    const { repoRemove } = await import('../core/mcp/index.js');
    const { removed } = repoRemove({ repo: target });
    console.log(removed ? `Removed ${removed.id} ${removed.path}` : `Repository not found: ${target}`);
    process.exit(0);
}

if (command === 'ps' || command === 'stop') {
    const { daemonCommand } = await import('../core/mcp/index.js');
    const out = daemonCommand(command, rest);
    console.log(out.text); process.exit(out.code);
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
        writeDaemonInfo({ pid: child.pid, pids: [child.pid], mcpPort: port, uiPort, repo, startedAt: new Date().toISOString() });
        console.log(`lady-lens services running in background (detached)`);
        console.log(`  PID:          ${child.pid}`);
        console.log(`  MCP Link:     http://127.0.0.1:${port}/mcp`);
        console.log(`  Legacy SSE:   http://127.0.0.1:${port}/sse`);
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
        const { createMcpHttpServer, writeDaemonInfo, clearDaemonInfo, readDaemonInfo, arePortsBusy, existingDaemonMessage, runInRepo, addDaemonPid } = await import('../core/mcp/index.js');
        const { listRegisteredRepos } = await import('../core/repository/index.js'); const { createGraphUiServer } = await import('../ui/index.js');

        const activeDaemon = readDaemonInfo();
        const [mcpBusy, uiBusy] = await arePortsBusy([port, uiPort]);
        const existing = existingDaemonMessage({ info: activeDaemon, mcpBusy, uiBusy, port });
        if (!isChild && existing) {
            console.log(existing);
            process.exit(0);
        }

        // Also start UI server on uiPort alongside MCP
        try {
            const loadOverview = () => createGraphRepository().loadGraph({ scopes: [PROJECT_SCOPE] });
            const uiServer = createGraphUiServer({ tools: RESEARCH_TOOLS, loadOverview, repo, runInRepo: (hint, fn) => runInRepo(hint, repo, fn), listRepos: listRegisteredRepos });
            uiServer.listen(uiPort, '127.0.0.1');
        } catch (uiErr) {
            console.warn(`Could not start UI server on port ${uiPort}: ${uiErr.message}`);
        }

        const mcpHttp = createMcpHttpServer({ defaultRepo: repo, port, uiPort });
        const { port: actualPort } = await mcpHttp.start(port);

        if (isChild) addDaemonPid(process.pid);
        if (!isChild) {
            writeDaemonInfo({ pid: process.pid, pids: [process.pid], mcpPort: actualPort, uiPort, repo, startedAt: new Date().toISOString() });
            process.on('SIGINT', () => { clearDaemonInfo(); process.exit(0); });
            process.on('SIGTERM', () => { clearDaemonInfo(); process.exit(0); });
        }

        console.log(`lady-lens services listening:\n  MCP Link:     http://127.0.0.1:${actualPort}/mcp\n  Legacy SSE:   http://127.0.0.1:${actualPort}/sse\n  MCP Status:   http://127.0.0.1:${actualPort}/\n  UI Dashboard: http://127.0.0.1:${uiPort}/\n  Repo:         ${repo}`);
        if (!isChild) console.log(`  (Ctrl+C or 'lens stop' to stop)`);
    }
} else if (command === 'sync') {
    try {
        const { repoSync } = await import('../core/mcp/index.js');
        console.log(JSON.stringify(await repoSync({ full: has('--full') }), null, 2));
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
    for (const schema of buildMcpToolSchemas(RESEARCH_TOOL_SCHEMAS)) console.log(`${schema.name.padEnd(13)} ${schema.description}`);
} else {
    console.log('usage: lens <mcp|ui|sync|status|stop|list|add|remove|ask|tools|install|uninstall|v|version> [options]');
    process.exit(command ? 1 : 0);
}
