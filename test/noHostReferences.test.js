/** lady-lens stands on its own: no code, comment or setting names the application it came from. */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

describe('lady-lens has no references to its origin', () => {
    it('MUST NOT mention its origin project or a KURA_ variable in core/, bin/ or ui/', () => {
        const hits = ['core', 'bin', 'ui'].flatMap(files).filter(f => /\b[Kk]ura\b|KURA_/.test(fs.readFileSync(f, 'utf8')));
        expect(hits).toEqual([]);
    });
});
