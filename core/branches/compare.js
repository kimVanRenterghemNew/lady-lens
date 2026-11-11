/**
 * Comparing two versions of a file: functions added, removed, modified or renamed, and the imports and calls that
 * came or went. Functions are compared by name and a hash of the body; a rename is a removed and an added function
 * whose bodies are alike once their own name is left out.
 */
import crypto from 'crypto';
import { analyzeSource, analyzeSourceForLanguage } from '../graph/index.js';

const RENAME_SIMILARITY = 0.6;

const analyze = (source, filePath) => (/\.[cm]?jsx?$/i.test(filePath) ? analyzeSource(source) : analyzeSourceForLanguage(source, filePath));

/** Function name to hash, body and line; a repeated name gets `#2`, `#3`, ... Also the imports and calls of the source. */
function parse(source, filePath) {
    const parsed = { functions: new Map(), imports: [], calls: [] };
    if (source == null) return parsed;
    const lines = source.split(/\r?\n/);
    const facts = analyze(source, filePath);
    for (const fn of facts.functions || []) {
        const [start, end] = fn.loc || [fn.startLine, fn.endLine];
        const body = lines.slice(start - 1, end).map(line => line.trimEnd()).join('\n');
        let name = fn.name;
        for (let n = 2; parsed.functions.has(name); n++) name = `${fn.name}#${n}`;
        parsed.functions.set(name, { hash: crypto.createHash('sha1').update(body).digest('hex'), body, line: start });
    }
    parsed.imports = facts.imports || [];
    parsed.calls = (facts.calls || []).map(([from, to, line]) => ({ from, to, line }));
    return parsed;
}

const baseName = name => name.replace(/#\d+$/, '');

const changeOf = (name, current, old, file) => {
    if (!old) return { file, name, change: 'added', line: current.line, body: current.body };
    if (old.hash !== current.hash) return { file, name, change: 'modified', line: current.line };
    return null;
};

function functionChanges(before, after, filePath, oldPath) {
    const addedOrModified = [...after.functions]
        .map(([name, current]) => changeOf(name, current, before.functions.get(name), filePath))
        .filter(Boolean);
    const removed = [...before.functions]
        .filter(([name]) => !after.functions.has(name))
        .map(([name, { body, line }]) => ({ file: oldPath, name, change: 'removed', line, body }));
    return [...addedOrModified, ...removed];
}

/** Functions added, removed and modified between two versions of one file (no rename detection). */
export function compareFunctions(beforeSource, afterSource, { path: filePath, oldPath = filePath }) {
    return functionChanges(parse(beforeSource, oldPath), parse(afterSource, filePath), filePath, oldPath)
        .map(({ body, ...change }) => change);
}

const words = (body, name) => new Set(body.replace(new RegExp(`\\b${baseName(name).replace(/[$]/g, '\\$&')}\\b`, 'g'), ' ').match(/\w+/g) || []);

function similarity(a, b) {
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    return a.size + b.size - shared ? shared / (a.size + b.size - shared) : 0;
}

/**
 * A removed and an added function become one `renamed` entry (`oldName`, `oldFile`, `bodyChanged`) when they sit in the same file
 * (or the file itself was renamed) and their bodies are alike without their names. Every pair is used once, best match first.
 */
function pairRenames(changes, renamedFiles) {
    const removed = changes.filter(change => change.change === 'removed');
    const added = changes.filter(change => change.change === 'added');
    const isSameOrRenamedFile = (gone, fresh) => gone.file === fresh.file || renamedFiles.get(gone.file) === fresh.file;
    const strip = ({ body, name }) => body.split(baseName(name)).join('');

    const candidates = removed.flatMap(gone =>
        added
            .filter(fresh => isSameOrRenamedFile(gone, fresh))
            .map(fresh => ({
                gone,
                fresh,
                score: similarity(words(gone.body, gone.name), words(fresh.body, fresh.name)),
                bodyChanged: strip(gone) !== strip(fresh)
            }))
    );

    const used = new Set();
    const renamed = [];
    const sortedCandidates = candidates
        .filter(c => c.score >= RENAME_SIMILARITY)
        .sort((x, y) => y.score - x.score);

    for (const { gone, fresh, bodyChanged } of sortedCandidates) {
        if (!used.has(gone) && !used.has(fresh)) {
            used.add(gone);
            used.add(fresh);
            renamed.push({ file: fresh.file, name: fresh.name, change: 'renamed', oldName: gone.name, oldFile: gone.file, line: fresh.line, bodyChanged });
        }
    }
    return [...changes.filter(change => !used.has(change)), ...renamed];
}

const key = relation => `${relation.from}\u0000${relation.to}`;

function relationChanges(file, before, after, renames) {
    const rename = name => renames.get(name) || name;
    const result = [];
    const oldCalls = new Map(before.calls.map(call => [key({ from: rename(call.from), to: rename(call.to) }), call]));
    const newCalls = new Map(after.calls.map(call => [key(call), call]));
    for (const [id, call] of newCalls) if (!oldCalls.has(id)) result.push({ file, type: 'calls', change: 'added', from: call.from, to: call.to, line: call.line });
    for (const [id, call] of oldCalls) if (!newCalls.has(id)) result.push({ file, type: 'calls', change: 'removed', from: call.from, to: call.to, line: call.line });
    for (const specifier of after.imports) if (!before.imports.includes(specifier)) result.push({ file, type: 'imports', change: 'added', to: specifier });
    for (const specifier of before.imports) if (!after.imports.includes(specifier)) result.push({ file, type: 'imports', change: 'removed', to: specifier });
    return result;
}

/**
 * Compare every changed file `[{ file, beforeSource, afterSource }]` (`file` is `{ path, oldPath? }`).
 * @returns {{functions: object[], relations: object[]}}
 */
export function compareFiles(entries) {
    const changes = [];
    const relations = [];
    const renamedFiles = new Map();
    const parsed = entries.map(({ file, beforeSource, afterSource }) => {
        const oldPath = file.oldPath || file.path;
        if (oldPath !== file.path) renamedFiles.set(oldPath, file.path);
        const pair = { file, before: parse(beforeSource, oldPath), after: parse(afterSource, file.path) };
        changes.push(...functionChanges(pair.before, pair.after, file.path, oldPath));
        return pair;
    });
    const functions = pairRenames(changes, renamedFiles).map(({ body, ...change }) => change);
    for (const { file, before, after } of parsed) {
        const renames = new Map(functions.filter(fn => fn.change === 'renamed' && fn.file === file.path).map(fn => [fn.oldName, fn.name]));
        relations.push(...relationChanges(file.path, before, after, renames));
    }
    return { functions, relations };
}
