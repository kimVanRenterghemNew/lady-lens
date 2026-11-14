import fs from 'fs';
import path from 'path';
import { debug } from '../../observability/index.js';
import { mxcli, mxcliRows, mxcliPath } from './mxcli.js';
import { projectKey, startMdlExport } from './mendixExport.js';

export { writeMendixSources, runMdlExport, startMdlExport } from './mendixExport.js';
export function findMendixProject(root) {
    if (path.extname(root).toLowerCase() === '.mpr') return root;
    const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
    const p = entries.find(e => e.isFile() && path.extname(e.name).toLowerCase() === '.mpr');
    return p ? path.join(root, p.name) : null;
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

/**
 * The mxcli calls cost ~11 s on a big project (graph-report alone 7.6 s) and ran on every sync that changed any file.
 * Their answer only changes with the model: it is kept in .mxcli/lens-contribution.json under projectKey.
 */
const cacheFileOf = project => path.join(path.dirname(project), '.mxcli', 'lens-contribution.json');
const readCache = project => { try { return JSON.parse(fs.readFileSync(cacheFileOf(project), 'utf8')); } catch { return null; } };
const cachedContribution = (project, key) => { const cached = readCache(project); return cached?.key === key ? cached.contribution : null; };

/** True when `root` is a Mendix project whose mxcli answer is not cached for its current state (a sync must then write). */
export function mendixChanged(root) {
    const project = findMendixProject(root);
    return Boolean(project) && !cachedContribution(project, projectKey(project));
}

/**
 * An empty answer (no mxcli, it failed or hit its time limit) is stored too, so a no-change sync can skip the write and
 * a sync that writes asks again. It does not wipe the model: the previous answer is kept, stale, until mxcli answers.
 */
function remember(project, key, contribution) {
    const previous = previousModel(readCache(project));
    const empty = contribution.nodes.length === 0;
    fs.mkdirSync(path.dirname(cacheFileOf(project)), { recursive: true });
    fs.writeFileSync(cacheFileOf(project), JSON.stringify(empty ? { key, contribution, previous } : { key, contribution }));
    if (!empty || !previous) return contribution;
    debug(1, 'mendix', 'mxcli gave nothing: the previous Mendix model is kept');
    return previous;
}

/** The last model mxcli gave: the cached answer, or the one kept beside an empty answer. */
const previousModel = cached => [cached?.contribution, cached?.previous].find(model => model?.nodes?.length) || null;

export async function mendixContributor({ root }) {
    const project = findMendixProject(root);
    if (!project) return { nodes: [], relations: [] };
    const key = projectKey(project);
    const cached = cachedContribution(project, key);
    if (cached?.nodes.length) { debug(1, 'mendix', `${project}: unchanged project, cached contribution used`); return cached; }
    debug(1, 'mendix', `${project}: changed, asking ${mxcliPath()}`);
    const contribution = remember(project, key, await askMxcli(project));
    // after the questions: the export refreshes the catalog they read, and never holds up the sync
    debug(1, 'mendix', `MDL export: ${await startMdlExport(project)}`);
    return contribution;
}

async function askMxcli(project) {
    const [tree, structure, report, fields, requiredAttributes] = await Promise.all([
        mxcli(project, ['project-tree']), mxcli(project, ['structure', '-d', '3']),
        mxcli(project, ['graph-report']), mxcliRows(project, PAGE_WIDGETS_SQL),
        mxcliRows(project, REQUIRED_ATTRIBUTES_SQL)
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
