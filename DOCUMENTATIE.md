# lady-lens documentation

Full guide to architecture, API ports, MCP integration, npm package use and configuration through `config.json`. (The file name stays `DOCUMENTATIE.md` so existing links keep working.)

---

## 0. Installation and setup

Requires Node.js 18 or newer; the Mendix MDL export needs 22.13 or newer (see Step 6 below: another Node for lens). Do these steps once, in order.

**Step 1: install**

```bash
npm install -g lady-lens          # from npmjs.org
lens v                            # prints the version: `lens` is now on your PATH
```

From source instead (development, or a version that is not published yet): `npm install` and `npm run pack` in this folder build `dist\lady-lens-<version>.tgz`; install it with `npm install -g .\dist\lady-lens-<version>.tgz` (later: `lens update .\dist\lady-lens-<version>.tgz`). With `npm link`, `lens` runs straight from this folder.

**Step 2: register a project and index it**

```bash
lens add C:\git\my-project        # registers the project and runs the first sync
lens list                         # check that it is listed
lens sync                         # later: incremental sync (--full = everything)
```

**Step 3: connect your AI assistant (stdio, no daemon needed)**

```bash
lens install                      # every agent found; or one: lens install vscode
lens install --skill              # also the Lady-lens workflow skill
lens install --mendix             # the Mendix skill; or for some agents: lens install skill-mendix vscode claude-code
lens install --dry-run            # shows what would change, writes nothing
```

`lens install` adds a stdio entry to each agent's MCP configuration (VS Code: `%APPDATA%\Code\User\mcp.json`), keeps the other servers and saves the old file as `<file>.lady-lens.bak`. Restart the agent afterwards (VS Code: *MCP: List Servers* or reload the window).

**Step 4 (alternative): one background daemon for all projects**

```bash
lens mcp -d                       # MCP on http://127.0.0.1:4318/mcp, UI on http://127.0.0.1:4317
lens status                       # is it running?
lens ps                           # tracked PIDs per folder
lens stop                         # stop it
```

Example for VS Code (`mcp.json`):

```json
{ "servers": { "lady-lens": { "type": "http", "url": "http://127.0.0.1:4318/mcp?repo=C:/git/my-project" } } }
```

