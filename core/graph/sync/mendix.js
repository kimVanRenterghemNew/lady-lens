import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { debug } from '../../observability/index.js';

const execFileAsync = promisify(execFile);
export function findMendixProject(root) {
    if (path.extname(root).toLowerCase() === '.mpr') return root;
    const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
    const p = entries.find(e => e.isFile() && path.extname(e.name).toLowerCase() === '.mpr');
    return p ? path.join(root, p.name) : null;
}

function parseJsonOutput(output) {
    const text = String(output).trim();
    const starts = [text.indexOf('['), text.indexOf('{')].filter(index => index >= 0).sort((a, b) => a - b);
    for (const start of starts) {
        try { return JSON.parse(text.slice(start)); } catch { /* mxcli may print warnings after JSON */ }
    }
    return null;
}
async function mxcli(project, command, mxcliPath) {
    const started = Date.now();
    try {
        const { stdout } = await execFileAsync(mxcliPath, [...command, '-p', project, '--json'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        debug(1, 'mxcli', () => `${mxcliPath} ${command.join(' ')}: ${Date.now() - started} ms, ${stdout.length} chars`);
        return parseJsonOutput(stdout);
    } catch (error) {
        debug(1, 'mxcli', () => `${mxcliPath} ${command.join(' ')}: FAILED after ${Date.now() - started} ms: ${error.message}${error.stderr ? `\nstderr: ${String(error.stderr).slice(0, 2000)}` : ''}`);
        return null;
    }
}

// mxcli aborts a catalog query past 10,000 output lines (4,184 widgets did): ask page by page; a failed page keeps what came
const PAGE_ROWS = 500;
async function mxcliRows(project, sql, mxcliPath) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
        const page = await mxcli(project, ['-c', `${sql} LIMIT ${PAGE_ROWS} OFFSET ${offset}`], mxcliPath);
        if (!Array.isArray(page)) return offset ? rows : mxcli(project, ['-c', sql], mxcliPath); // no LIMIT support: one query
        rows.push(...page);
        if (page.length < PAGE_ROWS) return rows;
    }
}

const elementQName = (item, parent) => item.qualifiedName || (item.type && item.label ? `${parent || 'project'}.${item.label}` : null);
const elementNodeId = (type, qName) => qName ? `mendix:${type || 'element'}:${qName}` : null;
const pushElementNode = (id, item, qName, parent, nodes, rels) => {
    nodes.push({ id, type: 'MendixElement', path: id, name: item.label || qName, kind: item.type, scope: 'project', metadata: { language: 'mendix', qualifiedName: qName, elementType: item.type, describable: item.describable === true } });
    if (parent) rels.push({ from: `mendix:module:${parent}`, to: id, type: 'CONTAINS' });
};

function addElementItem(item, nodes, rels, parent) {
    if (!item || typeof item !== 'object') return;
    const qName = elementQName(item, parent);
    const id = elementNodeId(item.type, qName);
    if (id) pushElementNode(id, item, qName, parent, nodes, rels);
    elementNodes(item.children, nodes, rels, qName || parent);
}

function elementNodes(tree, nodes, relations, parent = null) {
    if (Array.isArray(tree)) for (const item of tree) addElementItem(item, nodes, relations, parent);
}

const PAGE_WIDGETS_SQL = "SELECT ContainerQualifiedName AS page, Name AS widget, WidgetType AS widgetType, AttributeRef AS attribute, MicroflowRef AS microflow, NanoflowRef AS nanoflow FROM CATALOG.widgets WHERE ContainerType = 'PAGE' AND (AttributeRef <> '' OR MicroflowRef <> '' OR NanoflowRef <> '')";
const REQUIRED_ATTRIBUTES_SQL = "SELECT EntityQualifiedName AS entity, Name AS name FROM CATALOG.attributes WHERE IsRequired = 1";

