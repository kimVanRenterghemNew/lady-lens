/**
 * The comment that documents one definition: a block comment (JSDoc, C# XML doc) or `//` / `#` / `///` lines directly
 * above its first line (attributes and decorators in between are skipped), or a Python docstring right below a `def`.
 * functionView gave the purpose of the file instead, which is the doc of the first function in a file without a header.
 */
const MAX_CHARS = 240;
const ATTRIBUTE = /^\s*(?:@[\w.]+|\[[\w.]+.*\])\s*(?:\(.*\))?\s*$/;
const LINE_COMMENT = /^\s*(?:\/\/\/?|#(?!!))/;

const clean = parts => parts.join(' ').replace(/<\/?[a-z]+[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS) || null;
/** The description only: what comes before the first `@param`-style tag. */
const beforeTags = lines => lines.slice(0, Math.max(0, lines.findIndex(line => /^@\w/.test(line))) || lines.length);

function blockAbove(lines, end) {
    let start = end;
    while (start >= 0 && !lines[start].includes('/*')) start--;
    if (start < 0) return null;
    const body = lines.slice(start, end + 1).map(line => line.replace(/\*\/\s*$/, '').replace(/^\s*\/\*\*?/, '').replace(/^\s*\*\s?/, '').trim()).filter(Boolean);
    const described = beforeTags(body);
    return clean(described.length ? described : body);
}

function linesAbove(lines, end) {
    let start = end;
    while (start - 1 >= 0 && LINE_COMMENT.test(lines[start - 1])) start--;
    return clean(lines.slice(start, end + 1).map(line => line.replace(LINE_COMMENT, '').trim()));
}

const lineAt = (lines, index) => String(lines[index] ?? '').trim();

/** A Python docstring on the line(s) below the `def` (0-based `index` of its first line). */
function docstringBelow(lines, index) {
    const first = lineAt(lines, index);
    const quote = ['"""', "'''"].find(mark => first.startsWith(mark));
    if (!quote) return null;
    const close = lines.findIndex((line, i) => i > index && line.includes(quote));
    const body = first.slice(3).includes(quote) ? [first.slice(3)] : [first.slice(3), ...lines.slice(index + 1, close < 0 ? lines.length : close + 1)];
    return clean(body.map(line => line.replace(quote, '').trim()));
}

/** The first line at or above `index` that is no attribute or decorator (`@Injectable()`, `[HttpGet]`). */
function aboveAttributes(lines, index) {
    let end = index;
    while (end >= 0 && ATTRIBUTE.test(lines[end])) end--;
    return end;
}

const READERS = [
    { applies: above => above.endsWith('*/'), read: blockAbove },
    { applies: above => LINE_COMMENT.test(above), read: linesAbove }
];

/** The doc comment of the definition that starts on 1-based `startLine` in `text`, or null. */
export function docCommentAt(text, startLine) {
    if (typeof text !== 'string' || !Number.isInteger(startLine)) return null;
    const lines = text.split(/\r?\n/);
    const end = aboveAttributes(lines, startLine - 2);
    const reader = READERS.find(({ applies }) => applies(lineAt(lines, end)));
    return reader ? reader.read(lines, end) : docstringBelow(lines, startLine);
}
