/**
 * The "lady-lens first" policy where agents always look (a skill only loads when a task matches it).
 * The policy itself lives in one file of ours, `~/.lady-lens/lens-instructions.md`. A file the user owns (CLAUDE.md,
 * AGENTS.md, copilot-instructions.md) only gets ONE marked line that points there; uninstall removes exactly that line and
 * leaves every other byte as it was. Agents with a rules folder (VS Code, Antigravity) get a file of their own.
 *
 * @module core/mcp/policyInstall
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const MARK = '<!-- lady-lens -->';

export function policyTargets({ home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {}) {
    const vscodeUser = platform === 'win32' ? path.join(appData || path.join(home, 'AppData', 'Roaming'), 'Code', 'User')
        : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Code', 'User') : path.join(home, '.config', 'Code', 'User');
    // shortcut: ~/.lady-lens even when LENS_HOME points elsewhere; follow LENS_HOME when someone uses it for installs
    const general = path.join(home, '.lady-lens', 'lens-instructions.md');
    const link = (target) => ({ ...target, general, line: target.id === 'claude'
        ? `Code search: @${general.split(path.sep).join('/')} ${MARK}` // Claude Code imports an @path into the context
        // other agents do not follow a link by themselves: the rule itself is in the line, the file has the details
        : `Code search: ALWAYS use the lady-lens MCP tools first (grep, glob, searchView, definedIn, imports, importedBy, functionView, folderView, graph_query, read_chunk); use rg, grep, glob or shell search only when lady-lens is unavailable or finds nothing. Full rules: [lady-lens instructions](${general.split(path.sep).join('/')}). ${MARK}` });
    return [
        link({ id: 'claude', label: 'Claude policy', marker: path.join(home, '.claude'), file: path.join(home, '.claude', 'CLAUDE.md') }),
        link({ id: 'copilot', label: 'Copilot policy', marker: path.join(home, '.copilot'), file: path.join(home, '.copilot', 'copilot-instructions.md') }),
        link({ id: 'codex', label: 'Codex policy', marker: path.join(home, '.codex'), file: path.join(home, '.codex', 'AGENTS.md') }),
        link({ id: 'vibe', label: 'Mistral Vibe policy', marker: path.join(home, '.vibe'), file: path.join(home, '.vibe', 'AGENTS.md') }),
        { id: 'vscode', label: 'VS Code policy', marker: vscodeUser, file: path.join(vscodeUser, 'prompts', 'lady-lens.instructions.md'), general, header: "---\napplyTo: '**'\n---\n\n" },
        { id: 'antigravity', label: 'Antigravity policy', marker: path.join(home, '.gemini', 'config'), file: path.join(home, '.gemini', 'config', 'rules', 'lady-lens.md'), general, header: '---\ntrigger: always_on\n---\n\n' }
    ];
}

function handleMarkedLine(kept) {
    if (/^\r?\n$/.test(kept[kept.length - 1] ?? '')) kept.pop();
}

/** `text` without the lines that carry `mark` and the blank line `withLink` put before them; every other byte stays. */
export function withoutLink(text, mark = MARK) {
    const kept = [];
    for (const line of text.split(/(?<=\n)/)) {
        if (line.includes(mark)) {
            handleMarkedLine(kept);
        } else {
            kept.push(line);
        }
    }
    return kept.join('');
}

/** `text` with our marked line(s) once, at the end, after a blank line, in the file's own line ending. */
export function withLink(text, lines, mark = MARK) {
    const rest = withoutLink(text, mark);
    const eol = rest.includes('\r\n') ? '\r\n' : '\n';
    return `${rest}${rest && !rest.endsWith('\n') ? eol : ''}${rest ? eol : ''}${[lines].flat().join(eol)}${eol}`;
}

export function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.lady-lens.bak`);
    fs.writeFileSync(file, text);
}

const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

export function installPolicy(target, policy, dryRun) {
    const before = read(target.file);
    const after = target.header !== undefined ? `${target.header}${policy.trim()}\n` : withLink(before ?? '', target.line);
    if (!dryRun && read(target.general) !== policy) write(target.general, policy);
    if (after === before) return { status: 'unchanged' };
    if (!dryRun) write(target.file, after);
    return { status: before !== null && (target.header !== undefined || before.includes(MARK)) ? 'updated' : 'installed' };
}

export function uninstallPolicy(target, dryRun) {
    const before = read(target.file);
    if (before === null || (target.header === undefined && !before.includes(MARK))) return { status: 'absent' };
    if (!dryRun) {
        const clean = target.header === undefined ? withoutLink(before) : null;
        if (clean) write(target.file, clean);
        else fs.rmSync(target.file, { force: true });
    }
    return { status: 'removed' };
}
