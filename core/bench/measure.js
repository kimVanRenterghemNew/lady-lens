/**
 * Repeated measurement: a warm-up run that does not count, then `runs` measured runs. The median is the number to
 * compare; the spread (median absolute deviation as a percentage of the median) says how far a run may wander.
 */
import { performance } from 'perf_hooks';

/** A measurement whose runs wander more than this is unreliable: compare it with care. */
export const UNSTABLE_SPREAD_PCT = 10;
const DEFAULTS = Object.freeze({ runs: 5, warmup: 1, repeat: 1, clock: () => performance.now() });

const round = value => Math.round(value * 100) / 100;

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median, min, max and spread of a set of durations in ms. */
export function summarizeSamples(samples) {
    const mid = median(samples);
    const spreadPct = mid > 0 ? median(samples.map(value => Math.abs(value - mid))) / mid * 100 : 0;
    return {
        runs: samples.length,
        medianMs: round(mid),
        minMs: round(Math.min(...samples)),
        maxMs: round(Math.max(...samples)),
        spreadPct: round(spreadPct),
        unstable: spreadPct > UNSTABLE_SPREAD_PCT
    };
}

async function timedRun(fn, repeat, clock) {
    const started = clock();
    for (let j = 0; j < repeat; j++) await fn();
    return (clock() - started) / repeat;
}

/**
 * Runs `fn` `warmup` times without counting, then `runs` times. With `repeat` one run calls `fn` that many times and
 * counts the average, so an operation of a few ms is not lost in timer noise.
 */
export async function measureRuns(fn, options) {
    const { runs, warmup, repeat, clock } = { ...DEFAULTS, ...options };
    for (let i = 0; i < warmup; i++) await fn();
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await timedRun(fn, repeat, clock));
    return summarizeSamples(samples);
}
