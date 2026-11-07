/**
 * Registers (or removes) the lady-lens MCP server in the config files of the coding agents on this machine.
 * Stdio entry with the absolute node path: no daemon, no port, and GUI apps need no PATH.
 *
 * @module core/mcp/agentInstall
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { policyTargets, installPolicy, uninstallPolicy } from './policyInstall.js';
import { tomlInstall, tomlUninstall } from './tomlInstall.js';

export const SERVER_NAME = 'lady-lens';

function packageVersion(lensPath) {
    try { return JSON.parse(fs.readFileSync(path.join(path.dirname(lensPath), '..', 'package.json'), 'utf8')).version; } catch { return null; }
}

/** The agents we know: `marker` says it is installed, `file`/`key` say where its MCP servers live. */
export function agentTargets({ home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {}) {
    const appSupport = (app, ...rest) => platform === 'win32'
        ? path.join(appData || path.join(home, 'AppData', 'Roaming'), app, ...rest)
        : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', app, ...rest) : path.join(home, '.config', app, ...rest);
    const target = (id, label, marker, file, extra = {}) => ({ id, label, marker, file, key: 'mcpServers', typed: false, ...extra });
    return [
        target('claude-code', 'Claude Code', path.join(home, '.claude.json'), path.join(home, '.claude.json')),
        target('claude-desktop', 'Claude Desktop', appSupport('Claude'), appSupport('Claude', 'claude_desktop_config.json')),
        target('cursor', 'Cursor', path.join(home, '.cursor'), path.join(home, '.cursor', 'mcp.json')),
        target('windsurf', 'Windsurf', path.join(home, '.codeium', 'windsurf'), path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
        target('gemini-cli', 'Gemini CLI', path.join(home, '.gemini', 'settings.json'), path.join(home, '.gemini', 'settings.json')),
        target('antigravity', 'Antigravity', path.join(home, '.gemini', 'antigravity'), path.join(home, '.gemini', 'antigravity', 'mcp_config.json')),
        target('vscode', 'VS Code', appSupport('Code', 'User'), appSupport('Code', 'User', 'mcp.json'), { key: 'servers', typed: true }),
        target('codex', 'Codex', path.join(home, '.codex'), path.join(home, '.codex', 'config.toml'), { toml: 'codex' }),
        target('vibe', 'Mistral Vibe', path.join(home, '.vibe'), path.join(home, '.vibe', 'config.toml'), { toml: 'vibe' })
    ];
}

export function serverEntry({ lensPath, repo = null, typed = false }) {
    const version = packageVersion(lensPath);
    return {
        ...(typed ? { type: 'stdio' } : {}),
        command: process.execPath,
        args: [lensPath, 'mcp', '--stdio', ...(repo ? ['--repo', repo] : [])],
        ...(version ? { env: { LENS_MCP_VERSION: version } } : {})
    };
}

function readConfig(file) {
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? JSON.parse(text) : {};
}

function writeConfig(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.lady-lens.bak`);
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
}

export const MENDIX_SKILL = 'lady-lens-mendix';

export function skillTargets({ home = os.homedir() } = {}, name = SERVER_NAME) {
    return [
        { id: 'claude', label: 'Claude skill', marker: path.join(home, '.claude'), file: path.join(home, '.claude', 'skills', name, 'SKILL.md') },
        { id: 'copilot', label: 'Copilot skill', marker: path.join(home, '.copilot'), file: path.join(home, '.copilot', 'skills', name, 'SKILL.md') },
        { id: 'agents', label: 'Agents skill', marker: path.join(home, '.agents'), file: path.join(home, '.agents', 'skills', name, 'SKILL.md') }
    ];
}

function skillSource(lensPath, name = SERVER_NAME) {
    return path.join(path.dirname(lensPath), '..', 'skills', name, 'SKILL.md');
}

function installSkill(target, lensPath, dryRun, name) {
    const source = skillSource(lensPath, name);
    if (!fs.existsSync(source)) return { status: 'error', reason: 'skill is missing from package' };
    const existed = fs.existsSync(target.file);
    if (!dryRun) {
        fs.mkdirSync(path.dirname(target.file), { recursive: true });
        if (existed) fs.copyFileSync(target.file, `${target.file}.lady-lens.bak`);
        fs.copyFileSync(source, target.file);
    }
    return { status: existed ? 'updated' : 'installed' };
}

function uninstallSkill(target, dryRun) {
    if (!fs.existsSync(target.file)) return { status: 'absent' };
    if (!dryRun) fs.rmSync(target.file, { force: true });
    return { status: 'removed' };
}

/** Read the config, let `change` edit the servers map, write only if something changed. */
function update(target, dryRun, change) {
    let data;
    try { data = readConfig(target.file); } catch (error) { return { status: 'error', reason: `cannot parse (comments?): ${error.message}` }; }
    const servers = { ...(data[target.key] || {}) };
    const before = servers[SERVER_NAME];
    const status = change(servers, before);
    if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(before)) return { status: before === undefined ? 'absent' : 'unchanged' };
    if (!dryRun) writeConfig(target.file, { ...data, [target.key]: servers });
    return { status };
}

const install = (target, entry, dryRun) => update(target, dryRun, (servers, before) => {
    servers[SERVER_NAME] = entry;
    return before === undefined ? 'installed' : 'updated';
});

const uninstall = (target, dryRun) => update(target, dryRun, servers => {
    delete servers[SERVER_NAME];
    return 'removed';
});

/** Named agents are always handled; without names, only the agents that are installed on this machine. */
export function runAgentInstall({ action = 'install', ids = [], lensPath, repo = null, dryRun = false, env = {} }) {
    const all = agentTargets(env);
    const explicit = ids.length > 0 && !ids.includes('all');
    const unknown = explicit ? ids.filter(id => !all.some(target => target.id === id)) : [];
    const wanted = explicit ? all.filter(target => ids.includes(target.id)) : all.filter(target => fs.existsSync(target.marker));
    const results = wanted.map(target => ({
        id: target.id, label: target.label, file: target.file,
        ...(target.toml
            ? (action === 'uninstall' ? tomlUninstall(target, dryRun) : tomlInstall(target, serverEntry({ lensPath, repo }), dryRun))
            : (action === 'uninstall' ? uninstall(target, dryRun) : install(target, serverEntry({ lensPath, repo, typed: target.typed }), dryRun)))
    }));
    return [...unknown.map(id => ({ id, label: id, file: '', status: 'error', reason: `unknown agent; try: ${all.map(target => target.id).join(', ')}` })), ...results];
}

export function runSkillInstall({ action = 'install', ids = [], lensPath, dryRun = false, env = {}, name = SERVER_NAME }) {
    const all = skillTargets(env, name);
    const explicit = ids.length > 0 && !ids.includes('all');
    const wanted = explicit ? all.filter(target => ids.includes(target.id)) : all.filter(target => fs.existsSync(target.marker));
    const skills = wanted.map(target => ({ id: target.id, label: target.label, file: target.file, ...(action === 'uninstall' ? uninstallSkill(target, dryRun) : installSkill(target, lensPath, dryRun, name)) }));
    if (name !== SERVER_NAME) return skills; // the lady-lens-first policy belongs to the main skill only
    // the skill loads only when a task matches it; the policy in the always-read instruction files makes lady-lens the default
    const policies = policyTargets(env).filter(target => (explicit ? ids.includes(target.id) : fs.existsSync(target.marker)));
    const policy = action === 'uninstall' ? null : fs.readFileSync(path.join(path.dirname(skillSource(lensPath)), 'lens-instructions.md'), 'utf8');
    return [...skills, ...policies.map(target => ({ id: target.id, label: target.label, file: target.file, ...(policy === null ? uninstallPolicy(target, dryRun) : installPolicy(target, policy, dryRun)) }))];
}

/** The text and exit code of `lens install` / `lens uninstall`. */
export function formatAgentInstall(results, { action = 'install', dryRun = false } = {}) {
    if (!results.length) return { ok: false, text: `No agents found. Name one: lens ${action} ${agentTargets().map(target => target.id).join('|')}` };
    const lines = results.map(r => `${r.status.padEnd(10)} ${r.label.padEnd(15)} ${r.file}${r.reason ? `  (${r.reason})` : ''}`);
    const changed = results.some(r => ['installed', 'updated', 'removed'].includes(r.status));
    if (changed && !dryRun) lines.push('', 'Restart the agent (or reload its MCP servers) to pick up the change.');
    if (dryRun) lines.push('', 'Dry run: nothing was written.');
    return { ok: !results.some(r => r.status === 'error'), text: lines.join('\n') };
}

export function agentInstallCommand({ action, ids, lensPath, repo, dryRun, skill = false, mendix = false }) {
    const results = mendix ? runSkillInstall({ action, ids, lensPath, dryRun, name: MENDIX_SKILL })
        : skill ? runSkillInstall({ action, ids, lensPath, dryRun }) : runAgentInstall({ action, ids, lensPath, repo, dryRun });
    return formatAgentInstall(results, { action, dryRun });
}
