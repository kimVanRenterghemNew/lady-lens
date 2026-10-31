/** The vitest setup drops the shell's LENS_* variables and gives every worker its own graph database. */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SETUP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'setup', 'isolateGraph.js');

describe('test/setup/isolateGraph.js', () => {
    it('MUST drop LENS_* from the shell, set its own graph database, and leave other variables alone', () => {
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SETUP).href)}); console.log(JSON.stringify(process.env))`], {
            env: { ...process.env, LENS_TOOL_RESULT_CHARS: '10', LENS_GRAPH_DB: '/real/graph.lbdb', MY_OTHER: 'keep' },
            encoding: 'utf8'
        });
        const env = JSON.parse(out);
        expect(env.LENS_TOOL_RESULT_CHARS).toBeUndefined();
        expect(env.LENS_GRAPH_DB).not.toBe('/real/graph.lbdb');
        expect(env.LENS_GRAPH_DB).toMatch(/lens-test-graph/);
        expect(env.MY_OTHER).toBe('keep');
    });
});
