/**
 * `limit` on every list tool: the length of the tool's main list (default from TOOL_LIMITS, or the setting `<TOOL>_LIMIT`).
 * The context budget comes after it. No limit per sub-list: field names would become a contract, and `lines: [start, end]`
 * is a list too; where a sub-list matters a tool has its own option (functionView `maxSites`).
 * @module core/search/toolLimit
 */
import { toolLimit } from '../configuration/index.js';
import { withBudget } from './budget.js';

const isObject = value => value !== null && typeof value === 'object';

/** Each main list longer than `limit` cut to it; counts what it cut in `cut`. */
function cutMain(result, keys, limit, cut) {
    const limited = { ...result };
    for (const key of keys.filter(name => Array.isArray(result[name]) && result[name].length > limit)) {
        cut[key] = result[key].length - limit;
        limited[key] = result[key].slice(0, limit);
    }
    return limited;
}

/** The main lists cut to `limit`; `limited` says per list how many were left out. */
export function limitLists(result, keys, limit) {
    if (!isObject(result) || result.error) return result;
    const cut = {};
    const limited = cutMain(result, keys, limit, cut);
    return Object.keys(cut).length ? { ...limited, truncated: true, limited: cut } : limited;
}

function runLimited(tool, fn, shape, args) {
    const limit = toolLimit(tool, args.limit);
    const apply = value => limitLists(value, shape.mainLists ?? shape.lists ?? [], limit);
    const result = fn({ ...args, limit });
    return typeof result?.then === 'function' ? result.then(apply) : apply(result);
}

/**
 * A research tool with `limit`, then the context budget. `shape.mainLists` names the main lists `limit` cuts
 * (default `shape.lists`).
 */
export const listTool = (tool, fn, shape) => withBudget(args => runLimited(tool, fn, shape, args ?? {}), shape);
