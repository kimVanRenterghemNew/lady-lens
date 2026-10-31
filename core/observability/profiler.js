/**
 * Performance Profiler & Diagnostic Tool for lady-lens.
 *
 * Measures and tracks execution times of subsystems (sync, AST parsing, graph queries,
 * ranking, code health, direct queries) and identifies performance bottlenecks.
 *
 * @module core/observability/profiler
 */
import { performance } from 'perf_hooks';

export function createProfiler(name = 'default') {
    const measurements = new Map();
    const activeTimers = new Map();
    let enabled = process.env.LENS_PROFILE === '1';

    function enable() {
        enabled = true;
    }

    function disable() {
        enabled = false;
    }

    function reset() {
        measurements.clear();
        activeTimers.clear();
    }

    function record(label, durationMs) {
        let entry = measurements.get(label);
        if (!entry) {
            entry = { label, count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, samples: [] };
            measurements.set(label, entry);
        }
        entry.count++;
        entry.totalMs += durationMs;
        if (durationMs < entry.minMs) entry.minMs = durationMs;
        if (durationMs > entry.maxMs) entry.maxMs = durationMs;
        if (entry.samples.length < 100) entry.samples.push(durationMs);
    }

    function startTimer(label) {
        if (!enabled) return () => 0;
        const start = performance.now();
        return () => {
            const duration = performance.now() - start;
            record(label, duration);
            return duration;
        };
    }

    function measure(label, fn) {
        if (!enabled) return fn();
        const start = performance.now();
        try {
            return fn();
        } finally {
            record(label, performance.now() - start);
        }
    }

    async function measureAsync(label, fn) {
        if (!enabled) return await fn();
        const start = performance.now();
        try {
            return await fn();
        } finally {
            record(label, performance.now() - start);
        }
    }

    function getStats() {
        const grandTotal = Array.from(measurements.values()).reduce((sum, e) => sum + e.totalMs, 0);
        const stats = [];
        for (const [label, e] of measurements.entries()) {
            const avgMs = e.count > 0 ? e.totalMs / e.count : 0;
            const pctOfTotal = grandTotal > 0 ? (e.totalMs / grandTotal) * 100 : 0;
            const isBottleneck = pctOfTotal >= 25 || (avgMs >= 50 && e.count >= 3);
            stats.push({
                label,
                count: e.count,
                totalMs: Number(e.totalMs.toFixed(2)),
                avgMs: Number(avgMs.toFixed(2)),
                minMs: Number((e.minMs === Infinity ? 0 : e.minMs).toFixed(2)),
                maxMs: Number(e.maxMs.toFixed(2)),
                pctOfTotal: Number(pctOfTotal.toFixed(1)),
                isBottleneck
            });
        }
        return stats.sort((a, b) => b.totalMs - a.totalMs);
    }

    function formatReport({ title = 'Performance Profile Report' } = {}) {
        const stats = getStats();
        if (!stats.length) return `=== ${title} ===\nGeen metingen geregistreerd.\n`;

        const lines = [];
        lines.push(`\n=== ${title} ===`);
        lines.push('| Operatie / Fase                   | Calls | Totale Tijd | Gemiddeld | Min / Max       | % Tijd | Status      |');
        lines.push('|-----------------------------------|-------|-------------|-----------|-----------------|--------|-------------|');

        for (const s of stats) {
            const status = s.isBottleneck ? '⚠️ BOTTLENECK' : '✓ OK';
            const minMax = `${s.minMs.toFixed(1)} / ${s.maxMs.toFixed(1)} ms`;
            lines.push(
                `| ${s.label.padEnd(33)} | ${String(s.count).padStart(5)} | ${`${s.totalMs.toFixed(1)} ms`.padStart(11)} | ${`${s.avgMs.toFixed(1)} ms`.padStart(9)} | ${minMax.padStart(15)} | ${`${s.pctOfTotal.toFixed(1)}%`.padStart(6)} | ${status.padEnd(11)} |`
            );
        }

        const bottlenecks = stats.filter(s => s.isBottleneck);
        if (bottlenecks.length > 0) {
            lines.push('\nHoofdknelpunten (Bottlenecks):');
            for (const b of bottlenecks) {
                lines.push(`  - "${b.label}": verbruikt ${b.pctOfTotal}% van de tijd (gem. ${b.avgMs} ms per aanroep, totaal ${b.totalMs} ms over ${b.count} calls)`);
            }
        } else {
            lines.push('\nGeen kritieke knelpunten gedetecteerd. Alle fasen presteren binnen de verwachte marges.');
        }
        lines.push('========================================================================================\n');

        return lines.join('\n');
    }

    return {
        name,
        enable,
        disable,
        reset,
        startTimer,
        record,
        measure,
        measureAsync,
        getStats,
        formatReport
    };
}

export const globalProfiler = createProfiler('global');
