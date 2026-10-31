/**
 * decisions as nodes. A decisions document (backlog/besluiten.md) lists, under `## <date>` headings, one
 * decision per `- **Title**: text` bullet; `(vervangt: <title>)` in the text supersedes an older decision with that title.
 * Pure: the sync stores the parsed list on the document, loading turns it into Decision nodes.
 */
const DATE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})/;
const BULLET = /^-\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/;
const SUPERSEDES = /\(vervangt:?\s*([^)]+)\)/i;

/** @returns {Array<{date: string, title: string, text: string, line: number, supersedes?: string}>} */
export function parseDecisions(source) {
    const decisions = [];
    let date = null;
    String(source).split(/\r?\n/).forEach((raw, index) => {
        const heading = raw.match(DATE_HEADING);
        if (heading) { date = heading[1]; return; }
        if (/^#{1,2}\s/.test(raw)) { date = null; return; }
        const bullet = date && raw.match(BULLET);
        if (!bullet) return;
        const text = bullet[2].trim();
        const replaced = text.match(SUPERSEDES)?.[1]?.trim();
        decisions.push({ date, title: bullet[1].trim(), text, line: index + 1, ...(replaced ? { supersedes: replaced } : {}) });
    });
    return decisions;
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * Decision nodes (and SUPERSEDES edges) for one document that carries `decisions`. Current decisions only, unless `history`.
 * @returns {{nodes: object[], edges: Array<{from: string, to: string, type: 'SUPERSEDES'}>}}
 */
export function decisionNodes(doc, { history = false } = {}) {
    const list = Array.isArray(doc?.decisions) ? doc.decisions : [];
    const nodes = list.map(d => ({
        id: `decision:${doc.path}#${d.line}-${slug(d.title)}`, type: 'Decision', kind: 'decision', scope: doc.scope, path: doc.path,
        name: d.title, purpose: d.text, date: d.date, line: d.line, status: 'current'
    }));
    const byTitle = new Map(nodes.map(node => [node.name.toLowerCase(), node]));
    const edges = [];
    list.forEach((d, i) => {
        const old = d.supersedes && byTitle.get(d.supersedes.toLowerCase());
        if (!old || old === nodes[i]) return;
        old.status = 'superseded';
        old.supersededBy = nodes[i].name;
        edges.push({ from: nodes[i].id, to: old.id, type: 'SUPERSEDES' });
    });
    if (history) return { nodes, edges };
    const shown = nodes.filter(node => node.status === 'current');
    const ids = new Set(shown.map(node => node.id));
    return { nodes: shown, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
}
