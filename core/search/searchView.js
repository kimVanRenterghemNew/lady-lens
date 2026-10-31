/**
 * Code Search View (Story 23.12).
 * Interactive search with options (case sensitive, whole word, regex, kind, path glob)
 * and rich per-match classification (definition, call, test, doc, reference).
 *
 * @module core/search/searchView
 */
import fs from 'fs';
import { REPO_ROOT, relativeToRepo } from '../configuration/index.js';
import { isCodeFile, isDocFile, isConfigFile } from '../graph/sync/index.js';
import { walkFiles, globToRegExp } from './grepSearch.js';

const isTestPath = (p) => /(?:^|[\\/])(?:tests?|__tests?__)[\\/]|[.](?:test|spec|Tests?)[.][a-z0-9]+$/i.test(p);
const fileKindOf = (rel) => isTestPath(rel) ? 'test' : isDocFile(rel) ? 'doc' : isConfigFile(rel) ? 'config' : isCodeFile(rel) ? 'source' : 'other';

function buildMatcher(query, { caseSensitive, wholeWord, isRegex }) {
    let pat = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) pat = `(?<=^|[^\\w$])${pat}(?=[^\\w$]|$)`;
    return new RegExp(pat, caseSensitive ? 'g' : 'gi');
}

function classifyLine(line, query, fileKind) {
    if (fileKind === 'doc') return 'doc';
    if (fileKind === 'test') return 'test';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const defPattern = new RegExp(`(?:class|interface|struct|record|enum|function|fn|def)\\s+${escaped}\\b|(?:public|private|protected|internal|static|async|void)\\s+[^;={}]*\\b${escaped}\\s*\\(`, 'i');
    if (defPattern.test(line)) return 'definition';
    const callPattern = new RegExp(`\\b${escaped}\\s*\\(`, 'i');
    if (callPattern.test(line)) return 'call';
    return 'reference';
}

export function searchView(args = {}, { root = REPO_ROOT } = {}) {
    const { query, caseSensitive = false, wholeWord = false, isRegex = false, kind = 'all', include = '', limit = 100 } = args;
    if (typeof query !== 'string' || !query.trim()) return { error: 'query is required' };

    let regex;
    try {
        regex = buildMatcher(query.trim(), { caseSensitive, wholeWord, isRegex });
    } catch (err) {
        return { error: `invalid pattern: ${err.message}` };
    }

    const includeRegex = include && include.trim() ? globToRegExp(include.trim().replace(/\\/g, '/').replace(/^\.\//, '')) : null;
    const fileMatches = [];
    let totalCount = 0;

    walkFiles(root, (absPath) => {
        if (totalCount >= limit) return;
        const rel = relativeToRepo(absPath, root).replace(/\\/g, '/');
        if (includeRegex && !includeRegex.test(rel)) return;

        const fKind = fileKindOf(rel);
        if (kind === 'code' && fKind !== 'source') return;
        if (kind === 'doc' && fKind !== 'doc') return;
        if (kind === 'test' && fKind !== 'test') return;

        let content;
        try { content = fs.readFileSync(absPath, 'utf8'); } catch { return; }
        const lines = content.split('\n');
        const matches = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            regex.lastIndex = 0;
            if (regex.test(line)) {
                totalCount++;
                const matchKind = classifyLine(line, query.trim(), fKind);
                matches.push({
                    line: i + 1,
                    text: line.trim(),
                    kind: matchKind,
                    ...(matchKind === 'definition' ? { symbol: query.trim() } : {})
                });
                if (totalCount >= limit) break;
            }
        }

        if (matches.length > 0) {
            fileMatches.push({
                file: rel,
                kind: fKind,
                matches
            });
        }
    }, root);

    return {
        query: query.trim(),
        totalMatches: totalCount,
        filesCount: fileMatches.length,
        files: fileMatches,
        truncated: totalCount >= limit
    };
}