const pushFieldFlowRefs = (id, row, rels) => {
    if (row.microflow) rels.push({ from: id, to: `mendix:microflow:${row.microflow}`, type: 'REFERENCES' });
    if (row.nanoflow) rels.push({ from: id, to: `mendix:nanoflow:${row.nanoflow}`, type: 'REFERENCES' });
};

function addPageFieldRow(row, required, nodes, relations) {
    if (!row?.page || !row.widget) return;
    const id = `mendix:field:${row.page}.${row.widget}`;
    nodes.push({ id, type: 'MendixPageField', path: id, name: row.widget, kind: row.widgetType, scope: 'project', metadata: { language: 'mendix', page: row.page, attribute: row.attribute, required: required.has(row.attribute) } });
    relations.push({ from: `mendix:page:${row.page}`, to: id, type: 'CONTAINS' });
    pushFieldFlowRefs(id, row, relations);
}
// Required comes from the attribute's validation, which is what Studio Pro shows as the red star.
function pageFieldNodes(rows, requiredAttributes, nodes, relations) {
    if (!Array.isArray(rows)) return;
    const required = new Set((Array.isArray(requiredAttributes) ? requiredAttributes : []).map(row => `${row.entity}.${row.name}`));
    for (const row of rows) addPageFieldRow(row, required, nodes, relations);
}

const safeSegment = (value) => String(value).replace(/[^\w.-]/g, '_').replace(/^\.+/, '_');

// mxcli's -c output folds SourceText onto one line, so the text is read from its catalog.db (the FTS5 content table).
// process.getBuiltinModule (Node 20.16+/22.3+) answers synchronously; on older Node there is no node:sqlite either
const canExportMdl = () => { try { return Boolean(process.getBuiltinModule?.('node:sqlite')); } catch { return false; } };

async function loadSqlite() {
    try { return (await import('node:sqlite')).DatabaseSync; } catch {
        console.warn(`lady-lens: Node ${process.version} has no node:sqlite (Node 22.13+ needed); Mendix text not exported. Run: lens node <newer node.exe>`);
        return null;
    }
}

function readSourceRows(catalog, DatabaseSync) {
    if (!fs.existsSync(catalog)) return [];
    try {
        const db = new DatabaseSync(catalog, { readOnly: true });
        try { return db.prepare('SELECT c0 AS name, c1 AS type, c2 AS text FROM source_content').all(); } finally { db.close(); }
    } catch { return []; }
}

function sourceDocPath(dir, row) {
    const [module, ...rest] = String(row.name).split('.');
    return path.join(dir, safeSegment(module), `${safeSegment(rest.join('.') || module)}.${safeSegment(String(row.type || 'document').toLowerCase())}.mdl`);
}

function writeSourceDoc(dir, row) {
    if (!row || !row.name || typeof row.text !== 'string') return 0;
    const file = sourceDocPath(dir, row);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, row.text);
    return 1;
}

/**
 * Widget and flow settings (a picker's FilterType, a microflow's actions) live only in the binary .mpr. mxcli's MDL text
 * of every document is written to .mxcli/mdl/<Module>/<Name>.<type>.mdl, so lens grep/glob/read_chunk find them.
 * The catalog keeps the text per unit hash: the refresh only describes what changed (the first build is slow).
 */
export async function writeMendixSources(project, mxcliPath) {
    // without node:sqlite the catalog cannot be read: skip the refresh, which took 17 min on a first build
    const DatabaseSync = await loadSqlite();
    if (!DatabaseSync) return 0;
    await mxcli(project, ['-c', 'refresh catalog full source'], mxcliPath);
    const rows = readSourceRows(path.join(path.dirname(project), '.mxcli', 'catalog.db'), DatabaseSync);
    if (rows.length === 0) return 0; // keep the previous export when there is no source index
    const dir = path.join(path.dirname(project), '.mxcli', 'mdl');
    fs.rmSync(dir, { recursive: true, force: true });
    let written = 0;
    for (const row of rows) written += writeSourceDoc(dir, row);
    return written;
}

