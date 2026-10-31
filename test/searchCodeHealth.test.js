import { describe, it, expect } from 'vitest';
import { healthTool, getRepoChurn, invalidateChurnCache } from '../core/search/index.js';

describe('search healthTool and repoChurn', () => {
    describe('getRepoChurn', () => {
        it('calculates churn from git history and caches it', () => {
            invalidateChurnCache();
            let historyCalls = 0;
            const mockHistory = () => {
                historyCalls++;
                return [
                    ['core/a.js', 'core/b.js'],
                    ['core/a.js', 'core/c.js']
                ];
            };

            const churn1 = getRepoChurn('/fake/root', mockHistory);
            expect(churn1.get('core/a.js')).toBe(2);
            expect(churn1.get('core/b.js')).toBe(1);
            expect(historyCalls).toBe(1);

            // Second call with same root uses cache
            const churn2 = getRepoChurn('/fake/root', mockHistory);
            expect(churn2).toBe(churn1);
            expect(historyCalls).toBe(1);

            // Invalidate cache causes recomputation
            invalidateChurnCache();
            getRepoChurn('/fake/root', mockHistory);
            expect(historyCalls).toBe(2);
        });

        it('handles history error gracefully without throwing', () => {
            invalidateChurnCache();
            const failingHistory = () => { throw new Error('git error'); };
            const churn = getRepoChurn('/fail/root', failingHistory);
            expect(churn.size).toBe(0);
        });
    });

    describe('healthTool', () => {
        const noRefresh = async () => ({ checked: true, synced: false });

        it('returns overall health report for project', async () => {
            const res = await healthTool({}, { refresh: noRefresh, history: () => [] });
            expect(res.relation).toBe('health');
            expect(Array.isArray(res.files)).toBe(true);
            expect(res.summary).toBeDefined();
        });

        it('returns filtered report for a specific module', async () => {
            const res = await healthTool({ module: 'core/language' }, { refresh: noRefresh, history: () => [] });
            expect(res.relation).toBe('health');
            expect(res.modules).toEqual([]);
            expect(res.files.every(f => f.path.startsWith('core/language/'))).toBe(true);
        });

        it('returns error when specific file does not exist in graph', async () => {
            const res = await healthTool({ file: 'nonexistent/file.js' }, { refresh: noRefresh, history: () => [] });
            expect(res.error).toContain('is not a code file in the project graph');
        });

        it('respects custom limit parameter', async () => {
            const res = await healthTool({ limit: 3 }, { refresh: noRefresh, history: () => [] });
            expect(res.files.length).toBeLessThanOrEqual(3);
        });
    });
});
