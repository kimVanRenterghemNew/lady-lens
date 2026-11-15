#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chosenNode } from '../core/update/index.js';
import { canonicalRepoPath, idOfRepo, LENS_HOME } from '../core/repository/index.js';
import { configureLensRoot } from '../core/configuration/index.js';
import { traceProcess, traceAsync } from '../core/observability/index.js';
import { askDaemon } from '../core/daemonCall/index.js';
// LENS_TRACE_FILE: one span per step of this command; the daemon traces each tool call instead of its whole lifetime
if (!['mcp', 'ui'].includes(process.argv[2])) traceProcess(`lens ${process.argv[2] ?? ''}`.trim());
const lensNode = chosenNode({ home: os.homedir() });
// LENS_NODE_CHILD stops a re-exec loop when the chosen path never equals execPath (symlinks, 8.3 names)
if (lensNode && !process.env.LENS_NODE_CHILD && path.resolve(lensNode).toLowerCase() !== process.execPath.toLowerCase()) process.exit(spawnSync(lensNode, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, LENS_NODE_CHILD: '1' } }).status ?? 1);
// waits for stdout to drain, so process.exit does not cut off large output on an async pipe
const print = (text) => new Promise(resolve => process.stdout.write(`${text}\n`, resolve));
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const HOME = LENS_HOME; // one lens home with core (LENS_HOME): a test with its own home never reads or changes the real one
const REGISTRY = path.join(HOME, 'repos.json');
const repoExplicit = args.includes('--repo');
const repo = canonicalRepoPath(flag('--repo', process.cwd()));
const id = idOfRepo(repo);
const dbFlag = flag('--db');
const cfg = [flag('--config'), process.env.LENS_SETTINGS_PATH, 'config.json', 'lens.config.json', '.lady-lens.json', '.lady-lens.yaml']
    .map(p => p && (path.isAbsolute(p) ? p : path.join(repo, p))).find(p => p && fs.existsSync(p));
const readJsonFile = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const fileConfig = cfg ? readJsonFile(cfg) : {};
if (fileConfig.env) Object.entries(fileConfig.env).forEach(([k, v]) => { if (!process.env[`LENS_${k}`] && !process.env[k]) process.env[`LENS_${k}`] = String(v); });

const readRegistry = () => { try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return { repos: {} }; } };
const registryData = readRegistry();
const existingEntry = registryData.repos[id];

const explicitDb = dbFlag && (registryData.repos[dbFlag]?.database || (dbFlag.endsWith('.lbdb') ? path.resolve(dbFlag) : path.join(HOME, 'repos', dbFlag, 'graph.lbdb')));
const configDb = fileConfig.database || fileConfig.db;
const targetDb = process.env.LENS_GRAPH_DB
    || explicitDb
    || (configDb ? path.resolve(repo, configDb) : null)
    || existingEntry?.database
    || path.join(HOME, 'repos', id, 'graph.lbdb');
