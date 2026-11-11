/**
 * lady-lens: The code graph and research engine for any code repository.
 * Complete public API exporting all graph, search, repository, MCP, observability,
 * and configuration ports.
 */

// Graph & Engine ports
export * from './core/graph/index.js';

// Mendix models read from git: mendixDiff({ from, to, root }) gives a branch's model changes as data
export { mendixDiff, readMendixModel, elementChanges, flowGraph } from './core/mendix/index.js';

// Search, Research & Query ports
export {
    RESEARCH_TOOLS,
    RESEARCH_TOOL_SCHEMAS,
    read_chunk,
    outlineOf,
    resolveInRepo,
    grep,
    glob,
    toRepoRelative,
    walkFiles,
    loadGraphModel,
    freshnessFor,
    refreshProjectGraph,
    invalidateGraphCache,
    readRepoFile,
    loadCoverage,
    graph_query,
    definedInTool,
    importLookupTool,
    interfacesForScope,
    importedBy,
    imports,
    graphFactTool,
    exportsTool,
    fileExists,
    folderViewTool,
    functionViewTool,
    healthTool,
    getRepoChurn,
    invalidateChurnCache,
    packageFolderView,
    searchView,
    fitToBudget,
    withBudget,
    resolveCodebaseQuery
} from './core/search/index.js';

// Repository management & Settings ports
export {
    loadProjectSettings,
    loadProjectSettingsSync,
    shouldExcludePath,
    isGraphExtension,
    createSearchExcluder,
    listRegisteredRepos,
    registerRepo,
    unregisterRepo,
    resolveRepoTarget,
    idOfRepo,
    databasePathOfRepo
} from './core/repository/index.js';

// MCP & Server ports
export {
    createLadyLensMcpServer,
    runMcpServer,
    createMcpHttpServer,
    writeDaemonInfo,
    readDaemonInfo,
    clearDaemonInfo,
    stopDaemon
} from './core/mcp/index.js';

// Observability ports
export {
    globalProfiler,
    createProfiler,
    debug,
    configureLensLog
} from './core/observability/index.js';

// Configuration ports
export {
    configureLensEnv,
    configureLensRoot,
    lensEnv,
    REPO_ROOT,
    MEMORY_DIR,
    isSafePath
} from './core/configuration/index.js';
