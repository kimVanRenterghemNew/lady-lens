/**
 * Tests for parameterSeams (backlog/parameter-naden-in-function-view.md AC1-AC8, J1-J3).
 */
import { describe, it, expect } from 'vitest';
import { createGraph, parameterSeams, extractSeamsFromSource, functionView } from '../core/graph/index.js';

describe('parameterSeams unit tests (AC1-AC8, J1-J3)', () => {
    it('J1 Kura scenario: extracts methods, properties, and primitive parameters (AC1, AC2, AC3)', () => {
        const source = `
        function runDiscussPipeline(ctx, question) {
            ctx.out.log(question);
            ctx.recordChatRound();
            const q = ctx.workQueue.list();
            const budget = ctx.CONTEXT_CHAR_BUDGET;
            return question;
        }
        `;
        const seams = extractSeamsFromSource(source, 'runDiscussPipeline');
        expect(seams).toEqual({
            ctx: ['CONTEXT_CHAR_BUDGET', 'out.log()', 'recordChatRound()', 'workQueue.list()'],
            question: []
        });
    });

    it('AC2 & AC3: direct and nested method/property calls', () => {
        const source = `
        function handle(param) {
            param.method();
            param.sub.method();
            const x = param.sub.prop;
            const y = param.deep.nested.property.access();
        }
        `;
        const seams = extractSeamsFromSource(source, 'handle');
        expect(seams).toEqual({
            param: ['deep.nested.property.access()', 'method()', 'sub.method()', 'sub.prop']
        });
    });

    it('J2 & AC4: destructured object parameters and local destructuring aliases', () => {
        const sourceAnonymousDestructure = `
        export function render({ out, storage }) {
            out.write();
            storage.save();
        }
        `;
        expect(extractSeamsFromSource(sourceAnonymousDestructure, 'render')).toEqual({
            out: ['write()'],
            storage: ['save()']
        });

        const sourceWithDefaults = `
        export function renderWithDefaults({ out = defaultOut, storage } = {}) {
            out.write();
            storage.save();
        }
        `;
        expect(extractSeamsFromSource(sourceWithDefaults, 'renderWithDefaults')).toEqual({
            out: ['write()'],
            storage: ['save()']
        });

        const sourceDestructuredParam = `
        function processItems({ out, env }) {
            out.log(env);
        }
        `;
        const seamsParam = extractSeamsFromSource(sourceDestructuredParam, 'processItems');
        expect(seamsParam).toEqual({
            out: ['log()'],
            env: []
        });

        const sourceLocalDestructuring = `
        function execute(ctx) {
            const { out, workQueue } = ctx;
            out.log('started');
            workQueue.list();
        }
        `;
        const seamsLocal = extractSeamsFromSource(sourceLocalDestructuring, 'execute');
        expect(seamsLocal).toEqual({
            ctx: ['out.log()', 'workQueue.list()']
        });
    });

    it('AC5: optional chaining for methods and properties', () => {
        const source = `
        function optionalCall(param) {
            param?.sub?.method?.();
            const timeout = param?.config?.timeout;
        }
        `;
        const seams = extractSeamsFromSource(source, 'optionalCall');
        expect(seams).toEqual({
            param: ['config.timeout', 'sub.method()']
        });
    });

    it('J3 & AC6: unused/primitive parameters return empty lists, no params return empty object', () => {
        const sourceAdd = 'function add(a, b) { return a + b; }';
        expect(extractSeamsFromSource(sourceAdd, 'add')).toEqual({ a: [], b: [] });

        const sourceNoop = 'function noop() { return 42; }';
        expect(extractSeamsFromSource(sourceNoop, 'noop')).toEqual({});
    });

    it('AC8: class methods, arrow functions, and TypeScript syntax', () => {
        const classSource = `
        class Service {
            execute(ctx, flag) {
                ctx.start();
                if (flag) ctx.complete();
            }
        }
        `;
        expect(extractSeamsFromSource(classSource, 'execute')).toEqual({
            ctx: ['complete()', 'start()'],
            flag: []
        });

        const arrowSource = 'const handler = (ctx) => { ctx.send(); };';
        expect(extractSeamsFromSource(arrowSource, 'handler')).toEqual({
            ctx: ['send()']
        });

        const tsSource = `
        function typedRun(ctx: AppContext, question: string): void {
            ctx.out.log(question);
            ctx.recordChatRound();
        }
        `;
        expect(extractSeamsFromSource(tsSource, 'typedRun')).toEqual({
            ctx: ['out.log()', 'recordChatRound()'],
            question: []
        });
    });

    it('AC1: parameterSeams integrated into functionView', () => {
        const graph = createGraph('test');
        graph.addNode('file:pipeline.js', 'CodeFile', {
            path: 'pipeline.js',
            symbols: ['runDiscussPipeline'],
            symbolRanges: { runDiscussPipeline: [1, 5] },
            calls: []
        });
        const source = `function runDiscussPipeline(ctx, question) {
            ctx.out.log(question);
            ctx.recordChatRound();
            return question;
        }`;
        const view = functionView(graph, 'runDiscussPipeline', { readFile: () => source });
        expect(view.found).toBe(true);
        expect(view.parameterSeams).toEqual({
            ctx: ['out.log()', 'recordChatRound()'],
            question: []
        });
    });

    it('covers edge cases: line matching, invalid inputs, missing definitions and aliases', () => {
        const multiFn = 'function first(a) { a.one(); }\nfunction second(b) { b.two(); }';
        expect(extractSeamsFromSource(multiFn, null, 2)).toEqual({ b: ['two()'] });

        expect(extractSeamsFromSource(null, 'foo')).toEqual({});
        expect(extractSeamsFromSource('', 'foo')).toEqual({});
        expect(extractSeamsFromSource('function f() {}', 'missing')).toEqual({});
        expect(extractSeamsFromSource('invalid syntax ::::', 'f')).toEqual({});

        expect(parameterSeams([], 'test', () => null)).toEqual({});
        expect(parameterSeams([{ path: 'empty.js' }], 'test', () => ({ text: null }))).toEqual({});

        const withDefaults = 'function def(opt = {}) { opt.init(); }';
        expect(extractSeamsFromSource(withDefaults, 'def')).toEqual({ opt: ['init()'] });
    });
});
