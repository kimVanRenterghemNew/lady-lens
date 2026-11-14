/**
 * Time budgets per measurement, as a ratchet: a budget may only get stricter. `ratchetBudgets` sets a budget to
 * `factor` times the measured median when that is lower, and never raises one.
 */

/** Headroom over the median of `npm run bench:ratchet` (the performance tests alone, as the gate runs them) for a slower
 * machine (CI) or a busy one. */
export const BUDGET_FACTOR = 5;
/** Below this a budget only measures timer noise. */
export const MIN_BUDGET_MS = 50;
const DEFAULTS = Object.freeze({ factor: BUDGET_FACTOR, minMs: MIN_BUDGET_MS });

function overBudget(label, medianMs, budgetMs) {
    if (budgetMs === undefined) return { label, medianMs, budgetMs: null, reason: 'no budget: run npm run bench:ratchet' };
    return medianMs > budgetMs ? { label, medianMs, budgetMs, reason: `${medianMs} ms over the budget of ${budgetMs} ms` } : null;
}

/** Each measured median against its budget; a measurement without a budget fails too. */
export function checkBudgets(measured, budgets) {
    return Object.entries(measured).map(([label, medianMs]) => overBudget(label, medianMs, budgets[label])).filter(Boolean);
}

/** New budgets: stricter where the measurement allows it, new ones for new measurements, none raised. */
export function ratchetBudgets(measured, budgets, options) {
    const { factor, minMs } = { ...DEFAULTS, ...options };
    const changed = Object.entries(measured)
        .map(([label, medianMs]) => ({ label, from: budgets[label] ?? null, to: Math.max(minMs, Math.ceil(medianMs * factor)) }))
        .filter(({ from, to }) => from === null || to < from);
    const next = { ...budgets, ...Object.fromEntries(changed.map(({ label, to }) => [label, to])) };
    return { budgets: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), changed };
}
