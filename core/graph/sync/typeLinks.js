/**
 * Which file a type name points to (C#: a language that imports namespaces, not files). One declaring file: that file.
 * Several: the same namespace means one partial type (every file); else the one whose namespace the referring file
 * sees (its usings, its own namespace and the ones above it); else no link (no guess).
 * @module core/graph/sync/typeLinks
 */

/** `A.B.C` -> ['A', 'A.B', 'A.B.C'] */
const withParents = (namespace) => (namespace ? namespace.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.')) : []);

/**
 * @param {{metadata?: {imports?: string[], namespace?: string}}} info the referring file
 * @returns {Set<string>} the namespaces it sees
 */
export function visibleNamespaces(info) {
    const meta = info.metadata ?? {};
    return new Set([...(meta.imports ?? []), ...withParents(meta.namespace)]);
}

function partialType(files, namespaceOf) {
    const spaces = new Set(files.map(namespaceOf));
    return spaces.size === 1 && !spaces.has(undefined);
}

/**
 * @param {string[]} declarers the files that declare a type of this name (other than the referring file)
 * @param {Set<string>} visible from visibleNamespaces
 * @param {(file: string) => string|undefined} namespaceOf a file's namespace
 * @returns {string[]} the files the reference links to (none when it stays ambiguous)
 */
export function typeTargets(declarers, visible, namespaceOf) {
    if (declarers.length <= 1 || partialType(declarers, namespaceOf)) return declarers;
    const inScope = declarers.filter(file => visible.has(namespaceOf(file)));
    return inScope.length === 1 || partialType(inScope, namespaceOf) ? inScope : [];
}
