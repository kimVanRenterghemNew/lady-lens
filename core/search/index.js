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
import { fitToBudget, withBudget } from './budget.js';
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
    discussion_query: withBudget(args => handleDiscussionQuery(args), { lists: ['discussions'], narrow: 'query with a specific topic or node' }),
    read_chunk: withBudget(read_chunk, { lists: ['outline'], narrow: 'read a smaller line range' }),
    grep: withBudget(grep, { lists: ['matches'], narrow: 'use a more specific pattern or a path, or ask the next page with offset' }),
    glob: withBudget(glob, { lists: ['paths'], narrow: 'use a more specific pattern' }),
    importedBy: withBudget(args => importedBy(args), { lists: ['files'], narrow: 'ask about one file' }),
    imports: withBudget(args => imports(args), { lists: ['files'], narrow: 'ask about one file' }),
    exports: withBudget(args => exportsTool(args), { lists: ['names'], narrow: 'ask about one file' }),
    exists: withBudget(args => fileExists(args), { lists: ['similar'], narrow: 'ask about one file' }),
    definedIn: withBudget(args => definedInTool(args), { lists: ['locations'], narrow: 'ask about one symbol' }),
    functionView: withBudget(args => functionViewTool(args), { lists: ['tests', 'callers', 'stories'], narrow: 'ask about one symbol' }),
    diff_impact: withBudget(args => diffImpact(args), { lists: ['testGaps', 'functions'], narrow: 'lower limit, or diff a smaller range' }),
    folderView: withBudget(args => folderViewTool(args), { lists: ['parts', 'flow'], texts: ['text'], narrow: 'ask about a smaller folder' }),
    health: withBudget(args => healthTool(args), { lists: ['hotspots', 'cycles', 'modules', 'files'], narrow: 'ask about one module or file, or lower limit' }),
    searchView: withBudget(args => searchView(args), { lists: ['files'], narrow: 'use a more specific query or include filter' }),
    graph_query: withBudget(graph_query, { lists: ['nodes', 'symbols', 'edges'], texts: ['context'], narrow: 'query one node, or lower limit' })
};
