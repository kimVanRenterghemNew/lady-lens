// Textual code search (grep en glob)
// TODO(coverage): Current line coverage is 67.14% (< 85% target). Raise to >= 85%.
import fs from 'fs';
import path from 'path';
import { REPO_ROOT, relativeToRepo } from '../configuration/index.js';
import { looksLikeRepoPath } from '../graph/index.js';
import { resolveInRepo } from './chunkReader.js';
import { createSearchExcluder, gitignoredPaths } from '../repository/index.js';
import { createGit } from '../git/index.js';

export { relativeToRepo as toRepoRelative };

export const MAX_GREP_RESULTS = 50;
export const MAX_GLOB_RESULTS = 200;

/** The caller's `limit` (a positive whole number), else the tool's own cap. */
const capOf = (args, fallback) => (Number.isInteger(args.limit) && args.limit > 0 ? args.limit : fallback);

/**
 * Walks `dir`; excluded paths are judged by the project's one rule, relative to `root`.
 * A start folder that is itself excluded was asked for explicitly (e.g. grep in outputs/...): it is searched, and inside it the
 * same rule applies with that folder as the base (so node_modules/.git/.memory stay out), as grep did before 15.28.
 */
const IGNORED_TTL_MS = 30_000;
const IGNORED = new Map(); // root -> { at, paths }
/** What git ignores under `root`, kept 30 s: `git ls-files` on every search made cross_repo_search 3x slower. */
export function gitIgnored(root, now = Date.now()) {
    const cached = IGNORED.get(root);
    if (cached && now - cached.at < IGNORED_TTL_MS) return cached.paths;
    const paths = createGit({ root }).ignoredPaths() ?? gitignoredPaths(root);
    IGNORED.set(root, { at: now, paths });
    return paths;
}

export function walkFiles(dir, visit, root, excluded = createSearchExcluder(undefined, gitIgnored(root))) {
    const base = excluded(relativeToRepo(dir, root)) ? dir : root;
    const walk = (current) => {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (excluded(relativeToRepo(full, base))) continue;
            if (entry.isDirectory()) walk(full);
            else visit(full);
        }
    };
    walk(dir);
}

