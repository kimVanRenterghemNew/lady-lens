/**
 * frontmatter is read by knowledge, task import and backlog. What we write must be what we read back,
 * and hand-written (not quite YAML) frontmatter must never throw.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseFrontmatter, stringifyFrontmatter } from '../core/configuration/index.js';

const key = fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,10}$/);
// JSON values the way task/knowledge frontmatter uses them (no undefined, no -0, no non-finite numbers).
const scalar = fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean(), fc.constant(null), fc.double({ noNaN: true, noDefaultInfinity: true }).filter(n => !Object.is(n, -0)));
const value = fc.letrec(tie => ({
    value: fc.oneof({ depthSize: 'small' }, scalar, fc.array(tie('value'), { maxLength: 4 }), fc.dictionary(key, tie('value'), { maxKeys: 4 }))
})).value;
const frontmatter = fc.dictionary(key, value, { maxKeys: 8 });

describe('frontmatter properties', () => {
    it('parse(stringify(x)) === x for any JSON-shaped frontmatter', () => {
        fc.assert(fc.property(frontmatter, fc.string({ maxLength: 40 }), (fm, body) => {
            const content = stringifyFrontmatter(fm, body);
            expect(parseFrontmatter(content)).toEqual(fm);
            expect(content.endsWith(body)).toBe(true);
        }), { numRuns: 400 });
    });

    it('parsing arbitrary text never throws and always returns a plain object', () => {
        fc.assert(fc.property(fc.string({ maxLength: 200 }), fc.constantFrom('\n', '\r\n'), (inner, eol) => {
            const result = parseFrontmatter(`---${eol}${inner}${eol}---${eol}body`);
            expect(result).toBeTypeOf('object');
            expect(Array.isArray(result)).toBe(false);
        }), { numRuns: 400 });
    });

    it('undefined values are dropped, not written as null', () => {
        expect(parseFrontmatter(stringifyFrontmatter({ a: 1, b: undefined }))).toEqual({ a: 1 });
    });
});

describe('lenient parser for hand-written frontmatter', () => {
    // Each input below is NOT valid YAML (duplicate keys, tabs, stray quotes), so the lenient fallback parses it.
    const lenient = (yaml) => parseFrontmatter(`---\n${yaml}\n---\nbody`);

    it('reads scalars: quoted strings, numbers, booleans and null', () => {
        const fm = lenient('id: X\nid: TASK-1\ntitle: "Say \\"hi\\""\ncount: 3\ndone: true\nopen: false\nowner: null\nempty:\nquoted: \'single\'');
        expect(fm).toEqual({ id: 'TASK-1', title: 'Say "hi"', count: 3, done: true, open: false, owner: null, empty: null, quoted: 'single' });
    });

    it('reads a dash list of scalars and of objects with indented properties', () => {
        const fm = lenient('id: A\nid: B\nfiles:\n  - "core/a.js"\n  - core/b.js\npaths:\n  - path: core/x.js\n    status: grounded\n\n    note: "a: b"\n  -\n    path: core/y.js\n    junk\n  - path: core/z.js\n  shallow: ignored\nnext: 1');
        expect(fm.id).toBe('B');
        expect(fm.files).toEqual(['core/a.js', 'core/b.js']);
        expect(fm.paths).toEqual([
            { path: 'core/x.js', status: 'grounded', note: 'a: b' },
            { path: 'core/y.js' },
            { path: 'core/z.js' }
        ]);
        expect(fm.next).toBe(1);
    });

    it('skips lines without a colon and indented lines that belong to nothing', () => {
        expect(lenient('id: A\nid: B\njust text\n   orphan: 1\nok: yes')).toEqual({ id: 'B', ok: 'yes' });
    });

    it('a document without a closing fence has no frontmatter', () => {
        expect(parseFrontmatter('---\nid: 1\nno fence')).toEqual({});
    });

    it('YAML that parses to a scalar or list falls back to the lenient parser', () => {
        expect(parseFrontmatter('---\n- a\n- b\n---\n')).toEqual({});
        expect(parseFrontmatter('---\njust a string\n---\n')).toEqual({});
    });
});
