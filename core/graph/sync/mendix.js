import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
export function findMendixProject(root) {
    if (path.extname(root).toLowerCase() === '.mpr') return root;
    const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
    const project = entries.find(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mpr');
    return project ? path.join(root, project.name) : null;
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
    try {
        const { stdout } = await execFileAsync(mxcliPath, [...command, '-p', project, '--json'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        return parseJsonOutput(stdout);
    } catch {
        return null;
    }
}

function elementNodes(tree, nodes, relations, parent = null) {
    if (!Array.isArray(tree)) return;
    for (const item of tree) {
        if (!item || typeof item !== 'object') continue;
        const qualifiedName = item.qualifiedName || (item.type && item.label ? `${parent || 'project'}.${item.label}` : null);
        const id = qualifiedName ? `mendix:${item.type || 'element'}:${qualifiedName}` : null;
        if (id) {
            nodes.push({ id, type: 'MendixElement', path: id, name: item.label || qualifiedName, kind: item.type, scope: 'project', metadata: { language: 'mendix', qualifiedName, elementType: item.type, describable: item.describable === true } });
            if (parent) relations.push({ from: `mendix:module:${parent}`, to: id, type: 'CONTAINS' });
        }
        elementNodes(item.children, nodes, relations, qualifiedName || parent);
    }
}

const PAGE_WIDGETS_SQL = "SELECT ContainerQualifiedName AS page, Name AS widget, WidgetType AS widgetType, AttributeRef AS attribute, MicroflowRef AS microflow, NanoflowRef AS nanoflow FROM CATALOG.widgets WHERE ContainerType = 'PAGE' AND (AttributeRef <> '' OR MicroflowRef <> '' OR NanoflowRef <> '')";
const REQUIRED_ATTRIBUTES_SQL = "SELECT EntityQualifiedName AS entity, Name AS name FROM CATALOG.attributes WHERE IsRequired = 1";

// Required comes from the attribute's validation, which is what Studio Pro shows as the red star.
function pageFieldNodes(rows, requiredAttributes, nodes, relations) {
    if (!Array.isArray(rows)) return;
    const required = new Set((Array.isArray(requiredAttributes) ? requiredAttributes : []).map(row => `${row.entity}.${row.name}`));
    for (const row of rows) {
        if (!row?.page || !row.widget) continue;
        const id = `mendix:field:${row.page}.${row.widget}`;
        nodes.push({ id, type: 'MendixPageField', path: id, name: row.widget, kind: row.widgetType, scope: 'project', metadata: { language: 'mendix', page: row.page, attribute: row.attribute, required: required.has(row.attribute) } });
        relations.push({ from: `mendix:page:${row.page}`, to: id, type: 'CONTAINS' });
        if (row.microflow) relations.push({ from: id, to: `mendix:microflow:${row.microflow}`, type: 'REFERENCES' });
        if (row.nanoflow) relations.push({ from: id, to: `mendix:nanoflow:${row.nanoflow}`, type: 'REFERENCES' });
    }
}

const safeSegment = (value) => String(value).replace(/[^\w.-]/g, '_').replace(/^\.+/, '_');

// mxcli's -c output folds SourceText onto one line, so the text is read from its catalog.db (the FTS5 content table).
async function readSourceRows(catalog) {
    if (!fs.existsSync(catalog)) return [];
    try {
        const { DatabaseSync } = await import('node:sqlite'); // shortcut: Node 22.5+ only; older Node skips the MDL export
        const db = new DatabaseSync(catalog, { readOnly: true });
        try { return db.prepare('SELECT c0 AS name, c1 AS type, c2 AS text FROM source_content').all(); } finally { db.close(); }
    } catch {
        return [];
    }
}

/**
 * Widget and flow settings (a picker's FilterType, a microflow's actions) live only in the binary .mpr. mxcli's MDL text
 * of every document is written to .mxcli/mdl/<Module>/<Name>.<type>.mdl, so lens grep/glob/read_chunk find them.
 * The catalog keeps the text per unit hash: the refresh only describes what changed (the first build is slow).
 */
export async function writeMendixSources(project, mxcliPath) {
    await mxcli(project, ['-c', 'refresh catalog full source'], mxcliPath);
    const rows = await readSourceRows(path.join(path.dirname(project), '.mxcli', 'catalog.db'));
    if (rows.length === 0) return 0; // keep the previous export when there is no source index
    const dir = path.join(path.dirname(project), '.mxcli', 'mdl');
    fs.rmSync(dir, { recursive: true, force: true });
    let written = 0;
    for (const row of rows) {
        if (!row?.name || typeof row.text !== 'string') continue;
        const [module, ...rest] = String(row.name).split('.');
        const file = path.join(dir, safeSegment(module), `${safeSegment(rest.join('.') || module)}.${safeSegment(String(row.type || 'document').toLowerCase())}.mdl`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, row.text);
        written += 1;
    }
    return written;
}

/**
 * The mxcli calls cost ~11 s on a big project (graph-report alone 7.6 s) and ran on every sync that changed any file.
 * Their answer only changes with the .mpr: it is kept in .mxcli/lens-contribution.json under the size and mtime of the .mpr.
 */
export async function mendixContributor({ root }) {
    const project = findMendixProject(root);
    if (!project) return { nodes: [], relations: [] };
    const stat = fs.statSync(project);
    const key = `${stat.size}:${stat.mtimeMs}:${process.env.LENS_MXCLI_PATH || 'mxcli'}`;
    const cacheFile = path.join(path.dirname(project), '.mxcli', 'lens-contribution.json');
    try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached.key === key) return cached.contribution;
    } catch { /* no cache yet, or unreadable: ask mxcli */ }
    const contribution = await askMxcli(project);
    if (contribution.nodes.length) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ key, contribution }));
    }
    return contribution;
}

async function askMxcli(project) {
    const mxcliPath = process.env.LENS_MXCLI_PATH || 'mxcli';
    await writeMendixSources(project, mxcliPath);
    const [tree, structure, report, fields, requiredAttributes] = await Promise.all([
        mxcli(project, ['project-tree'], mxcliPath),
        mxcli(project, ['structure', '-d', '3'], mxcliPath),
        mxcli(project, ['graph-report'], mxcliPath),
        mxcli(project, ['-c', PAGE_WIDGETS_SQL], mxcliPath),
        mxcli(project, ['-c', REQUIRED_ATTRIBUTES_SQL], mxcliPath)
    ]);
    if (!tree && !structure && !report && !fields) return { nodes: [], relations: [] };
    const nodes = [{ id: `mendix:project:${project}`, type: 'MendixProject', path: project, name: path.basename(project), scope: 'project', metadata: { language: 'mendix', project, structure, report } }];
    const relations = [];
    for (const module of Array.isArray(structure) ? structure : []) {
        if (!module.Module) continue;
        const id = `mendix:module:${module.Module}`;
        nodes.push({ id, type: 'MendixModule', path: id, name: module.Module, scope: 'project', metadata: { language: 'mendix', counts: module } });
        relations.push({ from: `mendix:project:${project}`, to: id, type: 'CONTAINS' });
    }
    elementNodes(tree, nodes, relations);
    pageFieldNodes(fields, requiredAttributes, nodes, relations);
    return { nodes, relations };
}