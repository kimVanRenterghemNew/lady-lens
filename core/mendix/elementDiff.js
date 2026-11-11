/**
 * What changed inside one Mendix document, element by element. An element is an object with a $ID. It is reported on its
 * own when it has a Name, sits directly in the document or in a microflow's object collection (an activity, an event, a
 * flow); a smaller nameless part (a parameter mapping, a caption, a line) folds into its owner as a property path such as
 * `Action > ParameterMappings`. A value that points at another element ($ID) is shown as that element's label.
 * @module core/mendix/elementDiff
 */

import { nodeSummary } from './flows.js';

const COLLECTIONS = new Set(['Microflows$MicroflowObjectCollection']);
const isElement = value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.$ID === 'string';
// Mendix lists start with a version number: [3, item, item]
const items = list => (typeof list[0] === 'number' && list.length > 0 ? list.slice(1) : list);
const textOf = value => (typeof value === 'string' ? value : null);

/** type, name (or caption) and, for an activity or decision, what it does (`NanoflowCallAction: Module.Flow`): an
 * activity's caption is often just Mendix's automatic "Activity". */
export function labelOf(element) {
    const detail = element.Action || element.SplitCondition ? nodeSummary(element) : null;
    return { type: element.$Type, name: textOf(element.Name) ?? textOf(element.Caption) ?? null, ...(detail ? { detail } : {}) };
}

/** Every reported element of `doc`: id -> { type, name, properties: { path: value } }. */
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

    // the properties of `value` under `prefix`, into `props`; nested reported elements go to `report`
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
    const ownsReport = (element, inTopOrCollection) => inTopOrCollection || Boolean(textOf(element.Name));
    const report = (element, isTop) => {
        const props = {};
        flatten(element, '', props, isTop);
        reported.set(element.$ID, { ...labelOf(element), properties: props });
    };
    report(doc, true);
    return reported;
}

const label = ({ type, name, detail }) => ({ type, name, ...(detail ? { detail } : {}) });

/** Added, deleted and modified elements between two versions of one document (`null` for a side that does not exist). */
export function elementChanges(beforeDoc, afterDoc) {
    const before = beforeDoc ? elementsOf(beforeDoc) : new Map();
    const after = afterDoc ? elementsOf(afterDoc) : new Map();
    const changes = [];
    for (const [id, element] of before) if (!after.has(id)) changes.push({ change: 'deleted', id, ...label(element), properties: element.properties });
    for (const [id, element] of after) if (!before.has(id)) changes.push({ change: 'added', id, ...label(element), properties: element.properties });
    for (const [id, element] of after) {
        const old = before.get(id);
        if (!old) continue;
        const keys = [...new Set([...Object.keys(old.properties), ...Object.keys(element.properties)])];
        const properties = keys.filter(key => JSON.stringify(old.properties[key]) !== JSON.stringify(element.properties[key]))
            .map(key => ({ path: key, before: old.properties[key] ?? null, after: element.properties[key] ?? null }));
        if (properties.length) changes.push({ change: 'modified', id, ...label(element), properties });
    }
    return changes;
}
