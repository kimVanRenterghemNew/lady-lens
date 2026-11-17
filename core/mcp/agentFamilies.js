/**
 * One name per product: `lens install antigravity` covers the app and its CLI; `copilot` and `vscode` both cover VS Code,
 * the Copilot CLI and the Copilot skill/policy. The members are agent ids, skill ids and policy ids together.
 *
 * @module core/mcp/agentFamilies
 */
import fs from 'fs';

export const FAMILIES = {
    antigravity: ['antigravity', 'antigravity-cli'],
    copilot: ['vscode', 'copilot-cli', 'copilot'],
    claude: ['claude-code', 'claude-desktop', 'claude'],
    gemini: ['gemini-cli', 'gemini']
};
const ALIASES = { 'antigravity-windows': 'antigravity', vscode: 'copilot' };

export const findFamily = id => FAMILIES[ALIASES[id] ?? id] ?? null;

/** The members of a family for the MCP configs: the agents found on this machine, or all of them when none is found. */
function agentMembers(members, targets) {
    const agents = targets.filter(target => members.includes(target.id));
    const found = agents.filter(target => fs.existsSync(target.marker));
    return (found.length ? found : agents).map(target => target.id);
}

/**
 * `names` with every family replaced by its members. For skills and policies that is every member (they are small files);
 * for the MCP configs only the agents that are installed. A name that is no family stays as it is.
 */
function membersOf(id, small, targets) {
    const members = findFamily(id);
    return members && !small ? agentMembers(members, targets) : members;
}

export function expandFamilies(names, { skill, mendix, targets }) {
    const small = skill || mendix;
    return names.flatMap(id => membersOf(id, small, targets) ?? [id]);
}
