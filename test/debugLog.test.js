import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { debug, configureLensLog } from '../core/observability/index.js';
import { configureLensEnv } from '../core/configuration/index.js';

describe('debugLog', () => {
    let tmpFile;

    beforeEach(() => {
        configureLensLog({ debug: null });
        tmpFile = path.join(os.tmpdir(), `lens-debug-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    });

    afterEach(() => {
        configureLensLog({ debug: null });
        configureLensEnv({ DEBUG_LOG_FILE: '', DEBUG_LEVEL: '' });
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    });

    it('silently ignores debug calls when no file or host logger is set', () => {
        expect(() => debug(1, 'TEST', 'should not throw')).not.toThrow();
    });

    it('forwards to custom host logger when configured', () => {
        const logs = [];
        configureLensLog({
            debug: (level, tag, msg) => { logs.push({ level, tag, msg }); }
        });

        debug(1, 'QUERY', 'query executed');
        expect(logs).toEqual([{ level: 1, tag: 'QUERY', msg: 'query executed' }]);

        configureLensLog({ debug: 'not-a-function' });
        expect(() => debug(1, 'TEST', 'msg')).not.toThrow();
    });

    it('appends string and lazy function messages to DEBUG_LOG_FILE when within DEBUG_LEVEL', () => {
        configureLensEnv({}, { DEBUG_LOG_FILE: tmpFile, DEBUG_LEVEL: '2' });

        // level 3 > level 2: ignored
        debug(3, 'TRACE', 'should be skipped');
        expect(fs.existsSync(tmpFile)).toBe(false);

        // level 1 <= 2: string written
        debug(1, 'INFO', 'string message');
        // level 2 <= 2: function message evaluated and written
        debug(2, 'BENCH', () => 'lazy function message');

        const content = fs.readFileSync(tmpFile, 'utf8');
        expect(content).toContain('[INFO] string message');
        expect(content).toContain('[BENCH] lazy function message');
        expect(content).not.toContain('TRACE');
    });

    it('handles file write errors gracefully without throwing', () => {
        // Point to an invalid directory path that cannot be written
        const invalidFile = path.join(os.tmpdir(), 'non-existent-dir-12345', 'file.log');
        configureLensEnv({}, { DEBUG_LOG_FILE: invalidFile, DEBUG_LEVEL: '2' });

        expect(() => debug(1, 'ERROR_TEST', 'must not throw')).not.toThrow();
    });
});
