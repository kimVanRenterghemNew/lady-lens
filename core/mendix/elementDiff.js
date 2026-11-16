/**
 * What changed inside one Mendix document, element by element. An element is an object with a $ID. It is reported on its
 * own when it has a Name or Caption, or sits in a collection; a smaller nameless part folds
 * into its owner as a property path such as `Action > ParameterMappings`.
 * @module core/mendix/elementDiff
 */

import { nodeSummary } from './flows.js';

const COLLECTIONS = new Set(['Microflows$MicroflowObjectCollection']);
const isElement = value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.$ID === 'string';
const items = list => (typeof list[0] === 'number' && list.length > 0 ? list.slice(1) : list);
const textOf = value => (typeof value === 'string' ? value : null);

const elementName = el => textOf(el.Name) ?? textOf(el.Caption) ?? null;
const elementDetail = el => (el.Action || el.SplitCondition ? nodeSummary(el) : null);

export function labelOf(element) {
    const detail = elementDetail(element);
    return { type: element.$Type, name: elementName(element), ...(detail ? { detail } : {}) };
}

const isTranslationProp = path => Boolean(path && /(?:^|\s*>\s*)(?:Translations?|Texts?)\b/i.test(path));
const isLayoutProp = path => Boolean(path && /(?:^|\s*>\s*)(?:Position|Width|Height|Class|Left|Top|Bottom|Right|Bounds|Margin|Padding|Alignment)\b/i.test(path));
const hasIgnore = (ignore, key, test) => Boolean(ignore?.includes(key) && test);

function matchIgnore(path, ignore) {
    if (hasIgnore(ignore, 'translations', isTranslationProp(path))) return 'translations';
    if (hasIgnore(ignore, 'layout', isLayoutProp(path))) return 'layout';
    return null;
}

export function isPropIgnored(path, options = {}) {
    const kind = matchIgnore(path, options.ignore);
    if (!kind) return false;
    if (options.ignored) options.ignored[kind] = (options.ignored[kind] || 0) + 1;
    return true;
}

const itemKey = item => (item && typeof item === 'object' ? item.Parameter || item.Name || item.Key || item.$ID || null : null);

function checkItemDiff(k, item, bMap) {
    if (!bMap.has(k)) return { change: 'added', key: k, item };
    if (JSON.stringify(item) !== JSON.stringify(bMap.get(k))) {
        return { change: 'modified', key: k, before: bMap.get(k), after: item };
    }
    return null;
}

function diffAddedOrModified(aMap, bMap) {
    const list = [];
    for (const [k, item] of aMap) {
        const diff = checkItemDiff(k, item, bMap);
        if (diff) list.push(diff);
    }
    return list;
}

function diffDeleted(bMap, aMap) {
    const list = [];
    for (const [k, item] of bMap) {
        if (!aMap.has(k)) list.push({ change: 'deleted', key: k, item });
    }
    return list;
}

export function diffListItems(before, after) {
    const bMap = new Map();
    const aMap = new Map();
    before.forEach((item, i) => bMap.set(itemKey(item) ?? i, item));
    after.forEach((item, i) => aMap.set(itemKey(item) ?? i, item));
    return [...diffAddedOrModified(aMap, bMap), ...diffDeleted(bMap, aMap)];
}

function buildPropDiff(path, before, after, options) {
    if (options.detail === 'changes' && Array.isArray(before) && Array.isArray(after)) {
        return { path, items: diffListItems(before, after) };
    }
    return { path, before, after };
}

function propDiffEntry(key, oldProps, newProps, options) {
    if (isPropIgnored(key, options)) return null;
    const bVal = oldProps[key] ?? null;
    const aVal = newProps[key] ?? null;
    if (JSON.stringify(bVal) === JSON.stringify(aVal)) return null;
    return buildPropDiff(key, bVal, aVal, options);
}

