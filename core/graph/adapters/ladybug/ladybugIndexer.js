import crypto from 'crypto';
import { parse } from 'acorn';
import { normalizeNodeId } from '../../index.js';
import { analyzeSource, fileKindOf, configFilesNamed, isLanguageSupported, analyzeSourceForLanguage } from '../../index.js';

function normalizeAstValue(value) {
    if (Array.isArray(value)) return value.map(normalizeAstValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== 'loc' && key !== 'raw')
            .map(([key, nested]) => [key, normalizeAstValue(nested)])
    );
}

export function extractModuleDocumentation(source) {
    const match = String(source).match(/\/\*\*([\s\S]*?)\*\//);
    if (!match) return '';
    return match[1]
        .split('\n')
        .map(line => line.replace(/^\s*\* ?/, '').trim())
        .join('\n')
        .trim();
}

export function parseJavaScriptAst(source) {
    try {
        return normalizeAstValue(parse(String(source), {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowHashBang: true
        }));
    } catch {
        return null;
    }
}

/** `file:<repo-relative path>` through the shared normalizer; matches docs/GRAPH_SCHEMA.md. */
export function fileNodeId(relativePath) {
    return normalizeNodeId(`file:${String(relativePath).replace(/\\/g, '/')}`);
}

/**
 * Pure: the project entity for one JavaScript source. Facts (exports, symbols,
 * slash commands, imports, purpose) go into metadata so `graph_query` can rank on them; the
 * full-file AST is opt-in because Fase 19 replaces it with chunk extraction.
 */
export function buildCodeEntity(relativePath, source, { now = new Date().toISOString(), includeAst = false, scriptPaths } = {}) {
    const isJs = /\.[cm]?js$/i.test(relativePath);
    const facts = isJs
        ? analyzeSource(source)
        : isLanguageSupported(relativePath)
            ? analyzeSourceForLanguage(source, relativePath)
            : analyzeSourceForLanguage(source, relativePath);
    const kind = facts.isTest ? 'test' : fileKindOf(relativePath, scriptPaths ? { scriptPaths } : {});
    return {
        id: fileNodeId(relativePath),
        type: 'CodeFile',
        kind,
        scope: 'project',
        path: relativePath,
        name: relativePath.split('/').pop(),
        contentHash: crypto.createHash('sha256').update(source).digest('hex'),
        documentation: facts.purpose,
        metadata: { lines: source.split(/\r?\n/).length, exports: facts.exports, symbols: facts.symbols, symbolRanges: facts.symbolRanges, keywords: facts.keywords || [], imports: facts.imports, calls: facts.calls, functions: facts.functions || [], reads: configFilesNamed(source), ...(facts.parseError ? { parseError: facts.parseError } : {}) },
        ...(includeAst && isJs ? { ast: parseJavaScriptAst(source) } : {}),
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}
