// Context budget formatting voor tool results
// TODO(coverage): Current line coverage is 80.95% (< 85% target). Raise to >= 85%.
import { contextBudget } from '../configuration/index.js';

export function fitToBudget(result, { lists = [], texts = [], narrow = 'narrow the call' } = {}) {
    const { toolResultChars } = contextBudget();
    const size = value => JSON.stringify(value).length;
    if (!result || typeof result !== 'object' || result.error || size(result) <= toolResultChars) return result;
    const fitted = { ...result };
    for (const key of texts) {
        if (typeof fitted[key] !== 'string') continue;
        const max = Math.floor(toolResultChars / 2);
        if (fitted[key].length > max) {
            fitted[key] = fitted[key].slice(0, fitted[key].lastIndexOf('\n', max) > 0 ? fitted[key].lastIndexOf('\n', max) : max);
        }
    }
    for (const key of lists) {
        if (Array.isArray(fitted[key])) fitted[key] = [...fitted[key]];
    }
    const cut = cutLists(fitted, lists, toolResultChars - 160, size);
    const omitted = cut.reduce((sum, { left }) => sum + left, 0);
    // say per list what is shown: `matchCount: 8` next to 3 nodes read as a bug without it
    const shown = cut.filter(({ left }) => left).map(({ key, kept, left }) => `${key} ${kept} of ${kept + left}`).join(', ');
    return { ...fitted, truncated: true, ...(omitted ? { omitted } : {}), hint: `Result cut to the context budget${shown ? ` (${shown})` : ''}: ${narrow}.` };
}

/** Drop items from the end of the last non-empty list until the result fits; per list how many were kept and left out. */
function cutLists(fitted, lists, max, size) {
    const left = new Map(lists.map(key => [key, 0]));
    while (size(fitted) > max) {
        const key = [...lists].reverse().find(name => Array.isArray(fitted[name]) && fitted[name].length);
        if (!key) break;
        fitted[key].pop();
        left.set(key, left.get(key) + 1);
    }
    return lists.map(key => ({ key, kept: Array.isArray(fitted[key]) ? fitted[key].length : 0, left: left.get(key) }));
}

export const withBudget = (fn, shape) => (args) => {
    const result = fn(args);
    return result && typeof result.then === 'function' ? result.then(value => fitToBudget(value, shape)) : fitToBudget(result, shape);
};