function diffProperties(oldProps, newProps, options) {
    const keys = [...new Set([...Object.keys(oldProps), ...Object.keys(newProps)])];
    const diffs = [];
    for (const key of keys) {
        const diff = propDiffEntry(key, oldProps, newProps, options);
        if (diff) diffs.push(diff);
    }
    return diffs;
}

function toPropsArray(props, side, options) {
    return Object.entries(props)
        .filter(([path]) => !isPropIgnored(path, options))
        .map(([path, val]) => ({ path, [side]: val }));
}

const ownsReport = (element, inTopOrCollection) => inTopOrCollection || Boolean(textOf(element.Name)) || Boolean(textOf(element.Caption));

export function elementsOf(doc) {
    const labels = new Map();
    const collect = value => {
        if (Array.isArray(value)) return value.forEach(collect);
        if (!value || typeof value !== 'object') return;
        if (isElement(value)) labels.set(value.$ID, labelOf(value));
        Object.values(value).forEach(collect);
    };
    collect(doc);
    const show = value => (typeof value === 'string' && labels.has(value) ? { element: labels.get(value) } : value);
    const reported = new Map();

    const flatten = (value, prefix, props, parentIsTop) => {
        const flattenField = (key, field) => {
            if (key === '$ID' || (key === '$Type' && !prefix)) return;
            const at = prefix ? `${prefix} > ${key}` : key;
            if (Array.isArray(field)) {
                const list = items(field);
                const own = list.filter(item => isElement(item) && ownsReport(item, parentIsTop || COLLECTIONS.has(value.$Type)));
                own.forEach(item => report(item, false));
                const rest = list.filter(item => !own.includes(item));
                if (rest.length || !list.length) props[at] = rest.map(item => (item && typeof item === 'object' ? summary(item) : show(item)));
                return;
            }
            if (field && typeof field === 'object') {
                if (isElement(field) && ownsReport(field, parentIsTop || COLLECTIONS.has(value.$Type))) {
                    report(field, false);
                    props[at] = { element: labelOf(field) };
                } else {
                    flatten(field, at, props, false);
                }
                return;
            }
            props[at] = show(field);
        };
        for (const [key, field] of Object.entries(value)) flattenField(key, field);
    };
    const summary = item => { const props = {}; flatten(item, '', props, false); return isElement(item) ? { type: item.$Type, ...props } : props; };
    const report = (element, isTop) => {
        const props = {};
        flatten(element, '', props, isTop);
        reported.set(element.$ID, { ...labelOf(element), properties: props });
    };
    report(doc, true);
    return reported;
}

const label = ({ type, name, detail }) => ({ type, name, ...(detail ? { detail } : {}) });

function buildElementChange(change, id, element, options) {
    if (options.detail === 'summary') return { change, id, ...label(element) };
    const side = change === 'added' ? 'after' : 'before';
    const properties = toPropsArray(element.properties, side, options);
    return { change, id, ...label(element), properties };
}

function collectModified(before, after, options) {
    const modified = [];
    for (const [id, element] of after) {
        const old = before.get(id);
        if (!old) continue;
        if (options.detail === 'summary') {
            modified.push({ change: 'modified', id, ...label(element) });
            continue;
        }
        const properties = diffProperties(old.properties, element.properties, options);
        if (properties.length) modified.push({ change: 'modified', id, ...label(element), properties });
    }
    return modified;
}

function collectSide(source, target, change, options) {
    const list = [];
    for (const [id, element] of source) {
        if (!target.has(id)) list.push(buildElementChange(change, id, element, options));
    }
    return list;
}

export function elementChanges(beforeDoc, afterDoc, options = {}) {
    const before = beforeDoc ? elementsOf(beforeDoc) : new Map();
    const after = afterDoc ? elementsOf(afterDoc) : new Map();
    return [
        ...collectSide(before, after, 'deleted', options),
        ...collectSide(after, before, 'added', options),
        ...collectModified(before, after, options)
    ];
}
