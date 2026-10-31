// GraphStore Port: the storage adapter behind the graph repository. The repository is the port the rest of
// the app uses (scopes, validation, DTOs); this is what a host injects into it. Every adapter keeps entities
// in the stored row shape of core/graph/model/graphRows.js. Enforced by test/ports/graphStore.contract.test.js.
// Replaces the thin per-node GraphStorePort of Story 15.1, which no runtime code used (it held the database open and had no
// content hash, the two things the repository needs).

/** Methods every graph storage adapter implements (the repository calls exactly these). */
export const GRAPH_STORE_METHODS = Object.freeze([
    'applyProjectChanges',
    'databasePath',
    'deleteScopes',
    'directDefinedIn',
    'directExists',
    'directExports',
    'directFunctionViewGraph',
    'directImportedBy',
    'directImports',
    'exists',
    'loadGraph',
    'loadNodes',
    'projectFiles',
    'relate',
    'replaceScope',
    'stats',
    'upsertNodes'
]);
