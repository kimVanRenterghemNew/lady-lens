/**
 * The type names a file uses, for a language that imports namespaces instead of files (C#). Sync links each to the
 * file that declares that type (projectRelations.js).
 * @module core/graph/sync/languages/typeRefs
 */

const MAX_TYPE_REFS = 500;

/**
 * @param {string} source the file's text
 * @param {{typeRefPattern: RegExp, namespacePattern?: RegExp}} config the language's patterns
 * @param {string[]} types the types the file declares itself (they are not references)
 * @param {(index: number) => boolean} isComment whether a match at this index sits in a comment
 * @returns {{types: string[], typeRefs: string[], namespace?: string}} its own types, the other type names it uses
 *   (at most MAX_TYPE_REFS) and its namespace
 */
export function typeRefsOf(source, config, types, isComment) {
    const own = new Set(types);
    const refs = new Set();
    for (const match of source.matchAll(config.typeRefPattern)) {
        if (!own.has(match[0]) && !isComment(match.index)) refs.add(match[0]);
    }
    return { types: [...own], typeRefs: [...refs].slice(0, MAX_TYPE_REFS), ...namespaceOf(source, config.namespacePattern) };
}

function namespaceOf(source, pattern) {
    const namespace = pattern ? source.match(pattern)?.[1] : undefined;
    return namespace ? { namespace } : {};
}