process.env.LENS_REPO_ROOT = repo;
configureLensRoot(repo); // core is imported above, before LENS_REPO_ROOT is set: without this the scan root was not `repo`
process.env.LENS_GRAPH_DB = targetDb;
process.env.LENS_PROJECT_GRAPH = '1';
const [command, ...rest] = args;
if (['-v', '--version', 'v', 'version'].includes(command) || has('-v') || has('--version')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(`lady-lens v${pkg.version}`);
    process.exit(0);
}
if (['-', '?', '-h', '--help', 'help'].includes(command) || has('-h') || has('--help') || !command) {
    console.log('usage: lens <mcp|ui|sync|status|stop|ps|list|add|remove|ask|tools|bench|install|uninstall|update|node|v|version> [options]\n\nCommands:\n  v/version  Print the installed lady-lens version\n  update     Stop lens, install the newest lady-lens (or: lens update <version|file.tgz>), refresh agents and skills, restart the daemon\n  install    Register MCP (lens install skill / skill-mendix = --skill / --mendix); add --skill for the skill and the lady-lens-first policy, --mendix for the Mendix skill\n  uninstall  Remove MCP registration, or skill and policy with --skill, or the Mendix skill with --mendix\n  mcp        Start MCP server (stdio, or -d for SSE & UI)\n  ui         Start graph visualization\n  sync       Sync codebase into Ladybug DB (--full: everything again, --debug: log every step to ~/.lady-lens/logs)\n  status     Show running daemon status\n  stop       Stop background daemon (or one process: lens stop <pid>)\n  ps         List tracked daemon PIDs per folder\n  list       List registered repositories\n  add/remove Manage repositories\n  ask        Run tool with JSON args\n  tools      List available research tools\n  bench      Time sync and questions on this repo in a temporary database (--runs N, --baseline, --no-processes, --json; lens bench compare)');
    process.exit(0);
}
if (command === 'list') {
    for (const entry of Object.values(readRegistry().repos)) console.log(`${entry.id}  ${entry.path}  ${entry.nodes ?? '?'} nodes  last sync ${entry.lastSync ?? 'never'}`);
    process.exit(0);
}
if (command === 'install' || command === 'uninstall') { const { agentInstallCommand } = await import('../core/mcp/index.js'); const out = agentInstallCommand({ action: command, ids: rest.filter(a => !a.startsWith('-')), lensPath: fileURLToPath(import.meta.url), repo: repoExplicit ? repo : null, dryRun: has('--dry-run'), skill: has('--skill'), mendix: has('--mendix'), refresh: has('--refresh') }); console.log(out.text); process.exit(out.ok ? 0 : 1); }
if (command === 'update' || command === 'node') { const update = await import('../core/update/index.js'); const daemonFile = path.join(HOME, 'daemon.json'); const out = command === 'node' ? update.lensNodeCommand(rest[0], { home: os.homedir(), daemonFile }) : update.runLensUpdate({ arg: rest.find(a => !a.startsWith('-')), lensPath: fileURLToPath(import.meta.url), daemonFile }); console.log(out.text); process.exit(out.ok ? 0 : 1); }
// the MDL export of a Mendix project, started by a sync in the background (core/graph/sync/mendixExport.js)
if (command === 'mendix-export') { await (await import('../core/graph/index.js')).runMdlExport(rest[0]); process.exit(0); }
// in a temporary database: the registry and the repository's own database stay as they are
if (command === 'bench') { const bench = await import('../core/bench/index.js'); const outDir = path.join(HOME, 'bench', id); const out = rest[0] === 'compare' ? bench.compareCommand({ outDir, against: flag('--against') }) : await bench.benchCommand({ root: repo, outDir, repoKey: `repo:${id}`, runs: Number(flag('--runs')) || 5, baseline: has('--baseline'), processes: !has('--no-processes'), json: has('--json'), log: label => process.stderr.write(`  ${label}\n`) }); await print(out.text); process.exit(out.ok ? 0 : 1); }
if (['ps', 'status', 'stop'].includes(command)) {
    const { daemonCommand } = await import('../core/daemon/index.js'); // light: before lady-lens is loaded below
    const out = daemonCommand(command === 'status' ? 'ps' : command, rest); // status was in the help but printed the usage
    console.log(out.text); process.exit(out.code);
}
// a running daemon answers without loading lady-lens here; it uses the registered database, so not with --db or another one
const answer = command === 'ask' && existingEntry && targetDb === existingEntry.database ? await askDaemon({ home: HOME, repo, tool: rest[0], json: rest[1] }) : null;
if (answer) { await (answer.code ? console.error(answer.text) : print(answer.text)); process.exit(answer.code); }
try { fs.mkdirSync(path.dirname(process.env.LENS_GRAPH_DB), { recursive: true }); } catch { /* ignore */ }
const [{ RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS, DASHBOARD_TOOLS }, { buildMcpToolSchemas }, { createGraphRepository, PROJECT_SCOPE }] = await traceAsync('load modules', {}, () => Promise.all([import('../core/search/index.js'), import('../core/mcp/index.js'), import('../core/graph/index.js')]));
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
    const { removed, repo: entry } = repoRemove({ repo: target });
    console.log(removed ? `Removed ${entry.id} ${entry.path}` : `Repository not found: ${target}`);
    process.exit(0);
}

