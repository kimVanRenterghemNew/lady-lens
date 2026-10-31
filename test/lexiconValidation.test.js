import { describe, it, expect } from 'vitest';
import { validateLexiconEntries } from '../core/language/index.js';

describe('validateLexiconEntries', () => {
    it('handles empty or null proposals gracefully', () => {
        expect(validateLexiconEntries(null, new Set(['token']))).toEqual({ entries: {}, rejected: [] });
        expect(validateLexiconEntries({}, new Set(['token']))).toEqual({ entries: {}, rejected: [] });
    });

    it('rejects English tokens not present in repository tokens', () => {
        const repoTokens = new Set(['user', 'account']);
        const res = validateLexiconEntries({ order: ['bestelling'] }, repoTokens);
        expect(res.entries).toEqual({});
        expect(res.rejected).toEqual([
            { english: 'order', reason: 'not a token of this repository' }
        ]);
    });

    it('rejects proposals with no valid Dutch candidates', () => {
        const repoTokens = new Set(['order']);
        const res = validateLexiconEntries({ order: [] }, repoTokens);
        expect(res.rejected).toEqual([
            { english: 'order', reason: 'no Dutch words' }
        ]);

        const res2 = validateLexiconEntries({ order: 123 }, repoTokens);
        expect(res2.rejected).toEqual([
            { english: 'order', reason: 'no Dutch words' }
        ]);
    });

    it('rejects words shorter than 3 characters or with non-lowercase letters', () => {
        const repoTokens = new Set(['order']);
        const res = validateLexiconEntries({ order: ['ab', 'bestelling1', 'bestel!ing', '', 123] }, repoTokens);
        expect(res.rejected.map(r => r.reason)).toEqual([
            'not a plain lowercase word',
            'not a plain lowercase word',
            'not a plain lowercase word',
            'not a plain lowercase word',
            'not a plain lowercase word'
        ]);
    });

    it('rejects words identical to the English token', () => {
        const repoTokens = new Set(['order']);
        const res = validateLexiconEntries({ order: ['order'] }, repoTokens);
        expect(res.rejected).toEqual([
            { english: 'order', dutch: 'order', reason: 'same as the English word' }
        ]);
    });

    it('rejects Dutch stop words', () => {
        const repoTokens = new Set(['make', 'have']);
        const res = validateLexiconEntries({ make: ['maken'], have: ['hebben'] }, repoTokens);
        expect(res.rejected.map(r => r.reason)).toEqual(['stop word', 'stop word']);
    });

    it('rejects words that are already code tokens in the repo', () => {
        const repoTokens = new Set(['order', 'factuur']);
        const res = validateLexiconEntries({ order: ['factuur'] }, repoTokens);
        expect(res.rejected).toEqual([
            { english: 'order', dutch: 'factuur', reason: 'is itself a code token' }
        ]);
    });

    it('accepts valid entries, cleans them, deduplicates, and supports single string candidate', () => {
        const repoTokens = new Set(['purchase', 'buy']);
        const res = validateLexiconEntries({
            purchase: '  aankoop  ',
            buy: ['aankoop', 'aankoop', 'kopen']
        }, repoTokens);
        expect(res.rejected).toEqual([]);
        expect(res.entries).toEqual({
            aankoop: ['purchase', 'buy'],
            kopen: ['buy']
        });
    });

    it('rejects Dutch words mapping to more than 3 English words', () => {
        const repoTokens = new Set(['run', 'execute', 'start', 'launch', 'trigger']);
        const res = validateLexiconEntries({
            run: ['starten'],
            execute: ['starten'],
            start: ['starten'],
            launch: ['starten']
        }, repoTokens);
        expect(res.entries.starten).toBeUndefined();
        expect(res.rejected).toContainEqual({
            english: 'run,execute,start,launch',
            dutch: 'starten',
            reason: 'maps to more than 3 English words'
        });
    });
});
