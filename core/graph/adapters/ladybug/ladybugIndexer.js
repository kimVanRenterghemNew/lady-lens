import crypto from 'crypto';
import { parse } from 'acorn';
import { normalizeNodeId } from '../../model/index.js';
import { analyzeSource, fileKindOf, configFilesNamed, analyzeSourceForLanguage } from '../../sync/index.js';

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

export const MAX_AST_SOURCE = 512 * 1024;

function codeEntityMetadata(source, facts) {
    const meta = {
        lines: source.split(/\r?\n/).length,
        exports: facts.exports,
        symbols: facts.symbols,
        symbolRanges: facts.symbolRanges,
        keywords: facts.keywords,
        imports: facts.imports,
        calls: facts.calls,
        functions: facts.functions,
        fileSmells: facts.fileSmells || [],
        reads: configFilesNamed(source)
    };
    if (facts.callbacks) meta.callbacks = facts.callbacks;
    if (facts.parseError) meta.parseError = facts.parseError;
    return meta;
}

/**
 * Pure: the project entity for one JavaScript source. Facts (exports, symbols,
 * slash commands, imports, purpose) go into metadata so `graph_query` can rank on them; the
 * full-file AST is opt-in because Fase 19 replaces it with chunk extraction.
 */
export function buildCodeEntity(relativePath, source, { now = new Date().toISOString(), includeAst = false, scriptPaths } = {}) {
    const isJs = /\.[cm]?js$/i.test(relativePath);
    const facts = isJs ? analyzeSource(source, relativePath) : analyzeSourceForLanguage(source, relativePath);
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
        metadata: codeEntityMetadata(source, facts),
        // a tree is ~9x its source: none for a bundle over MAX_AST_SOURCE, so one vendored file cannot fill memory or the buffer
        ...(includeAst && isJs && source.length <= MAX_AST_SOURCE ? { ast: parseJavaScriptAst(source) } : {}),
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}
