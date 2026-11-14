/**
 * Traces (LENS_TRACE_FILE): one JSON line per span in Kura's span shape, so a slow `lens ask` shows which step took the time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { debugStep, traceAsync, startSpan } from '../core/observability/index.js';

let dir;
let file;
const spans = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []);

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-trace-'));
    file = path.join(dir, 'traces.jsonl');
});
afterEach(() => {
    delete process.env.LENS_TRACE_FILE;
    delete process.env.TRACEPARENT;
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('traces', () => {
    it('writes nothing without LENS_TRACE_FILE, and the step still runs', async () => {
        expect(await debugStep('sync', 'scan', () => 42)).toBe(42);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('a step inside a command is its child, with its summary', async () => {
        process.env.LENS_TRACE_FILE = file;
        await traceAsync('lens ask', {}, () => debugStep('sync', 'scan', () => [1, 2, 3], list => `${list.length} files`));
        const [step, command] = spans();
        expect(command).toMatchObject({ name: 'lens ask', parent_span_id: null, status: { code: 'OK' } });
        expect(step).toMatchObject({ name: 'sync: scan', trace_id: command.trace_id, parent_span_id: command.span_id, attributes: { 'lens.summary': '3 files' } });
        expect(step.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('a failing step is an ERROR span and still throws', async () => {
        process.env.LENS_TRACE_FILE = file;
        await expect(debugStep('sync', 'write to graph', () => { throw new Error('locked'); })).rejects.toThrow('locked');
        expect(spans()[0]).toMatchObject({ name: 'sync: write to graph', status: { code: 'ERROR', message: 'locked' }, attributes: { 'error.type': 'Error' } });
    });

    it('joins the caller\'s trace through TRACEPARENT', () => {
        process.env.LENS_TRACE_FILE = file;
        process.env.TRACEPARENT = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
        startSpan('tool: graph_query').end();
        expect(spans()[0]).toMatchObject({ trace_id: 'a'.repeat(32), parent_span_id: 'b'.repeat(16) });
    });

    it('lens tools: the command is the root span, loading the modules its child', () => {
        execFileSync(process.execPath, ['bin/lens.mjs', 'tools'], { encoding: 'utf8', env: { ...process.env, LENS_TRACE_FILE: file, TRACEPARENT: '', LENS_NODE_CHILD: '1' } });
        const root = spans().find(span => span.name === 'lens tools');
        expect(root).toMatchObject({ parent_span_id: null, attributes: { 'process.exit_code': 0 } });
        expect(root.attributes['node.startup_ms']).toBeGreaterThan(0);
        expect(spans().find(span => span.name === 'load modules')).toMatchObject({ trace_id: root.trace_id, parent_span_id: root.span_id });
    });
});
