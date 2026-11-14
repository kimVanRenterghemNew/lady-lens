/**
 * What `.gitignore` leaves out, read without git: for a folder git refuses ("dubious ownership", the folder belongs to another
 * Windows user) or a folder without git. Same answer shape as `git ls-files --others --ignored --directory`: a folder ends in '/'.
 * shortcut: only `.gitignore` files (no .git/info/exclude, no global excludesFile); upgrade if a repo needs those.
 * @module core/repository/gitignoreRules
 */
// 2026-11-13: git refused a Mendix project, so nothing was ignored and the sync parsed its generated client code (65,858 functions, 82 s)
import fs from 'fs';
import path from 'path';

const SPECIAL = /[.+^${}()|\\]/g;

/** One glob of a `.gitignore` line as a regex source: `**` any folders, `*` and `?` within one name. */
function globSource(glob) {
    return glob.replace(SPECIAL, '\\$&')
        .replace(/\*\*\//g, '\uE000').replace(/\/\*\*$/, '/\uE001').replace(/\*\*/g, '\uE001')
        .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
        .replace(/\uE000/g, '(?:.*/)?').replace(/\uE001/g, '.*');
}

/** A `.gitignore` line as a rule, or null for a blank line or a comment. `base`: the folder of that `.gitignore`. */
export function parseRule(line, base = '') {
    const text = line.replace(/\s+$/, '');
    if (!text || text.startsWith('#')) return null;
    const negate = text.startsWith('!');
    const body = negate ? text.slice(1) : text;
    const directoryOnly = body.endsWith('/');
    const glob = body.replace(/\/+$/, '');
    // a slash at the start or in the middle anchors the pattern at its .gitignore; without one it matches a name at any depth
    const anchored = glob.includes('/');
    const regex = new RegExp(`^${globSource(glob.replace(/^\//, ''))}$`);
    return { negate, directoryOnly, anchored, regex, base };
}

/** `relativePath` seen from the folder of the rule's .gitignore, or null when it lies outside that folder. */
function localPath(rule, relativePath) {
    if (!rule.base) return relativePath;
    return relativePath.startsWith(`${rule.base}/`) ? relativePath.slice(rule.base.length + 1) : null;
}

function ruleMatches(rule, relativePath, isDirectory) {
    const local = localPath(rule, relativePath);
    if (local === null || (rule.directoryOnly && !isDirectory)) return false;
    return rule.regex.test(rule.anchored ? local : path.posix.basename(local));
}

/** The last rule that matches decides, as in git: `!` brings a path back. */
export function isIgnoredBy(rules, relativePath, isDirectory) {
    let ignored = false;
    for (const rule of rules) if (ruleMatches(rule, relativePath, isDirectory)) ignored = !rule.negate;
    return ignored;
}

function readRules(directory, base) {
    try {
        return fs.readFileSync(path.join(directory, '.gitignore'), 'utf8').split(/\r?\n/).map(line => parseRule(line, base)).filter(Boolean);
    } catch {
        return [];
    }
}

function entriesOf(directory) {
    try { return fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

/**
 * Every ignored path under `root`, the highest one only (an ignored folder is not entered, as git does): files as
 * `a/b.js`, folders as `a/deployment/`. `.git` is never walked.
 * @param {string} root
 * @returns {string[]}
 */
export function gitignoredPaths(root) {
    const found = [];
    walkIgnored(root, '', [], found);
    return found.sort();
}

function walkIgnored(directory, relative, inherited, found) {
    const entries = entriesOf(directory);
    // only a .gitignore that is there is read: a sync that reads nothing for unchanged files stays that way
    const own = entries.some(item => item.name === '.gitignore' && item.isFile()) ? readRules(directory, relative) : [];
    const rules = [...inherited, ...own];
    for (const entry of entries.filter(item => item.name !== '.git')) {
        visitEntry(path.join(directory, entry.name), childPath(relative, entry.name), entry.isDirectory(), rules, found);
    }
}

const childPath = (relative, name) => (relative ? `${relative}/${name}` : name);

function visitEntry(full, file, isDirectory, rules, found) {
    if (isIgnoredBy(rules, file, isDirectory)) {
        found.push(isDirectory ? `${file}/` : file);
        return;
    }
    if (isDirectory) walkIgnored(full, file, rules, found);
}
