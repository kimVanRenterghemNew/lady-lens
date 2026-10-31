/**
 * Tests for core/graph/graphIds.js: the single shared node-ID normalizer.
 */
import { describe, it, expect } from 'vitest';
import { normalizeNodeId } from '../core/graph/index.js';

describe('normalizeNodeId', () => {
    it('is idempotent', () => {
        const once = normalizeNodeId('Mod:Core_Auth-File');
        expect(normalizeNodeId(once)).toBe(once);
    });

    it('is case-insensitive', () => {
        expect(normalizeNodeId('DEC:OAuth2')).toBe('dec:oauth2');
    });

    it('collapses whitespace/underscore/hyphen runs within a segment', () => {
        expect(normalizeNodeId('mod:Core_Auth-File')).toBe('mod:core-auth-file');
        expect(normalizeNodeId('mod:Core   Auth')).toBe('mod:core-auth');
    });

    it('normalizes path separators but keeps the slash-based path structure', () => {
        expect(normalizeNodeId('mod:core\\auth.js')).toBe('mod:core/auth.js');
        expect(normalizeNodeId('mod:core/auth.js')).toBe('mod:core/auth.js');
    });

    it('throws a clear error on empty or non-string input', () => {
        expect(() => normalizeNodeId('')).toThrow(/non-empty/);
        expect(() => normalizeNodeId('   ')).toThrow(/non-empty/);
        expect(() => normalizeNodeId(null)).toThrow(/non-empty/);
        expect(() => normalizeNodeId(undefined)).toThrow(/non-empty/);
        expect(() => normalizeNodeId(123)).toThrow(/non-empty/);
    });

    it('never merges different types, even after normalization', () => {
        expect(normalizeNodeId('dec:x')).not.toBe(normalizeNodeId('mod:x'));
    });
});

