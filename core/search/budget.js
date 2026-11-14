// Context budget formatting voor tool results
import { contextBudget } from '../configuration/index.js';

/**
 * Cuts a result to the context budget. Shape options, applied in this order while the result is too big:
 *  - `drop: ['edges', 'context']`: fields that go first and whole (graph_query: the candidates matter more than the
 *    edges between them or a prose summary of them; 2026-11-13 a 4000-char answer held 2 of 10 nodes next to its context);
 *  - `texts`: clipped to half the budget;
 *  - `compact: { nodes: { keep: 3, to: node => ({ path, purpose }) } }`: items after the first `keep` become their short
 *    form, from the end, so a caller still sees every candidate;
 *  - `lists` are cut from the end, the last list first;
 *  - `nested: { files: 'matches' }`: an item of `files` loses its `matches` one by one before it goes itself (a single
 *    file over the budget left `files: []` with 20 matches counted);
 *  - `totals: { matches: 'totalCount' }`: the hint counts against that field (grep said "matches 35 of 50" next to
 *    totalCount 123: 50 was only the page);
 *  - `paged: 'matches'`: also gives `nextOffset`, where the next page starts.
 */
export function fitToBudget(result, shape = {}) {
    const { toolResultChars } = contextBudget();
    if (fits(result, toolResultChars)) return result;
    const { lists = [], texts = [], narrow = 'narrow the call' } = shape;
    const fitted = { ...result };
    const max = toolResultChars - 260; // room for the hint, which names what was left out
    const dropped = dropFields(fitted, shape.drop || [], max);
    for (const key of texts) clipText(fitted, key, Math.floor(toolResultChars / 2));
    for (const key of lists) if (Array.isArray(fitted[key])) fitted[key] = [...fitted[key]];
    const compacted = compactLists(fitted, shape.compact || {}, max);
    const cut = cutLists(fitted, lists, max, size, shape.nested || {});
    const omitted = cut.reduce((sum, { left, innerLeft }) => sum + left + innerLeft, 0);
    const paging = pagingOf(fitted, cut, shape.paged);
    const notes = [...dropped.map(key => `${key} left out`), ...compacted, ...shownLists(cut, result, shape.totals || {})].join(', ');
    const next = paging.nextOffset === undefined ? '' : ` (next page: offset ${paging.nextOffset})`;
    return { ...fitted, ...paging, truncated: true, ...(omitted ? { omitted } : {}), hint: `Result cut to the context budget${notes ? ` (${notes})` : ''}: ${narrow}${next}.` };
}

const size = value => JSON.stringify(value).length;

function fits(result, max) {
    if (!result || typeof result !== 'object' || result.error) return true;
    return size(result) <= max;
}

/** Removes whole fields, in order, until the result fits; the names it removed. */
function dropFields(fitted, keys, max) {
    const dropped = [];
    for (const key of keys) {
        if (size(fitted) <= max) break;
        if (fitted[key] === undefined) continue;
        delete fitted[key];
        dropped.push(key);
    }
    return dropped;
}

/** Turns items of one list after the first `keep` into their short form, from the end, until the result fits; a note or null. */
function compactList(fitted, key, { keep = 1, to }, max) {
    const list = fitted[key];
    let index = list.length - 1;
    while (index >= keep && size(fitted) > max) {
        list[index] = to(list[index]);
        index -= 1;
    }
    return index < list.length - 1 ? `${key} ${index + 2} to ${list.length} short` : null;
}

const compactLists = (fitted, compact, max) => Object.entries(compact).filter(([key]) => Array.isArray(fitted[key])).map(([key, spec]) => compactList(fitted, key, spec, max)).filter(Boolean);

// say per list what is shown: `matchCount: 8` next to 3 nodes read as a bug without it
const shownLists = (cut, result, totals) => cut.filter(({ left, innerLeft }) => left || innerLeft).map(entry => shownText(entry, result, totals));

function clipText(fitted, key, max) {
    if (typeof fitted[key] !== 'string' || fitted[key].length <= max) return;
    const end = fitted[key].lastIndexOf('\n', max);
    fitted[key] = fitted[key].slice(0, end > 0 ? end : max);
}

function shownText({ key, kept, left, innerLeft, inner }, result, totals) {
    const total = Math.max(kept + left, Number(result[totals[key]]) || 0);
    return `${key} ${kept} of ${total}${innerLeft ? `, ${innerLeft} ${inner} cut` : ''}`;
}

function pagingOf(fitted, cut, paged) {
    const entry = paged && cut.find(({ key }) => key === paged);
    return entry?.left ? { nextOffset: (Number(fitted.offset) || 0) + entry.kept } : {};
}

/** Takes one item off the end of `list`; with a nested list, first one of the last item's nested items. True when nested. */
function popOne(list, inner) {
    const last = list[list.length - 1];
    if (!inner || !Array.isArray(last?.[inner]) || last[inner].length <= 1) {
        list.pop();
        return false;
    }
    list[list.length - 1] = { ...last, [inner]: last[inner].slice(0, -1) };
    return true;
}

/** Drop items from the end of the last non-empty list until the result fits; per list how many were kept and left out. */
function cutLists(fitted, lists, max, size, nested) {
    const left = new Map(lists.map(key => [key, { items: 0, inner: 0 }]));
    while (size(fitted) > max) {
        const key = [...lists].reverse().find(name => Array.isArray(fitted[name]) && fitted[name].length);
        if (!key) break;
        const counts = left.get(key);
        if (popOne(fitted[key], nested[key])) counts.inner += 1;
        else counts.items += 1;
    }
    return lists.map(key => ({ key, kept: Array.isArray(fitted[key]) ? fitted[key].length : 0, left: left.get(key).items, innerLeft: left.get(key).inner, inner: nested[key] }));
}

export const withBudget = (fn, shape) => (args) => {
    const result = fn(args);
    return result && typeof result.then === 'function' ? result.then(value => fitToBudget(value, shape)) : fitToBudget(result, shape);
};
