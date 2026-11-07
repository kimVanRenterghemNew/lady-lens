import { DISCUSSION_TOOL_SCHEMAS } from '../discussions/index.js';

export const RESEARCH_TOOL_SCHEMAS = [
    ...DISCUSSION_TOOL_SCHEMAS,
    {
        name: 'read_chunk',
        description: 'Read a file or exact AST chunk from the repository. Pass chunkId (e.g. "chunk:core/auth.js#authenticate") for exact function/class body; or path with optional startLine/endLine. Small files come back whole; big files return an outline.',
        parameters: {
            type: 'object',
            properties: {
                chunkId: { type: 'string', description: 'AST chunk ID (e.g. "chunk:core/auth.js#authenticate" or "core/auth.js#authenticate")' },
                path: { type: 'string', description: 'Repo-relative file path, e.g. "core/ollama.js"' },
                startLine: { type: 'integer', description: 'Optional 1-based start line' },
                endLine: { type: 'integer', description: 'Optional 1-based end line' }
            }
        }
    },
    {
        name: 'grep',
        description: 'Search the repository for a regular expression, optionally scoped to a path.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Regular expression to search for' },
                path: { type: 'string', description: 'Optional repo-relative file, directory or glob to scope the search to.' },
                offset: { type: 'number', description: 'Skip this many matches (the next page of a cut answer)' },
                ignoreCase: { type: 'boolean', description: 'true = match any upper/lower case' }
            },
            required: ['pattern']
        }
    },
    {
        name: 'glob',
        description: 'List repository paths matching a glob pattern (supports * and **).',
        parameters: {
            type: 'object',
            properties: { pattern: { type: 'string', description: 'Glob pattern, e.g. "core/**/*.js"' } },
            required: ['pattern']
        }
    },
    {
        name: 'exports',
        description: 'Which names does this file export? Complete list from the project graph.',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'Repo-relative file path' } }, required: ['file'] }
    },
    {
        name: 'exists',
        description: 'Does this file exist in the project? If not, says where a file with the same name does exist.',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'Repo-relative file path' } }, required: ['file'] }
    },
    {
        name: 'definedIn',
        description: 'In which file(s) is this function/name defined or exported? Complete answer from the project graph.',
        parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'The exact identifier' } }, required: ['symbol'] }
    },
    {
        name: 'health',
        description: 'Code health: which files no test reaches (also through index.js), exports no test names, import cycles, imports past a module index.js, large files, fan-in/out, hotspots (churn x size); on request hubs and bridges. Worst first; per file, per module or the whole repo.',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'Repo-relative file path' }, module: { type: 'string', description: 'Folder, e.g. core/graph' }, limit: { type: 'integer', description: 'Maximum number of files (default 20)' }, hubs: { type: 'boolean', description: 'true = also the files with the most neighbours (imports and calls)' }, bridges: { type: 'boolean', description: 'true = also the files on the most shortest paths between others (betweenness); slower on big repos' } } }
    },
    {
        name: 'functionView',
        description: 'What does this function do, who calls it, which tests use it, which stories name it? Definition with lines and purpose, callers, tests (with test names), stories, bound (`resolved`) and unbound (`unresolved`) call counts; for a class also its methods (`children`) and subclasses (`inheritors`); only this function, not the whole file.',
        parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'The exact identifier' }, maxSites: { type: 'integer', description: 'Lines per caller, test and story (default 5, at most 200)' } }, required: ['symbol'] }
    },
    {
        name: 'diff_impact',
        description: 'What does my change touch? The functions a diff changes (default: the work not committed yet; or `from`..`to`, a branch from its merge-base) with per function its callers (file, lines), tests, bound and unbound call counts, complexity, and test gaps (changed functions no test names). Riskiest first.',
        parameters: { type: 'object', properties: { from: { type: 'string', description: 'Start of a commit range or the base branch; leave out for the work not committed yet' }, to: { type: 'string', description: 'End of the range (default HEAD)' }, limit: { type: 'integer', description: 'Maximum number of functions (default 50)' } } }
    },
    {
        name: 'folderView',
        description: 'How does this folder work? Its parts (sub-folders and files) with their role and key exports, which part imports or calls which, who uses the folder from outside, what is not clean; a folder that only passes on a package also shows that package. `text` is the answer as a block.',
        parameters: { type: 'object', properties: { folder: { type: 'string', description: 'Repo-relative folder, e.g. core/graph' } }, required: ['folder'] }
    },
    {
        name: 'importedBy',
        description: 'Which files import this file? Complete list from the import graph.',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'Repo-relative file path' } }, required: ['file'] }
    },
    {
        name: 'imports',
        description: 'Which files does this file import? Complete list from the import graph.',
        parameters: { type: 'object', properties: { file: { type: 'string', description: 'Repo-relative file path' } }, required: ['file'] }
    },
    {
        name: 'searchView',
        description: 'Interactive code search: search text or symbol with case sensitivity, whole word, regex, file kind filter, and file include glob. Returns grouped matches with classification (definition, call, test, doc, reference).',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term or regex pattern' },
                caseSensitive: { type: 'boolean', description: 'true = case-sensitive match (default false)' },
                wholeWord: { type: 'boolean', description: 'true = match whole words only (default false)' },
                isRegex: { type: 'boolean', description: 'true = treat query as regular expression (default false)' },
                kind: { type: 'string', enum: ['all', 'code', 'doc', 'test'], description: 'Filter by file kind (default "all")' },
                include: { type: 'string', description: 'Optional file/directory glob pattern to include, e.g. "src/**", "*.cs"' },
                limit: { type: 'integer', description: 'Maximum total matches (default 100)' }
            },
            required: ['query']
        }
    },
    {
        name: 'graph_query',
        description: 'Query the current session code and decision graph by node or text context. A code file node gets its consequences (importedBy, calledBy, tests) and risks in both modes; a one-hop answer lists imports before calls and says `total` and `truncated`. With kind "doc" and a file path, the documents that name the path come first (`mentions: "path"`, then "name"), each with the `lines` that name it.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session folder under .memory' },
                node: { type: 'string', description: 'Starting node ID for neighbor or traversal queries' },
                kind: { type: 'string', enum: ['doc'], description: 'doc = search only the documentation (backlog, docs, README)' },
                history: { type: 'boolean', description: 'true = also superseded decisions (for regressions); default only current ones' },
                query: { type: 'string', description: 'Text to match against graph context' },
                outgoing: { type: ['boolean', 'object'], description: 'Follow outgoing edges' },
                incoming: { type: ['boolean', 'object'], description: 'Follow incoming edges' },
                path: { type: 'string', description: 'Arrow-separated edge types for multi-hop traversal' },
                maxDepth: { type: 'integer', description: 'Follow any outgoing edge type up to N hops' },
                limit: { type: 'integer', description: 'Maximum number of returned nodes' }
            }
        }
    }
].map(schema => ({ readOnly: true, ...schema })); // research tools only read; a schema that writes says so itself
