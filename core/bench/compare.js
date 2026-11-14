/**
 * Two bench runs side by side: per measurement the change of the median in percent. Slower by more than the margin
 * is a regression; a change of less than `floorMs` is timer noise and never one.
 */
import { differentMachine } from './environment.js';

export const DEFAULT_MARGIN_PCT = 25;
export const NOISE_FLOOR_MS = 2;
const DEFAULTS = Object.freeze({ marginPct: DEFAULT_MARGIN_PCT, floorMs: NOISE_FLOOR_MS });

const pct = (after, before) => (before > 0 ? Math.round((after - before) / before * 1000) / 10 : 0);

function compareOne(label, now, before, { marginPct, floorMs }) {
    if (!before) return { label, after: now.medianMs, status: 'new' };
    const deltaPct = pct(now.medianMs, before.medianMs);
    const regression = deltaPct > marginPct && now.medianMs - before.medianMs > floorMs;
    return { label, before: before.medianMs, after: now.medianMs, deltaPct, regression, unstable: Boolean(now.unstable || before.unstable) };
}

function warningsFor(current, previous) {
    const mismatch = differentMachine(current.environment, previous.environment);
    return [
        ...(mismatch.length ? [`different machine (${mismatch.join(', ')}): the numbers say little`] : []),
        ...(current.repo?.key !== previous.repo?.key ? ['different repository: the numbers say little'] : [])
    ];
}

export function compareRuns(current, previous, options) {
    const settings = { ...DEFAULTS, ...options };
    const before = previous.measurements || {};
    const rows = Object.entries(current.measurements).map(([label, now]) => compareOne(label, now, before[label], settings));
    return { rows, regressions: rows.filter(row => row.regression), warnings: warningsFor(current, previous), marginPct: settings.marginPct };
}

const changeText = row => (row.status === 'new' ? 'new' : `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct}%`);
const markText = row => [row.regression ? 'REGRESSION' : '', row.unstable ? '(unstable)' : ''].filter(Boolean).join(' ');
const rowLine = row => `${row.label.padEnd(40)} ${(row.before === undefined ? '-' : `${row.before} ms`).padStart(10)} ${`${row.after} ms`.padStart(10)} ${changeText(row).padStart(8)} ${markText(row)}`.trimEnd();

export function formatComparison({ rows, regressions, warnings, marginPct }, names) {
    const { currentName, previousName } = { currentName: 'now', previousName: 'before', ...names };
    return [
        `bench: ${currentName} against ${previousName} (regression = more than ${marginPct}% slower)`,
        ...warnings.map(warning => `WARNING: ${warning}`),
        '',
        `${'measurement'.padEnd(40)} ${'before'.padStart(10)} ${'now'.padStart(10)} ${'change'.padStart(8)}`,
        ...rows.map(rowLine),
        '',
        regressions.length ? `${regressions.length} regression(s): ${regressions.map(row => row.label).join(', ')}` : 'no regressions'
    ].join('\n');
}