/** The regex source of a glob without braces: `**\/` any folders, `**` anything, `*` anything but `/`. */
function globSource(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const withDoubleStarDir = escaped.replace(/\*\*\//g, '__DS_DIR__');
    const withDoubleStar = withDoubleStarDir.replace(/\*\*/g, '__DS__');
    const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
    return withSingleStar.replace(/__DS_DIR__/g, '(?:.*/)?').replace(/__DS__/g, '.*');
}

/** A glob as a regex; `{a,b}` is one of the alternatives (`{core,test}/**`), as in a shell. It matched nothing before. */
export function globToRegExp(pattern) {
    const alternatives = [];
    const marked = pattern.replace(/\{([^{}]*,[^{}]*)\}/g, (_, list) => `\0${alternatives.push(list.split(',')) - 1}\0`);
    const source = marked.split(/\0(\d+)\0/).map((part, i) => (i % 2 ? `(?:${alternatives[Number(part)].map(globSource).join('|')})` : globSource(part))).join('');
    return new RegExp(`^${source}$`);
}

export const MAX_LINE_LENGTH = 240;

/**
 * A long line (minified code, a JSON fixture of some KB) cut to the part around its first match, marked with `…`: whole,
 * one line used up the budget of the answer (6 of 50 matches shown).
 */
export function clipLine(line, regex) {
    const text = line.trim();
    if (text.length <= MAX_LINE_LENGTH) return text;
    regex.lastIndex = 0;
    const found = regex.exec(text);
    regex.lastIndex = 0;
    const start = Math.max(0, (found ? found.index : 0) - 80);
    const end = start + MAX_LINE_LENGTH;
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** `truncated`, the `offset` asked and, when more follow, `nextOffset`: where the next page starts. */
function pageOf(totalCount, offset, shown) {
    const truncated = totalCount > offset + shown;
    return { truncated, ...(offset ? { offset } : {}), ...(truncated ? { nextOffset: offset + shown } : {}) };
}

function matchFirstPerFile(lines, regex, offset, rel, found, state) {
    const i = lines.findIndex(line => regex.test(line));
    if (i < 0) return;
    state.count += 1;
    if (state.count > offset) found.push({ file: rel, line: i + 1, text: clipLine(lines[i], regex) });
}

/** @param {{root?: string}} [deps] - the repo to search. */
/** `acceptFile(rel)` limits the search to some files BEFORE the result cap (config_grep: only configuration files). */
export function grep(args = {}, { root = REPO_ROOT, acceptFile = () => true } = {}) {
    const { pattern, path: scopePath, firstPerFile = false } = args;
    const cap = capOf(args, MAX_GREP_RESULTS);
    const offset = Number.isInteger(Number(args.offset)) && Number(args.offset) > 0 ? Number(args.offset) : 0;
    if (typeof pattern !== 'string' || pattern.length === 0) return { error: 'pattern is required' };

    const isGlob = typeof scopePath === 'string' && /[*?{]/.test(scopePath);
    const globRoot = isGlob ? scopePath.slice(0, Math.max(0, scopePath.search(/[*?{]/))).replace(/[^/\\]*$/, '') : scopePath;
    const scopeAbs = globRoot ? resolveInRepo(globRoot) : root;
    if (globRoot && !scopeAbs) return { error: `unsafe path (outside repo, or under .git/.memory/node_modules): ${scopePath}` };
    const globRegex = isGlob ? globToRegExp(scopePath.replace(/\\/g, '/').replace(/^\.\//, '')) : null;
    if (!isGlob && scopePath && !fs.existsSync(scopeAbs)) return { error: `path does not exist: ${scopePath}. Leave path out to search the whole repo, or use glob to find the directory.` };

    let regex;
    try {
        regex = new RegExp(pattern, args.ignoreCase === true ? 'i' : '');
    } catch (error) {
        return { error: `invalid pattern: ${error.message}` };
    }

    const search = (searchRoot, accept = () => true) => {
        const found = [];
        const state = { count: 0 };
        const searchFile = (file) => {
            const rel = relativeToRepo(file, root);
            if (!accept(rel)) return;
            let text;
            try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
            if (text.includes('\0')) return; // binary (a Mendix .mpr, mxcli's catalog.db): its text is in readable files
            const lines = text.split(/\r?\n/); // CRLF: a \r left on the line made `$` in a pattern match nothing
            if (firstPerFile) {
                matchFirstPerFile(lines, regex, offset, rel, found, state);
                return;
            }
            lines.forEach((line, i) => {
                if (!regex.test(line)) return;
                state.count += 1;
                if (state.count > offset && found.length < cap) found.push({ file: rel, line: i + 1, text: clipLine(line, regex) });
            });
        };
        if (fs.existsSync(searchRoot) && fs.statSync(searchRoot).isFile()) searchFile(searchRoot);
        else walkFiles(searchRoot, searchFile, root);
        return { found, count: state.count };
    };

    const { found: matches, count: totalCount } = search(scopeAbs, (rel) => acceptFile(rel) && (!globRegex || globRegex.test(rel)));
    const result = { matches, totalCount, ...pageOf(totalCount, offset, matches.length) };
    if (totalCount === 0 && looksLikeRepoPath(pattern.replace(/\\(.)/g, '$1'))) {
        result.hint = 'No text matches. For "which files import X / what does X import" use importedBy({file}) / imports({file}); they read the import graph, grep cannot.';
    }
    if (totalCount === 0 && scopePath) {
        const { found, count } = search(root, acceptFile);
        if (count > 0) {
            result.elsewhere = found.slice(0, 5).map(({ file, line }) => ({ file, line }));
            result.hint = `0 matches in ${scopePath}; ${count} elsewhere in the repo, e.g. ${result.elsewhere[0].file}:${result.elsewhere[0].line}. Search without path, or read that file.`;
        }
    }
    return result;
}

export function glob(args = {}, { root = REPO_ROOT } = {}) {
    const { pattern } = args;
    if (typeof pattern !== 'string' || pattern.length === 0) return { error: 'pattern is required' };
    let regex;
    try { regex = globToRegExp(pattern); } catch (error) { return { error: `invalid pattern: ${error.message}` }; }
    const results = [];
    const cap = capOf(args, MAX_GLOB_RESULTS);
    let totalCount = 0;
    walkFiles(root, (file) => {
        const rel = relativeToRepo(file, root);
        if (!regex.test(rel)) return;
        totalCount += 1;
        if (results.length < cap) results.push(rel);
    }, root);
    return { paths: results, totalCount, truncated: totalCount > results.length };
}
