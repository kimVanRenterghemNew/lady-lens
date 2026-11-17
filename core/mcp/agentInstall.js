/**
 * Registers (or removes) the lady-lens MCP server in the config files of the coding agents on this machine.
 * Stdio entry with the absolute node path: no daemon, no port, and GUI apps need no PATH.
 *
 * @module core/mcp/agentInstall
 */
import fs from 'fs';
import path from 'path';
import { policyTargets, installPolicy, uninstallPolicy } from './policyInstall.js';
import { tomlInstall, tomlUninstall } from './tomlInstall.js';
import { yamlInstall, yamlUninstall, yamlRepo } from './yamlInstall.js';
import { expandFamilies } from './agentFamilies.js';
import { agentTargets, skillTargets } from './agentTargets.js';

export { agentTargets, skillTargets };

export const SERVER_NAME = 'lady-lens';

function packageVersion(lensPath) {
    try { return JSON.parse(fs.readFileSync(path.join(path.dirname(lensPath), '..', 'package.json'), 'utf8')).version; } catch { return null; }
}

/** OpenCode and Kilo: the same server, with the command as one array and `environment` for the variables. */
function localEntry(options) {
    const { command, args, env } = serverEntry(options);
    return { type: 'local', command: [command, ...args], enabled: true, ...(env ? { environment: env } : {}) };
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

const entryFor = (target, options) => (target.local ? localEntry(options) : { ...serverEntry({ ...options, typed: target.typed }), ...target.entry });

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

const FORMATS = { yaml: [yamlInstall, yamlUninstall], toml: [tomlInstall, tomlUninstall], json: [install, uninstall] };

function applyAgent(target, { action, lensPath, repo, dryRun }) {
    const [add, remove] = FORMATS[['yaml', 'toml'].find(format => target[format]) ?? 'json'];
    return action === 'uninstall' ? remove(target, dryRun) : add(target, entryFor(target, { lensPath, repo }), dryRun);
}

/** Named agents are always handled; without names, only the agents that are installed on this machine. */
export function runAgentInstall({ action = 'install', ids = [], lensPath, repo = null, dryRun = false, env = {} }) {
    const all = agentTargets(env);
    const explicit = ids.length > 0 && !ids.includes('all');
    const unknown = explicit ? ids.filter(id => !all.some(target => target.id === id)) : [];
    const wanted = explicit ? all.filter(target => ids.includes(target.id)) : all.filter(target => fs.existsSync(target.marker));
    const results = wanted.map(target => ({ id: target.id, label: target.label, file: target.file, ...applyAgent(target, { action, lensPath, repo, dryRun }) }));
    return [...unknown.map(id => ({ id, label: id, file: '', status: 'error', reason: `unknown agent; try: ${all.map(target => target.id).join(', ')}` })), ...results];
}

// `lens install skill vscode claude-code` names agents: the skill folder and the policy file each agent reads
const SKILL_OF_AGENT = { 'claude-code': 'claude', 'claude-desktop': 'claude', vscode: 'copilot', 'copilot-cli': 'copilot', 'gemini-cli': 'gemini' };
const POLICY_OF_AGENT = { 'claude-code': 'claude', 'claude-desktop': 'claude', 'copilot-cli': 'copilot', 'antigravity-cli': 'antigravity' };

export function runSkillInstall({ action = 'install', ids: named = [], lensPath, dryRun = false, env = {}, name = SERVER_NAME, policyIds = null }) {
    const all = skillTargets(env, name);
    const known = new Set([...all, ...policyTargets(env), ...agentTargets(env)].map(target => target.id));
    const unknown = named.filter(id => id !== 'all' && !known.has(id));
    const explicit = named.length > 0 && !named.includes('all');
    const ids = named.filter(id => known.has(id)).flatMap(id => [SKILL_OF_AGENT[id] ?? (all.some(target => target.id === id) ? id : 'agents'), POLICY_OF_AGENT[id] ?? id]);
    const errors = unknown.map(id => ({ id, label: id, file: '', status: 'error', reason: `unknown agent; try: ${agentTargets(env).map(target => target.id).join(', ')}` }));
    if (explicit && unknown.length === named.length) return errors;
    const wanted = explicit ? all.filter(target => ids.includes(target.id)) : all.filter(target => fs.existsSync(target.marker));
    const skills = wanted.map(target => ({ id: target.id, label: target.label, file: target.file, ...(action === 'uninstall' ? uninstallSkill(target, dryRun) : installSkill(target, lensPath, dryRun, name)) }));
    if (name !== SERVER_NAME) return [...errors, ...skills]; // the lady-lens-first policy belongs to the main skill only
    // the skill loads only when a task matches it; the policy in the always-read instruction files makes lady-lens the default
    const policies = policyTargets(env).filter(target => (policyIds ? policyIds.includes(target.id) : explicit ? ids.includes(target.id) : fs.existsSync(target.marker)));
    const policy = action === 'uninstall' ? null : fs.readFileSync(path.join(path.dirname(skillSource(lensPath)), 'lens-instructions.md'), 'utf8');
    return [...errors, ...skills, ...policies.map(target => ({ id: target.id, label: target.label, file: target.file, ...(policy === null ? uninstallPolicy(target, dryRun) : installPolicy(target, policy, dryRun)) }))];
}

const mentionsLens = file => { try { return fs.readFileSync(file, 'utf8').includes(SERVER_NAME); } catch { return false; } };

/**
 * After `lens update`: register lady-lens again only where it is registered (new version; a `--repo` in a JSON entry is kept),
 * and copy again only the skills that are installed, so every agent picks up the new package and nothing new is added.
 */
const argsOf = found => (found ? found.args || found.command || [] : []);

function configEntry(target) {
    try { return readConfig(target.file)[target.key]?.[SERVER_NAME]; } catch { return undefined; /* toml */ }
}

/** The `--repo` a registered entry was started with (JSON: `args`, OpenCode/Kilo: inside `command`), or null. */
function repoOf(target) {
    if (target.yaml) return yamlRepo(target);
    const args = argsOf(configEntry(target));
    const at = args.indexOf('--repo');
    return at < 0 ? null : args[at + 1];
}

export function runRefresh({ lensPath, env = {}, dryRun = false }) {
    const agents = agentTargets(env).filter(target => mentionsLens(target.file)).flatMap(target => runAgentInstall({ ids: [target.id], lensPath, repo: repoOf(target), env, dryRun }));
    const skills = [SERVER_NAME, MENDIX_SKILL].flatMap(name => {
        const ids = skillTargets(env, name).filter(target => fs.existsSync(target.file)).map(target => target.id);
        // a refresh updates the policies that are there; it never adds one
        return ids.length ? runSkillInstall({ ids, lensPath, env, name, dryRun, policyIds: policyTargets(env).filter(target => mentionsLens(target.file)).map(target => target.id) }) : [];
    });
    return [...agents, ...skills];
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

export function agentInstallCommand({ action, ids, lensPath, repo, dryRun, skill = false, mendix = false, refresh = false, env = {} }) {
    // `lens install skill` / `skill-mendix` read like the flags `--skill` / `--mendix`
    mendix ||= ids.some(id => id === 'mendix' || id === 'skill-mendix');
    skill ||= ids.includes('skill');
    ids = expandFamilies(ids.filter(id => !['skill', 'mendix', 'skill-mendix'].includes(id)), { skill, mendix, targets: agentTargets(env) });
    if (refresh && action === 'install') return formatAgentInstall(runRefresh({ lensPath, env, dryRun }), { action, dryRun });
    const results = mendix ? runSkillInstall({ action, ids, lensPath, dryRun, env, name: MENDIX_SKILL })
        : skill ? runSkillInstall({ action, ids, lensPath, dryRun, env }) : runAgentInstall({ action, ids, lensPath, repo, dryRun, env });
    return formatAgentInstall(results, { action, dryRun });
}
