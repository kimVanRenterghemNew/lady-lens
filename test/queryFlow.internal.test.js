/**
 * Unified codebase query flow.
 * Dwingt af dat graph_query en grep naar dezelfde flow verwezen worden
 * en dat de graph module de optimale executie-strategie bepaalt.
 */
import { describe, it, expect } from 'vitest';
import { resolveCodebaseQuery } from '../core/search/index.js';

describe('Unified Codebase Query Resolution Flow', () => {
    it('wijst JavaScript symbolen toe aan de graph_symbol strategie', async () => {
        const result = await resolveCodebaseQuery({ query: 'createGraph' });
        expect(result).toBeDefined();
        expect(result.strategy).toBe('graph_symbol');
        expect(result.symbol).toBe('createGraph');
        expect(result.file).toBeDefined();
        expect(typeof result.chunk).toBe('string');
        expect(result.source).toBe('graph');
    });

    it('wijst expliciete node queries direct toe aan graph_query', async () => {
        const result = await resolveCodebaseQuery({ node: 'core/configuration/index.js' });
        expect(result).toBeDefined();
        expect(result.available).toBe(true);
        expect(Array.isArray(result.nodes)).toBe(true);
    });

    it('valt terug op text_grep bij willekeurige tekstpatronen die niet in de AST zitten', async () => {
        const result = await resolveCodebaseQuery({ pattern: 'LENS_DEBUG_LEVEL' });
        expect(result).toBeDefined();
        expect(result.strategy).toBe('text_grep');
        expect(Array.isArray(result.matches)).toBe(true);
        expect(result.totalCount).toBeGreaterThan(0);
        expect(result.source).toBe('grep');
    });

    it('faalt gecontroleerd bij een lege query', async () => {
        const result = await resolveCodebaseQuery({});
        expect(result.error).toBeDefined();
        expect(result.error).toContain('query, pattern or node is required');
    });
});
