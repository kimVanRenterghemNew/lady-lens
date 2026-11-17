/**
 * The tables of agents we know: where each one keeps its MCP servers and its skills.
 *
 * @module core/mcp/agentTargets
 */
import os from 'os';
import path from 'path';

const SERVER = 'lady-lens';

/** The agents we know: `marker` says it is installed, `file`/`key` say where its MCP servers live. */
export function agentTargets({ home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {}) {
    const roaming = path.join(appData || path.join(home, 'AppData', 'Roaming'));
    const appSupport = (app, ...rest) => platform === 'win32'
        ? path.join(roaming, app, ...rest)
        : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', app, ...rest) : path.join(home, '.config', app, ...rest);
    const target = (id, label, marker, file, extra = {}) => ({ id, label, marker, file, key: 'mcpServers', typed: false, ...extra });
    // Amp and Devin: %APPDATA%\<app> on Windows, ~/.config/<app> elsewhere (also on macOS)
    const cliConfig = (app, ...rest) => platform === 'win32' ? path.join(roaming, app, ...rest) : path.join(home, '.config', app, ...rest);
    return [
        target('claude-code', 'Claude Code', path.join(home, '.claude.json'), path.join(home, '.claude.json')),
        target('claude-desktop', 'Claude Desktop', appSupport('Claude'), appSupport('Claude', 'claude_desktop_config.json')),
        target('cursor', 'Cursor', path.join(home, '.cursor'), path.join(home, '.cursor', 'mcp.json')),
        target('windsurf', 'Windsurf', path.join(home, '.codeium', 'windsurf'), path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
        target('gemini-cli', 'Gemini CLI', path.join(home, '.gemini', 'settings.json'), path.join(home, '.gemini', 'settings.json')),
        target('antigravity', 'Antigravity', path.join(home, '.gemini', 'antigravity'), path.join(home, '.gemini', 'antigravity', 'mcp_config.json')),
        // the Antigravity CLI reads ~/.gemini/config/mcp_config.json, stdio or Streamable HTTP only (an /sse url fails there)
        target('antigravity-cli', 'Antigravity CLI', path.join(home, '.gemini', 'antigravity-cli'), path.join(home, '.gemini', 'config', 'mcp_config.json')),
        target('vscode', 'VS Code', appSupport('Code', 'User'), appSupport('Code', 'User', 'mcp.json'), { key: 'servers', typed: true }),
        target('codex', 'Codex', path.join(home, '.codex'), path.join(home, '.codex', 'config.toml'), { toml: 'codex' }),
        target('vibe', 'Mistral Vibe', path.join(home, '.vibe'), path.join(home, '.vibe', 'config.toml'), { toml: 'vibe' }),
        target('copilot-cli', 'Copilot CLI', path.join(home, '.copilot'), path.join(home, '.copilot', 'mcp-config.json'), { typed: false, entry: { type: 'local', tools: ['*'] } }),
        target('kiro', 'Kiro', path.join(home, '.kiro'), path.join(home, '.kiro', 'settings', 'mcp.json')),
        target('amazon-q', 'Amazon Q', path.join(home, '.aws', 'amazonq'), path.join(home, '.aws', 'amazonq', 'mcp.json')),
        target('droid', 'Factory Droid', path.join(home, '.factory'), path.join(home, '.factory', 'mcp.json'), { typed: true }),
        target('kimi', 'Kimi', path.join(home, '.kimi'), path.join(home, '.kimi', 'mcp.json')),
        target('amp', 'Amp', cliConfig('amp'), cliConfig('amp', 'settings.json'), { key: 'amp.mcpServers' }),
        target('trae', 'Trae', appSupport('Trae', 'User'), appSupport('Trae', 'User', 'mcp.json')),
        target('codebuddy', 'CodeBuddy', path.join(home, '.codebuddy'), path.join(home, '.codebuddy', '.mcp.json')),
        target('devin', 'Devin', cliConfig('devin'), cliConfig('devin', 'mcp_config.json')),
        target('pi', 'Pi', path.join(home, '.pi', 'agent'), path.join(home, '.pi', 'agent', 'mcp.json')),
        target('hermes', 'Hermes', path.join(home, '.hermes'), path.join(home, '.hermes', 'config.yaml'), { key: 'mcp_servers', yaml: true }),
        // OpenCode and Kilo: servers under `mcp`, command as one array
        target('opencode', 'OpenCode', path.join(home, '.config', 'opencode'), path.join(home, '.config', 'opencode', 'opencode.json'), { key: 'mcp', local: true }),
        target('kilo', 'Kilo', path.join(home, '.config', 'kilo'), path.join(home, '.config', 'kilo', 'kilo.json'), { key: 'mcp', local: true })
    ];
}

export function skillTargets({ home = os.homedir() } = {}, name = SERVER) {
    // [id, label, config folder under home] — skills live in `<folder>/skills/<name>/SKILL.md`; the folders follow graphify's platform list
    const folders = [
        ['claude', 'Claude', ['.claude']], ['copilot', 'Copilot', ['.copilot']], ['agents', 'Agents', ['.agents']],
        ['gemini', 'Gemini', ['.gemini']], ['kiro', 'Kiro', ['.kiro']],
        ['opencode', 'OpenCode', ['.config', 'opencode']], ['kilo', 'Kilo', ['.config', 'kilo']],
        ['droid', 'Factory Droid', ['.factory']], ['trae', 'Trae', ['.trae']], ['trae-cn', 'Trae CN', ['.trae-cn']],
        ['hermes', 'Hermes', ['.hermes']], ['kimi', 'Kimi', ['.kimi']], ['claw', 'OpenClaw', ['.openclaw']],
        ['pi', 'Pi', ['.pi', 'agent']], ['codebuddy', 'CodeBuddy', ['.codebuddy']], ['amp', 'Amp', ['.config', 'agents']],
        ['devin', 'Devin', ['.config', 'devin']]
    ];
    return folders.map(([id, label, dir]) => {
        const base = path.join(home, ...dir);
        return { id, label: `${label} skill`, marker: base, file: path.join(base, 'skills', name, 'SKILL.md') };
    });
}
