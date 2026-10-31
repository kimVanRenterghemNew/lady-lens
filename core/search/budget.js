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
    let omitted = 0;
    while (size(fitted) > toolResultChars - 160) {
        const key = [...lists].reverse().find(name => Array.isArray(fitted[name]) && fitted[name].length);
        if (!key) break;
        fitted[key].pop();
        omitted += 1;
    }
    return { ...fitted, truncated: true, ...(omitted ? { omitted } : {}), hint: `Result cut to the context budget: ${narrow}.` };
}

export const withBudget = (fn, shape) => (args) => {
    const result = fn(args);
    return result && typeof result.then === 'function' ? result.then(value => fitToBudget(value, shape)) : fitToBudget(result, shape);
};
