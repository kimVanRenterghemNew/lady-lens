import { describe, it, expect } from 'vitest';
import { analyzeSource } from '../core/graph/index.js';

// Root cause of eval:graph `repo-typo-en` (2026-10-07): the public API of createWorkQueue() is its returned object's
// methods (`recoverInterrupted`). They were not symbols, so neither ranking nor typo correction knew the word.
describe('analyzeSource: member names are symbols', () => {
    it('object-literal methods of a factory are symbols', () => {
        const { symbols } = analyzeSource('export function createQueue() { return { async recoverInterrupted() { return []; }, enqueueTask() {} }; }');
        expect(symbols).toEqual(expect.arrayContaining(['recoverInterrupted', 'enqueueTask']));
    });

    it('class methods are symbols', () => {
        const { symbols } = analyzeSource('export class Waiter { async waitForModel() {} }');
        expect(symbols).toContain('waitForModel');
    });

    it('arrow-function properties are symbols, plain data properties are not', () => {
        const { symbols } = analyzeSource('export const api = { retryRound: () => 1, label: "x", shortlist: 3 };');
        expect(symbols).toContain('retryRound');
        expect(symbols).not.toContain('label');
        expect(symbols).not.toContain('shortlist');
    });

    it('constructor and noisy member names are skipped', () => {
        const { symbols } = analyzeSource('export const api = { handler() {}, state() {} }; export class A { constructor() {} }');
        expect(symbols).not.toContain('constructor');
        expect(symbols).not.toContain('handler');
        expect(symbols).not.toContain('state');
    });
});
