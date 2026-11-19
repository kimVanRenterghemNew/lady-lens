/**
 * The default code ranking (as in 1.8.1): reciprocal rank fusion of the term order and the name order, when the gate
 * opens; otherwise the term order stays as it is. The learned model (nameModel.js) is the opt-in alternative: it won
 * on lens's eval sets but lowered a host's plan-pick cases, so the default stays the ranking that lowers none.
 * @module core/graph/query/nameFusion
 */

import { gateOpens } from './nameRank.js';

const RRF_K = 5;
// the name order counts less than the term order, and only when its best hit clearly leads (measured: 0.35-0.45 and
// a lead of 1.5x over the fifth hit keep every eval set at or above the term order; weight 1 lowered three of four)
const NAME_WEIGHT = 0.4;
const LENS_DEPTH = 20;
const NAMES_DEPTH = 50;

const pathOf = (node) => String(node.path || node.id);

/**
 * Reciprocal rank fusion of the term order (top LENS_DEPTH, weight 1) and the name order (top NAMES_DEPTH, weight
 * NAME_WEIGHT), when the gate opens; otherwise the term order stays as it is.
 * @param {Array<{node: object, score: number}>} lens ranked entries of the term order
 * @param {Array<{node: object, pairInName: boolean, score: number}>} names from nameScores
 * @param {Array<{node: object, score: number}>} scored every node with its term score (also below the minimum)
 * @returns {Array<{node: object, score: number}>} the fused order (each `score` stays the term score), then the rest of `lens`
 */
export function fuseWithNames(lens, names, scored) {
    if (!gateOpens(names)) return lens;
    const rrf = new Map();
    const add = (node, i, weight) => rrf.set(node, (rrf.get(node) ?? 0) + weight / (RRF_K + i + 1));
    lens.slice(0, LENS_DEPTH).forEach((entry, i) => add(entry.node, i, 1));
    names.slice(0, NAMES_DEPTH).forEach((entry, i) => add(entry.node, i, NAME_WEIGHT));
    const scoreOf = new Map(scored.map(entry => [entry.node, entry.score]));
    const fused = [...rrf].sort((a, b) => b[1] - a[1] || pathOf(a[0]).localeCompare(pathOf(b[0]))).map(([node]) => ({ node, score: scoreOf.get(node) ?? 0 }));
    return [...fused, ...lens.slice(LENS_DEPTH).filter(entry => !rrf.has(entry.node))];
}
