import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { agentTargets, serverEntry, runAgentInstall, runSkillInstall, formatAgentInstall } from '../core/mcp/index.js';

const LENS = path.resolve('bin/lens.mjs');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;
let home, env;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const target = id => agentTargets(env).find(t => t.id === id);
const run = (extra = {}) => runAgentInstall({ lensPath: LENS, env, ...extra });

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-agents-'));
    env = { home, platform: 'linux' };
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('agent install', () => {
    it('installs, updates, dry-runs and uninstalls the Lady-lens skill', () => {
        fs.mkdirSync(path.join(home, '.copilot'));
        const options = { lensPath: LENS, env, ids: ['copilot'] };
        expect(runSkillInstall(options)[0].status).toBe('installed');
        expect(fs.readFileSync(path.join(home, '.copilot', 'skills', 'lady-lens', 'SKILL.md'), 'utf8')).toContain('Lady-lens workflow');
        expect(runSkillInstall(options)[0].status).toBe('updated');
        expect(runSkillInstall({ ...options, dryRun: true })[0].status).toBe('updated');
        expect(runSkillInstall({ ...options, action: 'uninstall' })[0].status).toBe('removed');
    });

    it('installs the Mendix skill next to the main one, without touching the instruction files', () => {
        fs.mkdirSync(path.join(home, '.claude'));
        const options = { lensPath: LENS, env, name: 'lady-lens-mendix' };
        const results = runSkillInstall(options);
        expect(results.map(r => [r.id, r.status])).toEqual([['claude', 'installed']]);
        expect(fs.readFileSync(path.join(home, '.claude', 'skills', 'lady-lens-mendix', 'SKILL.md'), 'utf8')).toContain('.mxcli/mdl');
        expect(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md'))).toBe(false);
        expect(runSkillInstall({ ...options, action: 'uninstall' })[0].status).toBe('removed');
    });

    it('links the always-read instruction files to one lens-instructions.md, and uninstall gives back every byte', () => {
        const claudeMd = path.join(home, '.claude', 'CLAUDE.md'), codexMd = path.join(home, '.codex', 'AGENTS.md');
        const mine = '# Mine\r\n\r\nKeep this.\r\n', noFinalNewline = '- a list\n- last item';
        fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
        fs.writeFileSync(claudeMd, mine);
        fs.mkdirSync(path.dirname(codexMd), { recursive: true });
        fs.writeFileSync(codexMd, noFinalNewline);
        fs.mkdirSync(path.join(home, '.config', 'Code', 'User'), { recursive: true });
        fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
        fs.mkdirSync(path.join(home, '.vibe'));
        const status = (results, id) => results.find(r => r.id === id && r.label.includes('policy'))?.status;
        const general = path.join(home, '.lady-lens', 'lens-instructions.md');

        const first = runSkillInstall({ lensPath: LENS, env });
        for (const id of ['claude', 'codex', 'vibe', 'vscode', 'antigravity']) expect(status(first, id)).toBe('installed');
        expect(status(first, 'copilot')).toBeUndefined();
        expect(fs.readFileSync(general, 'utf8')).toContain('lady-lens first');
        const once = fs.readFileSync(claudeMd, 'utf8');
        expect(once.startsWith(`${mine}\r\n`)).toBe(true);
        expect(once.split('\r\n').filter(line => line.includes('lady-lens'))).toEqual([`Code search: @${general.split(path.sep).join('/')} <!-- lady-lens -->`]);
        expect(fs.readFileSync(path.join(home, '.vibe', 'AGENTS.md'), 'utf8')).toMatch(/^Code search: ALWAYS use the lady-lens MCP tools first .+Full rules: \[lady-lens instructions\]\(.+lens-instructions\.md\)/);
        expect(fs.readFileSync(path.join(home, '.gemini', 'config', 'rules', 'lady-lens.md'), 'utf8')).toMatch(/^---\ntrigger: always_on\n---/);
        expect(fs.readFileSync(path.join(home, '.config', 'Code', 'User', 'prompts', 'lady-lens.instructions.md'), 'utf8')).toMatch(/^---\napplyTo: '\*\*'\n---/);

        expect(status(runSkillInstall({ lensPath: LENS, env }), 'claude')).toBe('unchanged');
        expect(fs.readFileSync(claudeMd, 'utf8')).toBe(once);

        const removed = runSkillInstall({ lensPath: LENS, env, action: 'uninstall' });
        for (const id of ['claude', 'codex', 'vibe', 'vscode', 'antigravity']) expect(status(removed, id)).toBe('removed');
        expect(fs.readFileSync(claudeMd, 'utf8')).toBe(mine);
        expect(fs.readFileSync(codexMd, 'utf8')).toBe(`${noFinalNewline}\n`); // only a missing final newline is not given back
        expect(fs.existsSync(path.join(home, '.vibe', 'AGENTS.md'))).toBe(false); // we made it, only our line was in it
        expect(status(runSkillInstall({ lensPath: LENS, env, action: 'uninstall' }), 'claude')).toBe('absent');
    });

    it('registers lady-lens in the TOML configs of Codex and Mistral Vibe, and uninstall gives back every byte', () => {
        const codex = path.join(home, '.codex', 'config.toml'), vibe = path.join(home, '.vibe', 'config.toml');
        const codexMine = 'model = "x"\r\n\r\n[projects.\'c:\\git\']\r\ntrust_level = "trusted"\r\n', vibeMine = 'theme = "dracula"\n# lady-lens notes stay\n';
        fs.mkdirSync(path.dirname(codex), { recursive: true });
        fs.writeFileSync(codex, codexMine);
        fs.mkdirSync(path.dirname(vibe), { recursive: true });
        fs.writeFileSync(vibe, vibeMine);

        const first = run({ ids: ['codex', 'vibe'] });
        expect(first.map(r => r.status)).toEqual(['installed', 'installed']);
        const codexText = fs.readFileSync(codex, 'utf8'), vibeText = fs.readFileSync(vibe, 'utf8');
        expect(codexText.startsWith(`${codexMine}\r\n[mcp_servers.lady-lens]  # lady-lens:mcp\r\ncommand = `)).toBe(true);
        expect(codexText).toContain(`args = ${JSON.stringify([LENS, 'mcp', '--stdio'])}  # lady-lens:mcp`);
        expect(vibeText).toContain('[[mcp_servers]]  # lady-lens:mcp\nname = "lady-lens"  # lady-lens:mcp\ntransport = "stdio"  # lady-lens:mcp\n');
        expect(vibeText).toContain(`env = { LENS_MCP_VERSION = "${PACKAGE_VERSION}" }  # lady-lens:mcp`);
        expect(run({ ids: ['codex', 'vibe'] }).map(r => r.status)).toEqual(['unchanged', 'unchanged']);

        expect(run({ ids: ['codex', 'vibe'], action: 'uninstall' }).map(r => r.status)).toEqual(['removed', 'removed']);
        expect(fs.readFileSync(codex, 'utf8')).toBe(codexMine);
        expect(fs.readFileSync(vibe, 'utf8')).toBe(vibeMine);
        expect(run({ ids: ['codex'], action: 'uninstall' })[0].status).toBe('absent');

        const byHand = `${codexMine}[mcp_servers.lady-lens]\r\ncommand = "lens"\r\n`;
        fs.writeFileSync(codex, byHand);
        expect(run({ ids: ['codex'] })[0]).toMatchObject({ status: 'error', reason: expect.stringContaining('by hand') });
        expect(fs.readFileSync(codex, 'utf8')).toBe(byHand);
    });

    it('finds no agents on an empty machine', () => {
        const results = run();
        expect(results).toEqual([]);
        expect(formatAgentInstall(results).ok).toBe(false);
    });

    it('installs only into agents that are present, keeping their other servers', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        fs.writeFileSync(target('cursor').file, JSON.stringify({ mcpServers: { other: { url: 'x' } }, theme: 'dark' }));
        const results = run();
        expect(results.map(r => [r.id, r.status])).toEqual([['cursor', 'installed']]);
        const config = read(target('cursor').file);
        expect(config.theme).toBe('dark');
        expect(config.mcpServers.other).toEqual({ url: 'x' });
        expect(config.mcpServers['lady-lens']).toMatchObject({ command: process.execPath, args: [LENS, 'mcp', '--stdio'] });
        expect(fs.existsSync(`${target('cursor').file}.lady-lens.bak`)).toBe(true);
    });

    it('is idempotent: a second run changes nothing, a different entry is updated', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        expect(run()[0].status).toBe('installed');
        expect(run()[0].status).toBe('unchanged');
        expect(run({ repo: '/repo' })[0].status).toBe('updated');
        expect(read(target('cursor').file).mcpServers['lady-lens'].args).toEqual([LENS, 'mcp', '--stdio', '--repo', '/repo']);
    });

    it('updates an installed entry when its MCP version marker changes', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        fs.writeFileSync(target('cursor').file, JSON.stringify({ mcpServers: { 'lady-lens': { command: process.execPath, args: [LENS, 'mcp', '--stdio'], env: { LENS_MCP_VERSION: '0.0.0' } } } }));
        const result = run()[0];
        expect(result.status).toBe('updated');
        expect(read(target('cursor').file).mcpServers['lady-lens'].env.LENS_MCP_VERSION).toBe(PACKAGE_VERSION);
    });

    it('creates the config of a named agent, and VS Code gets servers + type stdio', () => {
        const results = run({ ids: ['vscode', 'claude-code'] });
        expect(results.map(r => r.status)).toEqual(['installed', 'installed']);
        expect(read(target('vscode').file).servers['lady-lens'].type).toBe('stdio');
        expect(read(target('claude-code').file).mcpServers['lady-lens'].type).toBeUndefined();
    });

    it('reports an unknown agent and a config it cannot parse, without touching the file', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        fs.writeFileSync(target('cursor').file, '{ // comment\n}');
        const results = run({ ids: ['cursor', 'nope'] });
        expect(results.find(r => r.id === 'nope').status).toBe('error');
        expect(results.find(r => r.id === 'cursor').status).toBe('error');
        expect(fs.readFileSync(target('cursor').file, 'utf8')).toBe('{ // comment\n}');
        expect(formatAgentInstall(results).ok).toBe(false);
    });

    it('dry run writes nothing', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        const results = run({ dryRun: true });
        expect(results[0].status).toBe('installed');
        expect(fs.existsSync(target('cursor').file)).toBe(false);
        expect(formatAgentInstall(results, { dryRun: true }).text).toContain('Dry run');
    });

    it('treats an empty config file as empty', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        fs.writeFileSync(target('cursor').file, '  ');
        expect(run()[0].status).toBe('installed');
    });

    it('uninstall removes only lady-lens and says so when it is absent', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        fs.writeFileSync(target('cursor').file, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
        run();
        expect(run({ action: 'uninstall' })[0].status).toBe('removed');
        expect(read(target('cursor').file).mcpServers).toEqual({ other: { url: 'x' } });
        expect(run({ action: 'uninstall' })[0].status).toBe('absent');
    });

    it('locates the desktop and VS Code configs per platform', () => {
        const win = agentTargets({ home, platform: 'win32', appData: path.join(home, 'Roaming') });
        const mac = agentTargets({ home, platform: 'darwin' });
        const winDefault = agentTargets({ home, platform: 'win32', appData: '' });
        expect(win.find(t => t.id === 'claude-desktop').file).toContain(path.join('Roaming', 'Claude'));
        expect(winDefault.find(t => t.id === 'vscode').file).toContain(path.join('AppData', 'Roaming', 'Code', 'User'));
        expect(mac.find(t => t.id === 'vscode').file).toContain(path.join('Library', 'Application Support', 'Code', 'User'));
        expect(serverEntry({ lensPath: LENS, typed: true }).type).toBe('stdio');
    });

    it('tells the user to restart the agent after a change', () => {
        fs.mkdirSync(path.join(home, '.cursor'));
        const { ok, text } = formatAgentInstall(run());
        expect(ok).toBe(true);
        expect(text).toContain('Restart the agent');
    });
});
