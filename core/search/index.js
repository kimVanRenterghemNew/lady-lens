import { read_chunk, outlineOf, resolveInRepo } from './chunkReader.js';
import { grep, glob, toRepoRelative, walkFiles, globToRegExp, MAX_GREP_RESULTS, MAX_GLOB_RESULTS } from './grepSearch.js';
import {
    loadGraphModel,
    freshnessFor,
    refreshProjectGraph,
    invalidateGraphCache,
    readRepoFile,
    loadCoverage
} from './graphModelLoader.js';
import { graph_query } from './graphQuery.js';
import { shortNode } from '../graph/index.js';
import { definedInTool } from './definedIn.js';
import { importLookupTool, interfacesForScope, importedBy, imports } from './imports.js';
import { graphFactTool, exportsTool, fileExists } from './exports.js';
import { folderViewTool } from './folderView.js';
import { functionViewTool, viewOf } from './functionView.js';
import { rankDocuments } from './docMentions.js';
import { diffImpact } from './diffImpact.js';
import { healthTool, getRepoChurn, invalidateChurnCache } from './codeHealth.js';
import { packageFolderView, readPackageFile } from './packageFolderView.js';
import { searchView } from './searchView.js';
export { placesFor, NOT_FOUND } from './queryPlaces.js';
import { parseStackTrace, locateFrames, traceView } from './stackTrace.js';
import { callFlow, toMermaid } from './callFlow.js';
import { codeHistory } from './codeHistory.js';
import { fitToBudget, withBudget } from './budget.js';
import { listTool } from './toolLimit.js';
import { resolveCodebaseQuery } from './queryFlow.js';
import { RESEARCH_TOOL_SCHEMAS } from './schemas.js';
import {
    handleDiscussionSave,
    handleDiscussionEdit,
    handleDiscussionQuery,
    handleDiscussionBuild,
    handleDiscussionLoad,
    saveDiscussion,
    loadDiscussions,
    editDiscussion,
    buildDiscussion,
    queryDiscussions,
    findDiscussionsForNode,
    configureDiscussionSaveHook
} from '../discussions/index.js';

configureDiscussionSaveHook(() => invalidateGraphCache());

export {
    read_chunk,
    outlineOf,
    resolveInRepo,
    grep,
    glob,
    toRepoRelative,
    walkFiles,
    globToRegExp,
    MAX_GREP_RESULTS,
    MAX_GLOB_RESULTS,
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
    viewOf,
    rankDocuments,
    diffImpact,
    healthTool,
    getRepoChurn,
    invalidateChurnCache,
    packageFolderView,
    readPackageFile,
    searchView,
    parseStackTrace,
    locateFrames,
    traceView,
    callFlow,
    toMermaid,
    codeHistory,
    fitToBudget,
    withBudget,
    resolveCodebaseQuery,
    RESEARCH_TOOL_SCHEMAS,
    handleDiscussionSave,
    handleDiscussionEdit,
    handleDiscussionQuery,
    handleDiscussionBuild,
    handleDiscussionLoad,
    saveDiscussion,
    loadDiscussions,
    editDiscussion,
    buildDiscussion,
    queryDiscussions,
    findDiscussionsForNode
};

export const RESEARCH_TOOLS = {
    discussion_build: withBudget(args => handleDiscussionBuild(args), { texts: ['markdown'], narrow: 'build with fewer responses' }),
    discussion_save: withBudget(args => handleDiscussionSave(args), { lists: ['edges'], narrow: 'save with fewer sources' }),
    discussion_edit: withBudget(args => handleDiscussionEdit(args), { lists: ['edges'], narrow: 'edit with fewer sources' }),
    discussion_load: withBudget(args => handleDiscussionLoad(args), { lists: ['nodes', 'edges'], narrow: 'load a single discussion by id' }),
    discussion_query: listTool('discussion_query', args => handleDiscussionQuery(args), { lists: ['discussions'], narrow: 'query with a specific topic or node' }),
    read_chunk: withBudget(read_chunk, { lists: ['outline'], narrow: 'read a smaller line range' }),
    grep: listTool('grep', grep, { lists: ['matches'], totals: { matches: 'totalCount' }, paged: 'matches', narrow: 'use a more specific pattern or a path, or ask the next page with offset' }),
    glob: listTool('glob', glob, { lists: ['paths'], narrow: 'use a more specific pattern' }),
    importedBy: listTool('importedBy', args => importedBy(args), { lists: ['files'], narrow: 'ask about one file' }),
    imports: listTool('imports', args => imports(args), { lists: ['files'], narrow: 'ask about one file' }),
    exports: listTool('exports', args => exportsTool(args), { lists: ['names'], narrow: 'ask about one file' }),
    exists: withBudget(args => fileExists(args), { lists: ['similar'], narrow: 'ask about one file' }),
    definedIn: listTool('definedIn', args => definedInTool(args), { lists: ['locations'], narrow: 'ask about one symbol' }),
    // callers first: they are what functionView is asked for, and the budget cuts the first list last
    functionView: listTool('functionView', args => functionViewTool(args), { lists: ['callers', 'tests', 'stories'], narrow: 'lower maxSites (lines per caller, test and story), or grep the name for every use' }),
    diff_impact: listTool('diff_impact', args => diffImpact(args), { lists: ['functions', 'testGaps', 'files'], narrow: 'lower limit, or diff a smaller range' }),
    folderView: listTool('folderView', args => folderViewTool(args), { lists: ['parts', 'flow'], texts: ['text'], narrow: 'ask about a smaller folder' }),
    health: listTool('health', args => healthTool(args), { lists: ['cycles', 'hotspots', 'modules', 'zoneOfPain', 'complexFunctions', 'designSmells', 'files'], narrow: 'ask about one module or file, or lower limit' }),
    searchView: listTool('searchView', args => searchView(args), { lists: ['files'], nested: { files: 'matches' }, narrow: 'use a more specific query or include filter' }),
    // a caller (or its model) picks from the candidates: every node stays, the later ones as path and purpose only
    graph_query: listTool('graph_query', graph_query, { lists: ['nodes', 'symbols', 'edges'], texts: ['context'], mainLists: ['nodes'], drop: ['edges', 'context', 'provenance'], compact: { nodes: { keep: 1, to: shortNode } }, narrow: 'query one node, or lower limit' })
};

// The dashboard shows the whole health report: the context budget is for an assistant, not for a page.
export const DASHBOARD_TOOLS = { ...RESEARCH_TOOLS, health: args => healthTool(args) };