/**
 * The mxcli calls cost ~11 s on a big project (graph-report alone 7.6 s) and ran on every sync that changed any file.
 * Their answer only changes with the .mpr: it is kept in .mxcli/lens-contribution.json under the size and mtime of the .mpr.
 */
// An MPR v2 project (Mendix 10+) keeps its documents in mprcontents/ next to a small .mpr: both make up the stamp.
function projectKey(project) {
    const stat = fs.statSync(project);
    let files = 0, newest = 0;
    const walk = dir => {
        for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
            else { files += 1; newest = Math.max(newest, fs.statSync(path.join(dir, entry.name)).mtimeMs); }
        }
    };
    walk(path.join(path.dirname(project), 'mprcontents'));
    return `${stat.size}:${stat.mtimeMs}:${files}:${newest}:${process.env.LENS_MXCLI_PATH || 'mxcli'}:mdl=${canExportMdl()}`;
}
const cacheFileOf = project => path.join(path.dirname(project), '.mxcli', 'lens-contribution.json');
const cachedContribution = (project, key) => { try { const cached = JSON.parse(fs.readFileSync(cacheFileOf(project), 'utf8')); return cached.key === key ? cached.contribution : null; } catch { return null; } };

/** True when `root` is a Mendix project whose mxcli answer is not cached for its current state (a sync must then write). */
export function mendixChanged(root) {
    const project = findMendixProject(root);
    return Boolean(project) && !cachedContribution(project, projectKey(project));
}

export async function mendixContributor({ root }) {
    const project = findMendixProject(root);
    if (!project) return { nodes: [], relations: [] };
    const key = projectKey(project), cacheFile = cacheFileOf(project);
    const cached = cachedContribution(project, key);
    if (cached?.nodes.length) { debug(1, 'mendix', `${project}: unchanged project, cached contribution used`); return cached; }
    debug(1, 'mendix', `${project}: changed, asking ${process.env.LENS_MXCLI_PATH || 'mxcli'}`);
    const contribution = await askMxcli(project);
    // an empty answer (no mxcli, or it failed) is stored too: mendixChanged then lets a no-change sync skip the write,
    // while a sync that does write asks mxcli again (above, only a non-empty cache is reused)
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ key, contribution }));
    return contribution;
}

async function askMxcli(project) {
    const mxcliPath = process.env.LENS_MXCLI_PATH || 'mxcli';
    debug(1, 'mendix', `MDL export: ${await writeMendixSources(project, mxcliPath)} documents written to .mxcli/mdl`);
    const [tree, structure, report, fields, requiredAttributes] = await Promise.all([
        mxcli(project, ['project-tree'], mxcliPath), mxcli(project, ['structure', '-d', '3'], mxcliPath),
        mxcli(project, ['graph-report'], mxcliPath), mxcliRows(project, PAGE_WIDGETS_SQL, mxcliPath),
        mxcliRows(project, REQUIRED_ATTRIBUTES_SQL, mxcliPath)
    ]);
    if (!tree && !structure && !report && !fields) return { nodes: [], relations: [] };
    const nodes = [{ id: `mendix:project:${project}`, type: 'MendixProject', path: project, name: path.basename(project), scope: 'project', metadata: { language: 'mendix', project, structure, report } }];
    const relations = [];
    for (const module of (Array.isArray(structure) ? structure : []).filter(m => m?.Module)) {
        const id = `mendix:module:${module.Module}`;
        nodes.push({ id, type: 'MendixModule', path: id, name: module.Module, scope: 'project', metadata: { language: 'mendix', counts: module } });
        relations.push({ from: `mendix:project:${project}`, to: id, type: 'CONTAINS' });
    }
    elementNodes(tree, nodes, relations);
    pageFieldNodes(fields, requiredAttributes, nodes, relations);
    return { nodes, relations };
}