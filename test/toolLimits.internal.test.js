/**
 * Every list tool takes `limit` (its main list), with a default from one table that a setting can change: the caller (or
 * its model) decides how much it wants.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS } from '../core/search/index.js';
import { TOOL_LIMITS, toolLimit } from '../core/configuration/index.js';
import { limitLists } from '../core/search/toolLimit.js';

afterEach(() => {
    delete process.env.LENS_GLOB_LIMIT;
    delete process.env.LENS_GRAPH_QUERY_LIMIT;
});

describe('tool limits', () => {
    it('the caller\'s limit first, then the setting, then the default; nonsense falls back', () => {
        expect(toolLimit('graph_query')).toBe(20);
        process.env.LENS_GRAPH_QUERY_LIMIT = '30';
        expect(toolLimit('graph_query')).toBe(30);
        expect(toolLimit('graph_query', 5)).toBe(5);
        expect(toolLimit('graph_query', 0)).toBe(30);
        expect(toolLimit('graph_query', 'x')).toBe(30);
        expect(toolLimit('read_chunk', 5)).toBeNull();
    });

    it('every list tool shows limit with its default in its schema', () => {
        for (const [name, fallback] of Object.entries(TOOL_LIMITS)) {
            const properties = RESEARCH_TOOL_SCHEMAS.find(schema => schema.name === name)?.parameters.properties;
            expect(properties?.limit.description, name).toContain(`default ${fallback};`);
        }
    });

    it('glob and grep return at most the limit; a setting changes the default', async () => {
        expect((await RESEARCH_TOOLS.glob({ pattern: 'core/**/*.js', limit: 3 })).paths).toHaveLength(3);
        process.env.LENS_GLOB_LIMIT = '2';
        expect((await RESEARCH_TOOLS.glob({ pattern: 'core/**/*.js' })).paths).toHaveLength(2);
        expect((await RESEARCH_TOOLS.grep({ pattern: 'export', path: 'core/configuration', limit: 2 })).matches).toHaveLength(2);
    });

    it('cuts the main list only, and says how many it left out', () => {
        const answer = { files: Array.from({ length: 4 }, (_, i) => ({ path: `f${i}.js`, imports: [1, 2, 3, 4, 5, 6, 7], lines: [1, 9] })) };
        const limited = limitLists(answer, ['files'], 3);
        expect(limited.files).toEqual(answer.files.slice(0, 3));
        expect(limited).toMatchObject({ truncated: true, limited: { files: 1 } });
        expect(limitLists(answer, ['files'], 10)).toEqual(answer);
    });
});
