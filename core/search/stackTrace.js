// A pasted stack trace (Node, .NET, Python, Java) as frames, each tied to a file and function of the project.
// Lines that are not frames are skipped; a path from another machine is matched on its longest tail of folders.

const FORMATS = [
    // Node: `at name (path:line:col)` or `at path:line:col`
    { re: /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?((?:file:\/\/)?[^()\s][^()]*?):(\d+):(\d+)\)?\s*$/, pick: m => ({ name: m[1] ?? null, file: m[2], line: +m[3], column: +m[4] }) },
    // Java: `at [module/]pkg.Class.method(File.java:42)` or `(Native Method)`; the package gives the folders (before .NET, which would also take it)
    { re: /^\s*at\s+(?:[\w.@-]+\/)?([\w.$]+)\.([\w$<>]+)\((?:([^:()]+\.\w+):(\d+)|[^():]*)\)\s*$/, pick: m => ({ name: m[2], file: m[3] ? [...m[1].split('.').slice(0, -1), m[3]].join('/') : null, line: m[4] ? +m[4] : null }) },
    // .NET: `at Ns.Class.Method(args) in path:line 42` (without `in` there is no file)
    { re: /^\s*at\s+([\w.<>`$+|[\],]+)\(.*?\)(?:\s+in\s+(.+):line\s+(\d+))?\s*$/, pick: m => ({ name: m[1], file: m[2] ?? null, line: m[3] ? +m[3] : null }) },
    // Python: `File "path", line 12, in name`
    { re: /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+?))?\s*$/, pick: m => ({ name: m[3] ?? null, file: m[1], line: +m[2] }) }
];
const LIBRARY = /(^|\/)(node_modules|site-packages|dist-packages|lib\/python[\d.]*)\/|^node:|^internal\//;

function parseLineFrame(raw) {
    for (const { re, pick } of FORMATS) {
        const match = raw.match(re);
        if (match) return { raw: raw.trim(), ...pick(match) };
    }
    return null;
}

/** Frames in the order of the trace: `{ raw, name, file, line, column? }`; other lines are left out. */
export function parseStackTrace(text) {
    return String(text ?? '').split(/\r?\n/).map(parseLineFrame).filter(Boolean);
}

const segments = file => file.replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
const tailMatch = (frameParts, fileParts) => {
    let n = 0;
    while (n < frameParts.length && n < fileParts.length && frameParts[frameParts.length - 1 - n] === fileParts[fileParts.length - 1 - n]) n++;
    return n;
};

function isRangeMatch(range, line) {
    return Array.isArray(range) && range[0] <= line && line <= range[1];
}

function isSmallerRange(range, best) {
    if (!best) return true;
    return (range[1] - range[0]) < (best.range[1] - best.range[0]);
}

function isCandidate(range, line, best) {
    return isRangeMatch(range, line) && isSmallerRange(range, best);
}

/** The innermost symbol whose range holds the line. */
function symbolAt(node, line) {
    const ranges = node ? node.symbolRanges : null;
    if (!ranges) return null;
    let best = null;
    for (const [name, range] of Object.entries(ranges)) {
        if (isCandidate(range, line, best)) best = { name, range };
    }
    return best;
}

function located(node, line) {
    if (!line) return { path: node.path, symbol: null, range: null };
    const symbol = symbolAt(node, line);
    if (!symbol) return { path: node.path, symbol: null, range: null };
    return { path: node.path, symbol: symbol.name, range: symbol.range };
}

function findMatchingFiles(parts, files) {
    let best = 0, hits = [];
    for (const file of files) {
        const n = tailMatch(parts, file.parts);
        if (n > best) {
            best = n;
            hits = [];
        }
        if (n && n === best) hits.push(file.node);
    }
    return hits;
}

function resolveFrameStatus(frame, hits, isFirst) {
    if (!hits.length) return { ...frame, status: 'notFound' };
    if (hits.length > 1) {
        const candidates = hits.map(node => located(node, frame.line));
        return { ...frame, status: 'ambiguous', candidates };
    }
    const loc = located(hits[0], frame.line);
    if (isFirst) return { ...frame, status: 'project', ...loc, start: true };
    return { ...frame, status: 'project', ...loc };
}

function isLibraryFrame(parts) {
    return !parts.length || LIBRARY.test(parts.join('/'));
}

/**
 * Ties each frame to a code file of the project (the file with the longest matching tail of folders) and the function
 * at its line. status: `project` (one file), `ambiguous` (several equal; see `candidates`), `notFound`, `library`.
 */
export function locateFrames(frames, nodes) {
    const files = nodes.filter(node => node.type === 'CodeFile' && typeof node.path === 'string').map(node => ({ node, parts: segments(node.path) }));
    let startSet = false;
    return frames.map(frame => {
        const parts = frame.file ? segments(frame.file) : [];
        if (isLibraryFrame(parts)) return { ...frame, status: 'library' };
        const hits = findMatchingFiles(parts, files);
        const isFirst = !startSet && hits.length === 1;
        if (isFirst) startSet = true;
        return resolveFrameStatus(frame, hits, isFirst);
    });
}

/** Parse and locate in one step: the answer of `/api/trace`. */
export function traceView(text, nodes) {
    const frames = locateFrames(parseStackTrace(text), nodes);
    return { frames, counts: Object.fromEntries(['project', 'ambiguous', 'notFound', 'library'].map(s => [s, frames.filter(f => f.status === s).length])) };
}
