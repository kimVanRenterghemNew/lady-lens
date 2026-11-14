/**
 * Where does the code know a state the question names (backlog/toestand-in-de-code.md)? The function and the line, or no
 * place at all. The fixture is the work queue of Kura at 01c4c12.
 */
import { describe, it, expect } from 'vitest';
import { statePlaces, conceptsOf, tokenize } from '../core/graph/index.js';

const QUEUE = [
    'export const queue = {',                                              // 1
    '    async pull() {',                                                  // 2
    '        const state = await this.load();',                            // 3
    '        if (state.paused) return null;',                              // 4
    "        const next = state.items.find(i => i.status === 'todo') || null;", // 5
    "        debug(2, 'queue:pull', () => next ? `next todo: ${next.id}` : 'nothing to pull');", // 6
    '        return next;',                                                // 7
    '    },',                                                              // 8
    '    async recoverInterrupted() {',                                    // 9
    "        const stuck = state.items.filter(item => item.status === 'in-progress');", // 10
    '        for (const item of stuck) item.interruptedAt = new Date().toISOString();', // 11
    '    }',                                                               // 12
    '};'
].join('\n');
const LOOP = [
    'export async function runCodeVerificationLoop(task) {',               // 1
    '    const before = task.lastFailureSignature;',                       // 2
    '    return before;',                                                  // 3
    '}'
].join('\n');
const files = [
    { path: 'core/domain/planning/queue/workQueue.js', text: QUEUE, functions: [{ name: 'pull', loc: [2, 8] }, { name: 'recoverInterrupted', loc: [9, 12] }] },
    // the header as in Kura: the subject ("attempt") is in the file, the state ("failure") in the line
    { path: 'core/domain/testing/codeVerificationLoop.js', text: LOOP, functions: [{ name: 'runCodeVerificationLoop', loc: [1, 4] }], context: 'A failed verification can produce one bounded regeneration attempt with the failure output as context.' }
];
const placesFor = question => statePlaces({ files, terms: tokenize(question), weights: new Map() });

describe('a state in the code', () => {
    it('groups a Dutch word with its translations: one concept, counted once', () => {
        expect(conceptsOf(tokenize('wachtrij leeg'))).toEqual([['wachtrij', 'queue'], ['leeg', 'empty', 'nothing']]);
    });

    it('finds the function and the line: an empty queue, a paused queue', () => {
        expect(placesFor('als de wachtrij leeg is')[0]).toMatchObject({ path: 'core/domain/planning/queue/workQueue.js', function: 'pull', startLine: 2, endLine: 8, lines: expect.arrayContaining([6]) });
        expect(placesFor('als de wachtrij gepauzeerd is')[0]).toMatchObject({ function: 'pull', lines: expect.arrayContaining([4]) });
    });

    it('takes the literal value from the code: a task still in progress', () => {
        expect(placesFor('een taak die nog bezig was toen het programma stopte')[0]).toMatchObject({ function: 'recoverInterrupted', lines: expect.arrayContaining([10]) });
    });

    it('finds a state that lives on another object: after a failed attempt', () => {
        expect(placesFor('na een mislukte poging')[0]).toMatchObject({ path: 'core/domain/testing/codeVerificationLoop.js', function: 'runCodeVerificationLoop', lines: [2] });
    });

    it('prefers the line that decides on the state over the one that only sets or returns it', () => {
        const queue = [
            'export const queue = {',
            '    pause() { state.paused = true; },',               // 2: sets it
            '    isPaused() { return state.paused; },',            // 3: returns it
            '    pull() {',                                        // 4
            '        if (state.paused) return null;',              // 5: decides on it
            '    }',                                               // 6
            '};'
        ].join('\n');
        const file = { path: 'core/queue/workQueue.js', text: queue, functions: [{ name: 'pause', loc: [2, 2] }, { name: 'isPaused', loc: [3, 3] }, { name: 'pull', loc: [4, 6] }] };
        expect(statePlaces({ files: [file], terms: tokenize('als de wachtrij gepauzeerd is'), weights: new Map() })[0]).toMatchObject({ function: 'pull', lines: [5] });
    });

    it('gives no place for a state the code does not have', () => {
        expect(placesFor('als de gebruiker is ingelogd')).toEqual([]);
    });
});
