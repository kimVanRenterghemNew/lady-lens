/**
 * Tests for seamHelpers: intra-file helper calls, alias direct calls, and JSDoc doc params.
 */
import { describe, it, expect } from 'vitest';
import { extractSeamsFromSource } from '../core/graph/index.js';

describe('seamHelpers: intra-file helpers, alias direct calls, and JSDoc enrichment', () => {
    it('Story 32.55: extracts seams from local helper functions taking the same param', () => {
        const source = `
        async function workQueueContext(ctx, question) {
            const items = await ctx.workQueue?.list?.();
            return items;
        }

        export async function runDiscussPipeline(ctx, question) {
            ctx.out.log('analyzing');
            return question;
        }
        `;
        const seams = extractSeamsFromSource(source, 'runDiscussPipeline');
        expect(seams.ctx).toContain('out.log()');
        expect(seams.ctx).toContain('workQueue.list()');
    });

    it('extracts direct calls on destructured aliases (e.g. const { recordChatRound } = ctx; await recordChatRound())', () => {
        const source = `
        export async function runDiscussPipeline(ctx, question) {
            const { out, recordChatRound } = ctx;
            out.log('starting');
            await recordChatRound(question);
        }
        `;
        const seams = extractSeamsFromSource(source, 'runDiscussPipeline');
        expect(seams.ctx).toContain('out.log()');
        expect(seams.ctx).toContain('recordChatRound()');
    });

    it('enriches seams from JSDoc @param {Object} ctx annotations', () => {
        const source = `
        /**
         * @param {Object} ctx app context (out, chatHistory, CONTEXT_CHAR_BUDGET, visionBlock, recordChatRound, workQueue)
         * @param {string} question
         */
        export async function runDiscussPipeline(ctx, question) {
            ctx.out.log('hi');
        }
        `;
        const seams = extractSeamsFromSource(source, 'runDiscussPipeline');
        expect(seams.ctx).toEqual([
            'CONTEXT_CHAR_BUDGET',
            'chatHistory',
            'out.log()',
            'recordChatRound',
            'visionBlock',
            'workQueue'
        ]);
    });

    it('Story 32.55 combined: full discussPipeline shape matches exact contract needs', () => {
        const source = `
        async function workQueueContext(ctx, question) {
            const items = (await ctx.workQueue?.list?.()) ?? [];
            return items;
        }

        /**
         * @param {Object} ctx app context (out, chatHistory, CONTEXT_CHAR_BUDGET, visionBlock, recordChatRound, workQueue)
         * @param {string} question
         */
        export async function runDiscussPipeline(ctx, question) {
            const { out, recordChatRound } = ctx;
            out.log('Persona Spiker analyzing');
            await recordChatRound('round-1');
            return { ok: true };
        }
        `;
        const seams = extractSeamsFromSource(source, 'runDiscussPipeline');
        expect(seams.ctx).toEqual([
            'CONTEXT_CHAR_BUDGET',
            'chatHistory',
            'out.log()',
            'recordChatRound()',
            'visionBlock',
            'workQueue.list()'
        ]);
    });

    it('covers exported helper functions, safeParse edge cases, and doc params edge cases', () => {
        const source = `
        export function helper(ctx = {}) {
            ctx.helperAction();
        }
        export function main(ctx) {
            ctx.mainAction();
        }
        `;
        const seams = extractSeamsFromSource(source, 'main');
        expect(seams.ctx).toEqual(['helperAction()', 'mainAction()']);

        expect(extractSeamsFromSource(null, 'main')).toEqual({});
        expect(extractSeamsFromSource('', 'main')).toEqual({});

        const noDoc = 'function test(a) { a.run(); }';
        expect(extractSeamsFromSource(noDoc, 'test')).toEqual({ a: ['run()'] });
    });
});
