import { describe, it, expect } from 'vitest';
import { createProfiler } from '../core/observability/index.js';

describe('profiler branch coverage', () => {
    it('handles disabled state for startTimer, measure, measureAsync', async () => {
        const profiler = createProfiler('disabled-test');
        profiler.disable();

        const timer = profiler.startTimer('test-timer');
        expect(timer()).toBe(0);

        const syncVal = profiler.measure('sync-op', () => 42);
        expect(syncVal).toBe(42);

        const asyncVal = await profiler.measureAsync('async-op', async () => 'hello');
        expect(asyncVal).toBe('hello');

        expect(profiler.getStats()).toHaveLength(0);
        expect(profiler.formatReport()).toContain('Geen metingen geregistreerd');
    });

    it('records measurements and detects bottlenecks in formatReport', () => {
        const profiler = createProfiler('active-test');
        profiler.enable();

        // Add 5 equal small operations (each 20% of total < 25%, and avg < 50ms -> no bottleneck)
        for (let i = 1; i <= 5; i++) {
            profiler.record(`op-${i}`, 10);
        }

        let report = profiler.formatReport({ title: 'Fast Report' });
        expect(report).toContain('Geen kritieke knelpunten');

        // Add a bottleneck operation (avg >= 50 and count >= 3, or >= 25% of total)
        profiler.record('slow-bottleneck', 200);
        profiler.record('slow-bottleneck', 220);
        profiler.record('slow-bottleneck', 210);

        const stats = profiler.getStats();
        expect(stats.some(s => s.isBottleneck)).toBe(true);

        report = profiler.formatReport({ title: 'Bottleneck Report' });
        expect(report).toContain('Hoofdknelpunten (Bottlenecks)');
        expect(report).toContain('slow-bottleneck');

        // reset
        profiler.reset();
        expect(profiler.getStats()).toHaveLength(0);
    });

    it('measures sync and async functions when enabled', async () => {
        const profiler = createProfiler('timing-test');
        profiler.enable();

        const res1 = profiler.measure('sync', () => 100);
        expect(res1).toBe(100);

        const res2 = await profiler.measureAsync('async', async () => 200);
        expect(res2).toBe(200);

        const endTimer = profiler.startTimer('manual');
        const dur = endTimer();
        expect(dur).toBeGreaterThanOrEqual(0);

        expect(profiler.getStats()).toHaveLength(3);
    });
});
