/**
 * The lady-lens MCP server in agents that keep their config in YAML (Hermes: `mcp_servers` in config.yaml).
 * The document is edited, not rebuilt, so comments and the order of the other keys stay.
 *
 * @module core/mcp/yamlInstall
 */
import fs from 'fs';
import YAML from 'yaml';
import { write } from './policyInstall.js';

const NAME = 'lady-lens';

function load(file) {
    const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    return doc;
}

const current = (doc, key) => doc.getIn([key, NAME], true)?.toJSON();

/** Load the document, let `change` edit it, and write only when `change` reports a change. */
function edit(target, dryRun, change) {
    let doc;
    try { doc = load(target.file); } catch (error) { return { status: 'error', reason: `cannot parse: ${error.message}` }; }
    const result = change(doc, current(doc, target.key));
    if (!dryRun && ['installed', 'updated', 'removed'].includes(result.status)) write(target.file, doc.toString());
    return result;
}

export function yamlInstall(target, entry, dryRun) {
    const wanted = { command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
    return edit(target, dryRun, (doc, before) => {
        if (JSON.stringify(before) === JSON.stringify(wanted)) return { status: 'unchanged' };
        doc.setIn([target.key, NAME], doc.createNode(wanted));
        return { status: before === undefined ? 'installed' : 'updated' };
    });
}

export function yamlUninstall(target, dryRun) {
    return edit(target, dryRun, (doc, before) => {
        if (before === undefined) return { status: 'absent' };
        doc.deleteIn([target.key, NAME]);
        return { status: 'removed' };
    });
}

/** The `--repo` a registered entry was started with, or null. */
export function yamlRepo(target) {
    try {
        const args = current(load(target.file), target.key)?.args ?? [];
        const at = args.indexOf('--repo');
        return at < 0 ? null : args[at + 1];
    } catch { return null; }
}
