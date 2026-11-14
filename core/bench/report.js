/**
 * A bench run as text: the measurements (median, spread) and the phases of a full and an incremental sync with their
 * share of the time. A phase `a > b` is part of `a` and is shown as a share of the whole sync too.
 */
import { NESTED } from '../observability/index.js';

const ms = value => `${value.toFixed(1)} ms`;
const share = (value, totalMs) => `${totalMs > 0 ? (value / totalMs * 100).toFixed(1) : '0.0'}%`;
const phaseLine = (label, value, totalMs) => {
    const indent = label.includes(NESTED) ? '    ' : '  ';
    return `${indent}${label.padEnd(44 - indent.length)} ${ms(value).padStart(11)} ${share(value, totalMs).padStart(7)}`;
};

function phaseLines(name, phases, totalMs) {
    const { 'sum of phases': sum, ...rest } = phases;
    return [
        `${name}: ${ms(totalMs)}, sum of the phases ${ms(sum)} (${share(sum, totalMs)})`,
        ...Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => phaseLine(label, value, totalMs))
    ];
}

const measurementLine = (label, m) => `${label.padEnd(40)} ${ms(m.medianMs).padStart(11)} ${ms(m.minMs).padStart(10)} ${ms(m.maxMs).padStart(10)} ${`${m.spreadPct}%`.padStart(7)}${m.unstable ? ' unstable' : ''}`;
const SYNC_PHASES = [['full', 'sync: full'], ['incremental', 'sync: incremental (unchanged)']];

export function formatRun(run) {
    const { environment: env, repo, phases = {} } = run;
    return [
        `lady-lens ${env.lensVersion} bench (${run.commit}), ${repo.files} files, ${repo.nodes} nodes; ${run.runs} runs per measurement after one warm-up`,
        `node ${env.node} ${env.platform} ${env.arch}, ${env.cpus} x ${env.cpuModel}, ${env.memoryGb} GB, machine ${env.machine}`,
        '',
        `${'measurement'.padEnd(40)} ${'median'.padStart(11)} ${'min'.padStart(10)} ${'max'.padStart(10)} ${'spread'.padStart(7)}`,
        ...Object.entries(run.measurements).map(([label, m]) => measurementLine(label, m)),
        ...SYNC_PHASES.filter(([name]) => phases[name]).flatMap(([name, label]) => ['', ...phaseLines(`phases of ${label}`, phases[name], run.measurements[label].medianMs)])
    ].join('\n');
}