See [section 5](#5-using-it-as-an-mcp-server) for several projects per daemon and other agents.

**Step 5: update**

```bash
lens update                       # the newest version from npm
lens update 1.2.8                 # a given version
lens update C:\path\lady-lens-1.2.8.tgz   # a package file: a machine without npm access, or a build from source
```

In order, `lens update`:

1. stops every lens process: the daemon and the stdio servers your agents started. On Windows a running lens keeps the graph database module (`lbugjs.node`) open, and npm cannot replace it (`EBUSY`);
2. runs `npm install -g` with the package. When that still fails (an agent started lens again), it stops lens once more and retries once;
3. lets the new lens refresh what you installed (`lens install --refresh`): the MCP entry in every agent where lady-lens is registered (a `--repo` is kept), the installed `SKILL.md` files (main and Mendix skill), and `~/.lady-lens/lens-instructions.md` with the instruction files that point to it. Your own `CLAUDE.md`, `AGENTS.md` or `copilot-instructions.md` only holds a link line and does not change. Nothing you did not install is added;
4. starts the daemon again if it ran.

Reconnect the MCP server in your agents afterwards (Claude Code: `/mcp`; VS Code: restart the server), so they start the new version.

**Step 6: another Node for lens**

The Mendix MDL export reads mxcli's catalog with `node:sqlite`, which needs Node 22.13 or newer. When your projects need an older Node on PATH (nvm), let only lens run on a newer one; PATH and nvm stay as they are:

```bash
lens node "C:\Program Files\nodejs\node.exe"   # lens, its daemon and the agent registrations now run on that Node
lens node                                      # which Node lens runs on
lens node --clear                              # back to the Node on PATH
```

The choice is kept in `~/.lady-lens/lens.json`. It holds at once, in every terminal and for agents started from the desktop; `setx LENS_NODE ...` only reaches terminals started later (in cmder not even those), so use `lens node`. `LENS_NODE` still overrides the file. `lens node` stops lens, re-registers the agents with the new Node and starts the daemon again if it ran. The package stays where npm installed it: Ladybug's native module works on every Node version. `lens sync --debug` writes the Node it ran on in the second line of its log.

---

## 1. Architecture overview and philosophy

`lady-lens` is a fast, local code graph and semantic analysis engine built on [LadybugDB](https://www.npmjs.com/package/@ladybugdb/core). It indexes source code, documentation, decisions and dependencies into a directed graph. AI coding agents and developers can ask for exact facts about the codebase (definitions, import chains, callers, test reach, code health and architecture metrics) without spending expensive LLM tokens on context.

The code base follows a strict **hexagonal architecture (ports and adapters)**:
- **Core domain / model**: graphs, nodes (files, functions, documents, decisions) and edges (`IMPORTS`, `CALLS`, `TESTS`, `READS`, `CO_CHANGES`).
- **Storage port (`GraphStorePort`)**: interchangeable storage adapters (in memory for fast tests, LadybugDB for persistent indexing).
- **Sync and extraction port**: incremental parsing and AST extraction for JavaScript/TypeScript, C# and other registered languages; Mendix `.mpr` models are handled through `mxcli` as an external graph contributor.
- **Git port (`core/git`)**: the only place that starts git; see [Branches and commits](#branches-and-commits).
- **Query and view ports**: `functionView`, `folderView`, `codeHealth`, `rankGraphNodes`, `impact`.
- **Primary adapters**: reachable through the **npm package**, the **MCP server (Model Context Protocol)** and the **CLI (`lens`)**.

---

## 2. API ports: access through MCP and the npm package

Every feature of `lady-lens` is a **first-class API port**, available programmatically through the npm package (`lady-lens`) and interactively through the Model Context Protocol (MCP).

The library sync API is `createGraphSync().sync({ mode: 'incremental' })`; use `mode: 'full'` for a complete re-index.

### Overview of all ports

| Port / domain | MCP tool | npm export (`lady-lens`) | Description |
| :--- | :--- | :--- | :--- |
| **Function analysis** | `functionView` | `functionView(graph, symbol, { readFile, maxSites })` / `functionViewTool(args)` | Definition, line numbers, docstring/purpose, all calling files (`callers`), linked tests and referenced backlog stories of a function; `resolved` and `unresolved` call counts (a `note` "niet bewezen leeg" when none is bound but the name appears); for a class `children` (methods) and `inheritors` (subclasses). |
| **Folder and module analysis** | `folderView` | `folderView(graph, folder)` / `folderViewTool(args)` | Structure of a folder: parts, internal data flow, who calls the folder from outside and possible deviations (cycles, untested files). |
| **Code health and metrics** | `health` | `codeHealth(graph, opts)` / `healthTool(args)` | NDepend-style statistics: test reach (including index.js barrels), cyclic dependencies, boundary violations, hotspots (churn x lines), coupling (Ca, Ce, instability), zone of pain, and AST design smells with actionable pattern advice (`dispatch-chain`, `fallback-heavy`, `deep-nesting`, `loop-branching`, `long-condition`, `flag-parameter`, `repeated-literal`, `global-mutable-state`, `direct-io`, `god-module`). A measured line coverage (`coverage-summary.json`, written by `vitest --coverage` with the `json-summary` reporter) beats the import guess: a file covered through another one is tested, and its exports are not guessed by name. Barrels (`index.js`) are never flagged for untested exports, fan-in/out, zone of pain or god-module; tool config files (`*.config.*`) are scripts. On request `hubs` (most neighbours) and `bridges` (betweenness), each with `total` and `truncated` (`hubsAndBridges(graph, opts)`). |
| **Symbol location** | `definedIn` | `definedIn(graph, symbol)` / `definedInTool(args)` | Where an identifier is defined or exported: file path and exact start/end lines. |
| **Imports** | `imports` | `importsOf(graph, file)` / `imports(args)` | Which files and modules a given file imports directly. |
| **Dependents** | `importedBy` | `importersOf(graph, file)` / `importedBy(args)` | Which files import the given file (fan-in analysis). |
| **Exports** | `exports` | `exportsOf(graph, file)` / `exportsTool(args)` | Complete sorted list of exported functions, variables and types of a file. |
| **File check** | `exists` | `fileLookup(graph, file)` / `fileExists(args)` | Checks whether a file is in the project graph; suggests matches for typos or moved folders. |
| **Graph search** | `graph_query` | `graph_query(args)` / `rankGraphNodes(graph, query)` | Semantic and keyword search through the graph by relevance score, IDF weighting and relations. |
| **Interactive search** | `searchView` | `searchView(args)` | Advanced search with regex, case sensitivity, file type filter (code, doc, test) and path globs. |
| **Text and regex** | `grep` | `grep(args)` | Fast regex search through code, honouring `.gitignore` and project exclusions. |
| **Config search** | `config_grep` | `grep(args)` + config filter | Searches only project and configuration files, such as `.csproj` and reference-manager XML. |
| **Config references** | `config_references` | `grep(args)` + config filter | Finds which config files mention a package, project or Siemens functional block. |
| **Config update** | `config_update` | `fs` + `createGraphSync().touch()` | Replaces one config file, optionally checks a SHA-256 and refreshes the graph facts. |
| **Path matching** | `glob` | `glob(args)` | Finds repository paths by glob pattern (e.g. `core/**/*.js`). |
| **AST chunk reader** | `read_chunk` | `read_chunk(args)` | Reads one AST chunk (class/function) or a range of lines. Large files return a compact summary. |
| **Decisions and discussions** | `discussion_save`, `discussion_query`, etc. | `saveDiscussion`, `loadDiscussions`, `queryDiscussions` | Manages architecture decisions and discussions, with frontmatter links to code nodes. |
| **Multi-repo management** | `repo_list`, `repo_add`, `repo_remove` | `registerRepo`, `unregisterRepo`, `listRegisteredRepos` | Manages several projects in the central Ladybug database registry. |
| **Graph sync** | `repo_sync` | `createGraphSync(options).sync()` | Scans the project incrementally (by size and mtime) or fully (`mode: 'full'`). Records the branch and commit and reports `commitsSince`. With `branch: '<name>'` another branch is indexed into the scope `branch:<name>` without checking it out. |
| **Branch difference** | `branch_diff` | `branchDiff({ from, to, root })` | What `to` changes since its merge-base with `from`: files (added, removed, modified, renamed) and functions (added, removed, modified, renamed) and changed import and call relations. |
| **Mendix model difference** | `mendix_diff` | `mendixDiff({ from, to, root })` | The Mendix model changes `to` brings since its merge-base with `from`, read from git without a checkout or mxcli, for a single-file `.mpr` (MPR v1, documents compared by `ContentsHash`) and for `mprcontents/` (MPR v2, the `.mxunit` files git reports). Returns `commits` (sha, date, author, subject), `files`, and `documents`: per document `module`, `folders`, `name`, `qualifiedName`, `type` and `change`; for a modified one `elements` (added, deleted, modified; `type`, `name`, `detail` such as `NanoflowCallAction: Module.Flow`, and `properties` as `{ path, before, after }` with paths like `Action > ParameterMappings`; a pointer shows as `{ element }`); for a microflow or nanoflow `flow.before` / `flow.after` with `nodes` (`summary`, `status`) and `edges` (`from`, `to`, `cases`, `status`). Needs Node 22.13+ (`lens node`). |
| **Diff impact** | `diff_impact` | `diffImpact(args)` / `changedFunctions({ from, to, git, readFile })` | The functions a diff changes (the work not committed yet, or `from`..`to`) with callers, tests, bound/unbound call counts, complexity and test gaps; riskiest first, with `total` and `truncated`. |
| **Search over projects** | `cross_repo_search` | `crossRepoSearch(args)` | `searchView` over every registered project or `repos: [...]`, project after project; unregistered names in `unknown`. |
| **Tool metadata** | (all tools) | `RESEARCH_TOOL_SCHEMAS`, `buildMcpToolSchemas()` | Every schema has `readOnly` (MCP `annotations.readOnlyHint`); the discussion tools carry `usedBy: ['/discuss', '/research']` so a host such as Kura gives them only to those consumers. |
| **Branch impact** | `branch_impact` | `branchImpact({ change, against, root })` | What a change on one branch (e.g. a bugfix on `release`) means for another: functions still used there (file and line), overlap, shared files and text merge conflicts. |
| **Commit inspection** | `commit_show` | `commitShow({ commit, root })` | What one commit changed (files and functions against its first parent); for a merge commit, what the merge brought in. |
| **Function history** | `function_history` | `functionHistory({ name, file, ref, max, root })` | Commits that added, modified or removed one function; without `name` every commit that touched the file. Name based: a renamed function starts a new history. |

### Branches and commits

The graph knows which branch and commit it was built on:

- After every sync a `Branch` node points to its `Commit` (`HEAD_AT`). `repo_sync` reports how many commits came in since the previous sync on that branch. A commit that changed no file is recorded too.
- A saved discussion gets `CREATED_AT` (commit) and `ON_BRANCH` (branch). If you switch to a branch where the source file does not exist, the discussion stays; `discussion_query` shows the source as "not on this branch" and on which branch the file does exist. Switching back and syncing restores the link by itself.
- `repo_sync({ branch: 'feature-x' })` reads that branch with `git ls-tree` and `git cat-file --batch` into its own scope `branch:feature-x`. The working copy, `HEAD` and the project scope stay unchanged. A second call only reads what changed since the stored commit. This scope has no Mendix contributions and no co-change signal.
- `branch_diff`, `branch_impact`, `commit_show` and `function_history` read git directly and check nothing out. Functions are compared by name and content (hash of the body); a function whose name changed but whose body is alike (same file, or a renamed file) shows as `renamed` with `oldName`, and `branch_diff` also lists added and removed import and call relations (`relations`). `branch_impact` finds callers with `git grep` (at most 20 references per function; for a renamed function it searches the old name) and uses `git merge-tree --write-tree` (git 2.38 or newer) for conflicts.
- All git calls go through `core/git` (`createGit({ root, run })`); a test checks that git is started nowhere else. `createFakeGit(state)` is an in-memory git for tests; `test/gitPort.contract.test.js` runs the same scenario on both and compares the answers.

---

## 3. Configuration through `config.json`

All `lady-lens` settings can be set in one central **`config.json`** file in the root of the project.

### Automatic detection
`lady-lens` looks for configuration files in this order:
1. A file given with `--config <path>` or the environment variable `LENS_SETTINGS_PATH`.
2. `config.json` (recommended default)
3. `lens.config.json`
4. `.lady-lens.json`
5. `.lady-lens.yaml`

### Complete example of `config.json`

```json
{
  "project": {
    "graph_roots": ["."],
    "exclude_dirs": [
      ".git",
      ".memory",
      "node_modules",
      "outputs",
      "coverage",
      "dist",
      "build",
      "target",
      ".vs",
      ".idea"
    ],
    "graph_extensions": [
      ".js",
      ".mjs",
      ".ts",
      ".jsx",
      ".tsx",
      ".cs",
      ".csproj",
      ".sln",
      ".sql",
      ".ps1",
      ".md",
      ".yaml",
      ".yml",
      ".json"
    ]
  },
  "graph": {
    "ast": {
      "enabled": false
    },
    "documentation": {
      "enabled": true
    },
    "links": {
      "enabled": true
    },
    "freshness": {
      "default_max_age_days": 30
    }
  },
  "mcp": {
    "port": 4318,
    "uiPort": 4317
  },
  "database": ".memory/graph/project.lbdb",
  "env": {
    "TOOL_RESULT_CHARS": "6000",
    "READ_CHUNK_MAX_CHARS": "12000",
    "READ_CHUNK_MAX_LINES": "400",
    "GREP_MAX_MATCHES": "50",
    "DEBUG_LEVEL": "2",
    "DEBUG_LOG_FILE": ""
  }
}
```

### Configuration sections

1. **`project`**:
   - `graph_roots`: folders to index (default `["."]`).
   - `exclude_dirs`: folders ignored during sync, glob and grep.
   - `graph_extensions`: file extensions included in the code graph.
2. **`graph`**:
   - `ast.enabled`: also store the full JavaScript syntax tree of every file (default `false`). Symbols, calls and functions are extracted either way; the stored tree is about 9× the size of the source and can fill the graph database's buffer on large vendored bundles.
   - `documentation.enabled`: index markdown documents and link frontmatter.
   - `links.enabled`: link import and call relations automatically.
   - `freshness.default_max_age_days`: maximum age before automatic re-indexing.
3. **`mcp`**:
   - `port`: HTTP/SSE port of the MCP server (default `4318`).
   - `uiPort`: web UI dashboard port (default `4317`).
4. **`database`**:
   - Path to the LadybugDB database file. If not set, lens uses `~/.lady-lens/repos/<id>/graph.lbdb`.
5. **`env`**:
   - Sets lens environment variables directly (such as `TOOL_RESULT_CHARS`, `DEBUG_LEVEL`).

---

## 4. Using it as an npm package

Install the package as a dependency from npm (or a `.tgz` built with `npm run pack`, see [section 0](#0-installation-and-setup)):

```bash
npm install lady-lens
npm install ..\lady-lens\dist\lady-lens-<version>.tgz   # a build from source
```

### Direct imports (main entry)

Every port is available from the root export:

```javascript
import {
    createGraphSync,
    functionViewTool,
    folderViewTool,
    healthTool,
    definedInTool,
    graph_query,
    grep,
    glob,
    read_chunk,
    RESEARCH_TOOLS,
    loadProjectSettingsSync
} from 'lady-lens';

// 1. Read the settings (reads config.json automatically)
const settings = loadProjectSettingsSync();

// 2. Incremental sync of the repository
const syncResult = await createGraphSync().sync({ mode: 'incremental' });
console.log(`Graph synced: ${syncResult.nodes} nodes`);

// 3. Ask for a function view
const fnDetails = await functionViewTool({ symbol: 'createGraphSync' });
console.log('Callers of createGraphSync:', fnDetails.callers);

// 4. Inspect code health
const health = await healthTool({ limit: 5 });
console.log('Top hotspots:', health.hotspots);

// 5. Semantic graph query
const queryResult = await graph_query({ query: 'database storage' });
console.log('Nodes found:', queryResult.nodes);
```

### Modular subpath imports

Specialised scenarios can use subpath imports:

```javascript
import { createGraph, createGraphRepository } from 'lady-lens/graph';
import { RESEARCH_TOOLS, grep, glob } from 'lady-lens/search';
import { createLadyLensMcpServer, createMcpHttpServer } from 'lady-lens/mcp';
import { listRegisteredRepos, registerRepo } from 'lady-lens/repository';
import { createProfiler, globalProfiler } from 'lady-lens/observability';
```

---

## 5. Using it as an MCP server

Start the background service with the CLI:

```bash
lens mcp -d
```

This starts:
- The **Streamable HTTP MCP server** on `http://127.0.0.1:4318/mcp`
- The legacy **SSE MCP server** on `http://127.0.0.1:4318/sse`
- The **UI dashboard** on `http://127.0.0.1:4317`

### AI assistant configuration

Add the server to your MCP configuration file (for example in Antigravity, Claude Desktop, Cursor or VS Code):

#### Streamable HTTP mode (recommended)
```json
{
  "mcpServers": {
    "lady-lens": {
      "url": "http://127.0.0.1:4318/mcp"
    }
  }
}
```

Use `/sse` only for older clients that do not support Streamable HTTP.

### Configuration files through MCP

No extra setting in `config.json` is needed. The agent uses these tools:

```json
{
  "name": "config_references",
  "arguments": { "reference": "PUREQU_OP" }
}
```

This returns, among other things, `referenceManager.xml`, the line number and the matching text. Use `config_references` for this, not `imports` or `importedBy`.

Read the file before changing it. Then pass the complete new content to `config_update`. Use the SHA-256 of the content you read as `expectedHash`; a stale update is refused.

```json
{
  "name": "config_update",
  "arguments": {
    "path": "App/App.csproj",
    "content": "<Project>...</Project>",
    "expectedHash": "<sha256>"
  }
}
```

Supported: `.csproj`, `.sln`, `.props`, `.targets`, `.xml`, `.ini`, `.yaml`, `.yml`, `.toml` and `package.json`. After an update an incremental graph sync runs.

### Agent instruction

Use this text in the agent chat:

> Use Lady Lens MCP. First pick the right repo with `repo` or register it with `lens add`. Use `config_references` for questions like: who references `PUREQU_OP`? Do not use `imports` or `importedBy`. Then read the config files found. Use `config_update` with the complete new content and `expectedHash`. Do not write directly outside `config_update`.

#### One daemon, several projects
One daemon serves every registered project (`lens add <folder>`). Pick the project per client in the URL:

```json
{ "mcpServers": { "lady-lens": { "url": "http://127.0.0.1:4318/mcp?repo=C:/git/my-project" } } }
```

- `repo` is a registered folder or id; the `X-Lens-Repo` header works too.
- An unregistered repo is refused (HTTP 403): run `lens add <folder>` first.
- Without `repo` the folder where `lens mcp -d` was started applies; a tool call can override that with its `repo` argument.
- Tool calls run one after another, so simultaneous requests for different projects do not affect each other.
- The UI dashboard that starts with `lens mcp -d` works the same way: `http://127.0.0.1:4317/?repo=<folder or id>` shows that project (not registered: HTTP 403); with more than one registered project a dropdown appears.

#### Direct stdio mode
```json
{
  "mcpServers": {
    "lady-lens": {
      "command": "node",
      "args": ["C:/git/lady-lens/bin/lens.mjs", "mcp", "--stdio"]
    }
  }
}
```

---

## 6. CLI command reference

The command line interface `lens` gives direct access to every feature:

| Command | Description |
| :--- | :--- |
| `lens sync [--repo <dir>] [--full] [--debug]` | Sync the graph for the current project or a target folder. `--debug` writes every step (scan, parse, mxcli calls, graph write) with its time, size, memory and any error stack to `~/.lady-lens/logs/sync-<time>.log`. |
| `lens ask <tool> '<json>'` | Call one of the research tools directly (e.g. `lens ask functionView '{"symbol":"createProfiler"}'`). |
| `lens mcp [-d]` | Start the MCP server (optionally in the background with `-d`). |
| `lens stop [pid]` | End the background daemon and release ports and locks, or only the given PID. |
| `lens ps` | Show the tracked daemon PIDs per folder. |
| `lens status` | Show whether the background daemon is running. |
| `lens ui [--port 4317]` | Start the interactive graph visualisation in the browser. The **Stacktrace** tab ties a pasted Node, .NET, Python or Java trace to project files and functions (`POST /api/trace`, `traceView` in `core/search/stackTrace.js`). The four tabs share one place in the URL (Back/Forward, crumbs, copyable link). Under the code: health issues, the function at the line with callers, calls, call tree, tests and documents, the file's imports, and its history (`GET /api/at`, `/api/flow`, `/api/history`; `callFlow`, `toMermaid`, `codeHistory` in `core/search`). Graph Network: the flow diagram of the function with Mermaid export. |
| `lens list` | Overview of all registered repositories and their database paths. |
| `lens add <dir>` | Register a new project and run the first sync right away. |
| `lens remove <id\|dir>` | Remove a repository from the registry. |
| `lens tools` | Show all available tools with their schemas and parameters. |
| `lens install [agent...]` | Install the MCP stdio configuration in detected agents. |
| `lens install --skill` | Install the Lady-lens workflow skill, write `~/.lady-lens/lens-instructions.md`, and add one marked line pointing to it in `~/.claude/CLAUDE.md`, `~/.copilot/copilot-instructions.md`, `~/.codex/AGENTS.md` and `~/.vibe/AGENTS.md`; own rules files for VS Code and Antigravity. |
| `lens uninstall [agent...]` | Remove the MCP entry from the agents. |
| `lens uninstall --skill` | Remove the skill, the marked line and the two rules files. |
| `lens install --mendix` | Install the `lady-lens-mendix` skill in the detected Claude, Copilot and Agents skill directories: search Mendix pages, widgets and flows in `.mxcli/mdl` (written by `lens sync` from mxcli's catalog), change them with `mxcli`. `lens uninstall --mendix` removes it. |
| `lens update [<version or file.tgz>]` | Update lady-lens: stop every lens process (on Windows they keep the graph database module open and npm cannot replace it), `npm install -g` the newest version (or the given version or local tgz), then let the new lens re-register itself where it was registered and copy again the skills and policies that are installed (`lens install --refresh`), and start the daemon again if it ran. Reconnect your agents afterwards. `lens install skill`, `lens install skill-mendix` and agent names (`vscode`, `claude-code`) work as well as `--skill` / `--mendix`. |
| `lens node [<path to node.exe> or --clear]` | Run lens on another Node than the one on PATH, e.g. Node 22.13+ for the Mendix MDL export while nvm keeps Node 18 for your projects. The choice is kept in `~/.lady-lens/lens.json`, so it holds at once, in every terminal and for agents started from the desktop (unlike `setx`, which only reaches terminals started later). It stops lens, re-registers the agents with that Node (`lens install --refresh`) and starts the daemon again if it ran. `lens node` shows the choice, `--clear` undoes it. `LENS_NODE` overrides the file. |
odejs
ode.exe"`, open a new terminal, then `lens stop` and `lens install --refresh`. |
| `lens v` / `lens version` | Show the installed package version. |
| `.\scripts\update-lens.ps1 [-Pack] [-Source <source>]` | Older script for a build from source; `lens update <file.tgz>` does the same and also refreshes the agents and skills. |
