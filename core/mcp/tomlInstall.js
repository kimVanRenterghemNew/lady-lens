/**
 * The lady-lens MCP server in agents that keep their config in TOML (Codex, Mistral Vibe), without a TOML library:
 * a block appended at the end where every line ends in `# lady-lens:mcp`, so uninstall removes exactly those lines and the
 * rest of the file stays byte for byte. A lady-lens entry written by hand is left alone (a second one breaks the file).
 *
 * @module core/mcp/tomlInstall
 */
import fs from 'fs';
import { withLink, withoutLink, write } from './policyInstall.js';

const MARK = '# lady-lens:mcp';
const toml = value => (typeof value === 'object' && !Array.isArray(value)
    ? `{ ${Object.entries(value).map(([key, item]) => `${key} = ${JSON.stringify(item)}`).join(', ')} }`
    : JSON.stringify(value)); // JSON strings and arrays of strings are valid TOML

/** The block for `entry` ({ command, args, env? }) in the dialect of `target.toml` ('codex' or 'vibe'). */
export function tomlBlock(dialect, entry) {
    const fields = { command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
    const head = dialect === 'vibe' ? ['[[mcp_servers]]', 'name = "lady-lens"', 'transport = "stdio"'] : ['[mcp_servers.lady-lens]'];
    return [...head, ...Object.entries(fields).map(([key, value]) => `${key} = ${toml(value)}`)].map(line => `${line}  ${MARK}`);
}

const byHand = text => /^\s*\[mcp_servers\.["']?lady-lens["']?\]|^\s*name\s*=\s*["']lady-lens["']/m.test(withoutLink(text, MARK));

export function tomlInstall(target, entry, dryRun) {
    const before = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : null;
    if (before !== null && byHand(before)) return { status: 'error', reason: 'lady-lens is already configured by hand; left as it is' };
    const after = withLink(before ?? '', tomlBlock(target.toml, entry), MARK);
    if (after === before) return { status: 'unchanged' };
    if (!dryRun) write(target.file, after);
    return { status: before?.includes(MARK) ? 'updated' : 'installed' };
}

export function tomlUninstall(target, dryRun) {
    const before = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : null;
    if (before === null || !before.includes(MARK)) return { status: 'absent' };
    if (!dryRun) write(target.file, withoutLink(before, MARK));
    return { status: 'removed' };
}
