/**
 * Small files with one responsibility, and no mixed languages in one file.
 *  - No source file over 200 lines. What is bigger today is in TOO_BIG with its current length: it may only
 *    shrink (a ratchet, like the coverage threshold). When it shrinks, lower the number; under 200: remove the entry.
 *  - No HTML or CSS in a .js file: markup lives in .html, style in .css. What breaks that today is in MARKUP_IN_JS,
 *    which may only shrink.
 * Generated files (`*.generated.*`) do not count.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 200;
const SOURCE = /\.(m?js|html|css)$/;

/** Too big today, with the maximum each may still have. Only lower. */
const TOO_BIG = Object.freeze({
    'core/graph/model/graphModel.js': 209,
    'core/graph/query/graphQuery.js': 244,
    'core/graph/query/graphRank.js': 221,
    'core/graph/query/graphSemantic.js': 238,
    'core/graph/query/importLookup.js': 221,
    'core/graph/sync/codeFacts.js': 215,
    'core/graph/sync/graphSync.js': 271,
    'core/mcp/httpServer.js': 281,
});

/** .js files that still contain markup. Only remove entries. */
const MARKUP_IN_JS = Object.freeze(['core/mcp/httpServer.js']);

/** Text that points to markup in a .js file (an HTML tag or a style block). */
const MARKUP = /<(?:!doctype|html|head|body|div|span|table|tr|td|style|script|button|input|form|section|main|p)[\s>/]/i;

function sources(dir, out = []) {
    if (!fs.existsSync(path.join(ROOT, dir))) return out;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) sources(rel, out);
        else if (SOURCE.test(entry.name) && !entry.name.includes('.generated.')) out.push(rel);
    }
    return out;
}

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const lines = file => read(file).split('\n').length - 1;

/** Too long: over the limit and not in the exception list (or over its maximum). */
const tooLong = (files, count, allowed) => files
    .map(file => ({ file, n: count(file) }))
    .filter(({ file, n }) => n > (allowed[file] ?? LIMIT))
    .map(({ file, n }) => `${file}: ${n} lines (max. ${allowed[file] ?? LIMIT})`);

/** .js files with markup in them, minus the exceptions. */
const mixed = (files, text, allowed = MARKUP_IN_JS) => files.filter(f => /\.m?js$/.test(f) && !allowed.includes(f) && MARKUP.test(text(f)));

describe('code structure', () => {
    const files = ['core', 'ui', 'bin', 'scripts', 'evals'].flatMap(dir => sources(dir));

    it(`no source file over ${LIMIT} lines, except the exceptions (which may only shrink)`, () => {
        expect(tooLong(files, lines, TOO_BIG)).toEqual([]);
    });

    it('the exception list only holds files that are still too big (otherwise: remove it or lower it)', () => {
        const stale = Object.entries(TOO_BIG).filter(([file, max]) => !fs.existsSync(path.join(ROOT, file)) || lines(file) <= LIMIT || lines(file) < max);
        expect(stale.map(([file, max]) => `${file}: list ${max}, now ${fs.existsSync(path.join(ROOT, file)) ? lines(file) : 'gone'}`)).toEqual([]);
    });

    it('no HTML or CSS in .js files (markup in .html, style in .css), except the exceptions', () => {
        expect(mixed(files, read)).toEqual([]);
    });

    it('the markup exception list only holds files that still contain markup', () => {
        expect(MARKUP_IN_JS.filter(f => !fs.existsSync(path.join(ROOT, f)) || !MARKUP.test(read(f)))).toEqual([]);
    });

    it('MUST reject: a new file of 201 lines, an exception that grows, and HTML in a .js file', () => {
        expect(tooLong(['core/x/index.js', 'core/graph/sync/graphSync.js'], f => (f === 'core/x/index.js' ? 201 : 278), TOO_BIG))
            .toEqual(['core/x/index.js: 201 lines (max. 200)', 'core/graph/sync/graphSync.js: 278 lines (max. 271)']);
        const text = f => (f === 'core/x/page.js' ? 'return `<div class="card">`;' : 'const a = 1 < 2;');
        expect(mixed(['core/x/page.js', 'core/x/ok.js'], text)).toEqual(['core/x/page.js']);
    });
});