// stdio: no process.exit here, the server keeps reading stdin after runMcpServer returns
if (command === 'mcp' && args.includes('--stdio')) { const { runMcpServer } = await import('../core/mcp/index.js'); console.error(`lady-lens MCP server started on stdio (${repo})`); await runMcpServer({ defaultRepo: repo }); }

if (command === 'mcp' && !args.includes('--stdio')) {
    const isDetached = has('-d') || has('--daemon') || has('--detached');
    const port = Number(flag('--port', fileConfig.mcp?.port || fileConfig.port || '4318')) || 4318;
    const uiPort = Number(flag('--ui-port', fileConfig.mcp?.uiPort || fileConfig.uiPort || '4317')) || 4317;
    const isChild = has('--child');

    const { createMcpHttpServer, writeDaemonInfo, clearDaemonInfo, readDaemonInfo, arePortsBusy, existingDaemonMessage, runInRepo, addDaemonPid } = await import('../core/mcp/index.js');
    const { listRegisteredRepos } = await import('../core/repository/index.js'); const { createGraphUiServer } = await import('../ui/index.js');
    // before -d spawns: a second start whose child dies on the busy port overwrote daemon.json with that dead pid
    const activeDaemon = readDaemonInfo();
    const [mcpBusy, uiBusy] = await arePortsBusy([port, uiPort]);
    const existing = existingDaemonMessage({ info: activeDaemon, mcpBusy, uiBusy, port });
    if (!isChild && existing) {
        console.log(existing);
        process.exit(0);
    }

    if (isDetached) {
        const thisScript = fileURLToPath(import.meta.url);
        const child = spawn(process.execPath, [thisScript, 'mcp', '--port', String(port), '--ui-port', String(uiPort), '--repo', repo, '--child'], { detached: true, stdio: 'ignore' });
        child.unref();
        writeDaemonInfo({ pid: child.pid, pids: [child.pid], mcpPort: port, uiPort, repo, startedAt: new Date().toISOString() });
        console.log(`lady-lens services running in background (detached)\n  PID:          ${child.pid}\n  MCP Link:     http://127.0.0.1:${port}/mcp\n  Legacy SSE:   http://127.0.0.1:${port}/sse\n  MCP Status:   http://127.0.0.1:${port}/\n  UI Dashboard: http://127.0.0.1:${uiPort}/\n  Repo:         ${repo}\n  To stop:      lens stop`);
        process.exit(0);
    }

    // Also start UI server on uiPort alongside MCP
    try {
        const loadOverview = () => createGraphRepository().loadGraph({ scopes: [PROJECT_SCOPE] });
        const uiServer = createGraphUiServer({ tools: DASHBOARD_TOOLS, loadOverview, repo, runInRepo: (hint, fn) => runInRepo(hint, repo, fn), listRepos: listRegisteredRepos });
        uiServer.listen(uiPort, '127.0.0.1');
    } catch (uiErr) {
        console.warn(`Could not start UI server on port ${uiPort}: ${uiErr.message}`);
    }
    const mcpHttp = createMcpHttpServer({ defaultRepo: repo, port, uiPort });
    const { port: actualPort } = await mcpHttp.start(port);

    if (isChild) addDaemonPid(process.pid);
    if (!isChild) writeDaemonInfo({ pid: process.pid, pids: [process.pid], mcpPort: actualPort, uiPort, repo, startedAt: new Date().toISOString() });
    if (!isChild) { const cleanup = () => { clearDaemonInfo(); process.exit(0); }; process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup); }

    console.log(`lady-lens services listening:\n  MCP Link:     http://127.0.0.1:${actualPort}/mcp\n  Legacy SSE:   http://127.0.0.1:${actualPort}/sse\n  MCP Status:   http://127.0.0.1:${actualPort}/\n  UI Dashboard: http://127.0.0.1:${uiPort}/\n  Repo:         ${repo}`);
    if (!isChild) console.log(`  (Ctrl+C or 'lens stop' to stop)`);
}
const logSyncFailure = (err, debugLog) => debugLog && fs.appendFileSync(debugLog, `lens sync failed: ${err.stack}${err.cause ? `\ncause: ${err.cause.stack || err.cause}` : ''}\n`);
function handleSyncError(err, debugLog) {
    logSyncFailure(err, debugLog);
    console.error(`lens sync fout: ${err.message}${debugLog ? `\n(debug log: ${debugLog})` : ''}`);
    if (err.code === 'ELOCKED') console.error('Tip: Stop een eventuele actieve achtergrondserver met "lens stop"');
    process.exit(1);
}
async function runSyncCommand(full, debugLog) {
    try {
        const { repoSync } = await import('../core/mcp/index.js');
        const result = await repoSync({ full });
        if (debugLog) fs.appendFileSync(debugLog, `result: ${JSON.stringify(result)}\n`);
        await print(JSON.stringify(result, null, 2));
        // LENS_PROFILE=1: the phases of this sync on stderr, so stdout stays the JSON result
        if (process.env.LENS_PROFILE === '1') console.error((await import('../core/observability/index.js')).globalProfiler.formatReport({ title: `lens sync${full ? ' --full' : ''}: phases` }));
    } catch (err) {
        handleSyncError(err, debugLog);
    }
}

