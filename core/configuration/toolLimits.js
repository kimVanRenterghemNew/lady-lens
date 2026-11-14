/**
 * How many items a list tool returns: the caller's `limit`, else the setting `<TOOL>_LIMIT` (`LENS_GRAPH_QUERY_LIMIT`, or
 * `env` in the lens configuration of a repository), else the default below. The context budget still caps the answer.
 * @module core/configuration/toolLimits
 */
import { lensEnv } from './env.js';

export const TOOL_LIMITS = Object.freeze({
    graph_query: 20,
    grep: 50,
    glob: 200,
    searchView: 100,
    importedBy: 200,
    imports: 200,
    exports: 200,
    definedIn: 50,
    functionView: 20,
    folderView: 40,
    health: 20,
    diff_impact: 50,
    discussion_query: 10
});

const positiveInteger = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
};

/** `graph_query` -> `GRAPH_QUERY_LIMIT`, `importedBy` -> `IMPORTED_BY_LIMIT`. */
export const toolLimitSetting = (tool) => `${tool.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_LIMIT`;

/**
 * @param {string} tool
 * @param {unknown} [given] the caller's `limit`
 * @returns {number|null} null for a tool without a list limit
 */
export function toolLimit(tool, given) {
    if (!(tool in TOOL_LIMITS)) return null;
    return positiveInteger(given) ?? positiveInteger(lensEnv(toolLimitSetting(tool))) ?? TOOL_LIMITS[tool];
}