if (command === 'sync') {
    const full = has('--full');
    const debugLog = has('--debug') ? path.join(HOME, 'logs', `sync-${new Date().toISOString().replace(/[:.]/g, '-')}.log`) : null;
    if (debugLog) {
        fs.mkdirSync(path.dirname(debugLog), { recursive: true });
        process.env.LENS_DEBUG_LOG_FILE = debugLog;
        process.env.LENS_DEBUG_LEVEL ||= '1';
        const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const env = Object.entries(process.env).filter(([key]) => key.startsWith('LENS_')).map(([k, v]) => `${k}=${v}`).join(' ');
        fs.writeFileSync(debugLog, `lady-lens ${pkg.version} sync${full ? ' --full' : ''} in ${repo}\nnode ${process.version} (${process.execPath}) ${process.platform} ${process.arch}, ${os.cpus().length} cpus, memory ${Math.round(os.freemem() / 1048576)} MB free of ${Math.round(os.totalmem() / 1048576)} MB\n${env}\n`);
        console.error(`debug log: ${debugLog}`);
    }
    await runSyncCommand(full, debugLog);
    process.exit(0);
}

if (command === 'ask') {
    const [tool, json = '{}'] = rest;
    if (!RESEARCH_TOOLS[tool]) { console.error(`unknown tool "${tool}"; try: lens tools`); process.exit(1); }
    let input;
    try { input = JSON.parse(json); } catch (error) { console.error(`arguments must be JSON: ${error.message}`); process.exit(1); }
    await print(JSON.stringify(await traceAsync(`tool: ${tool}`, {}, () => RESEARCH_TOOLS[tool](input)), null, 2));
    process.exit(0);
}

if (command === 'ui') {
    const { createGraphUiServer } = await import('../ui/index.js');
    const port = Number(flag('--port', fileConfig.mcp?.uiPort || fileConfig.uiPort || '4317')) || 4317;
    const loadOverview = () => createGraphRepository().loadGraph({ scopes: [PROJECT_SCOPE] });
    createGraphUiServer({ tools: DASHBOARD_TOOLS, loadOverview, repo }).listen(port, '127.0.0.1', () => console.log(`lady-lens ${repo}: http://127.0.0.1:${port}  (Ctrl+C to stop)`));
}
if (command === 'tools') {
    for (const schema of buildMcpToolSchemas(RESEARCH_TOOL_SCHEMAS)) console.log(`${schema.name.padEnd(13)} ${schema.description}`);
    process.exit(0);
}

if (!['mcp', 'ui'].includes(command)) {
    console.log('usage: lens <mcp|ui|sync|status|stop|list|add|remove|ask|tools|bench|install|uninstall|update|node|v|version> [options]');
    process.exit(command ? 1 : 0);
}
