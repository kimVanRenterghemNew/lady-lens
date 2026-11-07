# lady-lens

A code graph for repositories in many languages: where a function is defined, who imports a file, what a function does and which tests and stories touch it, what was decided. Local, on [Ladybug](https://www.npmjs.com/package/@ladybugdb/core), no model needed. See [Supported languages](#supported-languages).

> 📖 **Documentation**: see [DOCUMENTATIE.md](DOCUMENTATIE.md) (written in English) for the full guide to architecture, all API ports (through MCP and npm), configuration through `config.json` and code examples.

## Where it comes from

lady-lens grew inside the build of our own coding agent, Kura. We used it there to give the agent a better, narrower context: the right files, functions and decisions instead of everything. It turned out so handy and so fast that we exported it as its own package. Built locally, not published.

## Setup

Needs Node.js 18 or newer. Run these steps once, in order.

**1. Install lady-lens** (it is not on npmjs.org; install it from a package built here):

```
cd C:\git\lady-lens
npm install                   # dependencies of lady-lens itself
npm run pack                  # builds dist\lady-lens-<version>.tgz
npm install -g .\dist\lady-lens-<version>.tgz
lens v                        # prints the version: `lens` is on your PATH
```

For development, `npm link` instead of the last install step makes `lens` run straight from this folder.

**2. Register your repository and index it:**

```
lens add C:\git\my-project    # registers the repo and runs the first sync
lens list                     # check that it is there
```

**3. Connect your AI agent** (pick one or both):

```
lens install                  # MCP entry (stdio) in every agent found; or name one: lens install vscode
lens install --skill          # the Lady-lens workflow skill for those agents
lens install --mendix         # the Mendix skill (search .mpr content via .mxcli/mdl, change it with mxcli)
```

`lens install --dry-run` shows what would change and writes nothing. Restart the agent afterwards (in VS Code: *MCP: List Servers* or reload the window).

**4. Or run one background service for all projects** (the HTTP alternative to step 3):

```
lens mcp -d                   # MCP on http://127.0.0.1:4318/mcp, UI on http://127.0.0.1:4317
lens status                   # is it running?
lens stop                     # stop it
```

In VS Code add it to `mcp.json` as `{ "servers": { "lady-lens": { "type": "http", "url": "http://127.0.0.1:4318/mcp?repo=C:/git/my-project" } } }`. See [MCP Configuration](#mcp-configuration-model-context-protocol) for the other agents.

**5. Update later** with one command: it stops lens, installs the newest package from `dist` and starts the daemon again:

```
.\scripts\update-lens.ps1 -Pack     # build a fresh package from this source first
.\scripts\update-lens.ps1           # only install the newest package already in dist
```

## Use

```
lens sync                     # index this repo (incremental; --full re-indexes everything)
lens mcp                      # MCP server (Streamable HTTP on /mcp, UI dashboard on 4317)
lens mcp -d                   # run MCP + UI in background (detached)
lens stop                     # stop background lady-lens daemon
lens ps                       # list tracked daemon PIDs per folder
lens v                        # print the installed version
lens ask functionView '{"symbol":"createGraphSync"}'
lens ask importedBy '{"file":"core/graph/index.js"}'
lens ask graph_query '{"query":"plan review"}'
lens ask graph_query '{"query":"plan review","kind":"doc"}'   # only the documentation
lens ui                       # http://127.0.0.1:4317: search, nodes coloured per type, code and docs
lens list                     # every repo lens knows
lens add <dir>                # register a repository and sync
lens remove <id|dir>          # unregister a repository
lens tools                    # every question and what it answers
```

`--repo <dir>` asks about another repo than the current folder; `lens ui --port 5000` picks another port.

## Questions

| Tool | Answers |
|---|---|
| `definedIn` | where a function or name is defined, with lines |
| `functionView` | what a function does: definition and lines, purpose, callers, tests (with test names), stories; bound (`resolved`) and unbound (`unresolved`) calls, with "niet bewezen leeg" when nothing is bound but the name appears; for a class its methods (`children`) and subclasses (`inheritors`); `maxSites` for more than 5 lines per file |
| `diff_impact` | what my change touches: the functions the work not committed yet (or a range `from`..`to`) changes, with callers, tests, complexity and test gaps, riskiest first |
| `importedBy` / `imports` | who imports a file / what it imports |
| `exports` | what a file exports |
| `exists` | whether a file exists, and where a file with that name does |
| `cross_repo_search` | one search over all registered projects, or `repos: [...]`; results per project, unregistered names in `unknown` |
| `graph_query` | files about a subject; `kind: "doc"` only documentation (for a file path: the documents that name it first, `mentions` and `lines`); `history: true` also superseded decisions; a `node` gets its `consequences` and `risks`, and a one-hop answer says `total` and `truncated` |
| `grep`, `glob`, `read_chunk` | text search, paths, and lines of a file, with the same exclusions as the graph |
| `config_grep` | config-only search, including `.csproj` and reference-manager XML |
| `config_references` | find which config files reference a package, project, or functional block by name |
| `config_update` | safely replace one config file and refresh its graph facts; supports `expectedHash` |
| `repo_sync` | index the repository; records the branch and commit and reports `commitsSince`; `branch: "<name>"` indexes another branch into its own scope `branch:<name>` without checking it out |
| `branch_diff` | what branch `to` changes since its merge-base with `from`: files and functions added, removed, modified, renamed, plus changed import and call relations |
| `branch_impact` | what a change on one branch (e.g. a bugfix on `release`) means for another: functions still used there, overlap, shared files, text merge conflicts |
| `commit_show` | what one commit changed (files and functions against its first parent) |
| `function_history` | the commits that added, modified or removed one function; without `name` every commit that touched the file |
| `health` | test reach, cycles, boundaries, hotspots, coupling; with `hubs: true` / `bridges: true` also the files with the most neighbours and the files on the most shortest paths |

## Branches and commits

The graph knows which branch and commit it was built on. After every sync a `Branch` node points to its `Commit` (`HEAD_AT`), and `repo_sync` reports how many commits came in since the last sync on that branch. Discussions are stored with the commit and branch they were made on (`CREATED_AT`, `ON_BRANCH`). A discussion keeps its source links when you switch to a branch where the file does not exist; `discussion_query` then shows the source as "not on this branch" and where it does exist. Everything reads git directly and never checks a branch out.

Compare before you merge:

```
branch_diff    { "from": "main", "to": "feature-x" }
branch_impact  { "change": "release", "against": "feature-x" }
commit_show    { "commit": "263e4279" }
diff_impact    { }                                   # the work not committed yet
diff_impact    { "from": "main" }                     # this branch since it left main
function_history { "name": "createGraphSync", "file": "core/graph/sync/graphSync.js" }
```

Git is started in one place only (`core/git`). Tests can use `createFakeGit` instead of a real repository; `test/gitPort.contract.test.js` keeps the two in line.

## MCP Configuration (Model Context Protocol)

lady-lens can be used by AI coding assistants (Antigravity, Cursor, Claude Desktop, Claude Code, Cline, Roo Code) as a native MCP server.

### Quick install (recommended)

```bash
lens install              # every agent found on this machine
lens install cursor vscode  # or name them: claude-code, claude-desktop, cursor, windsurf, gemini-cli, antigravity, vscode, codex, vibe
lens install --dry-run    # show what would change, write nothing
lens install --skill      # install the Lady-lens workflow skill for detected agents
lens install --skill --dry-run
lens uninstall            # remove lady-lens again
```

This adds a stdio entry (absolute `node` path, no daemon, no port) to each agent's MCP config, keeps its other servers, and saves the old file as `<file>.lady-lens.bak`. Restart the agent afterwards. A config with comments (JSONC) is reported and left untouched.

`lens install --skill` installs `skills/lady-lens/SKILL.md` in detected Claude, Copilot, or Agents skill directories, and makes lady-lens the default for code search (a skill only loads when a task matches it). The rules live in one file, `~/.lady-lens/lens-instructions.md` (from `skills/lady-lens/lens-instructions.md`). Files you own get only one marked line: in `CLAUDE.md` an `@` import of that file, elsewhere the core rule itself plus a link to it: `~/.claude/CLAUDE.md` (an `@` import), `~/.copilot/copilot-instructions.md`, `~/.codex/AGENTS.md` and `~/.vibe/AGENTS.md` (Mistral Vibe). VS Code (`User/prompts/lady-lens.instructions.md`) and Antigravity (`~/.gemini/config/rules/lady-lens.md`) get a rules file of their own. `lens uninstall --skill` removes the skill, that one line and those two files; nothing else in your files changes.

Start the background service:
```bash
lens mcp -d       # starts Streamable HTTP MCP on http://127.0.0.1:4318/mcp and UI on http://127.0.0.1:4317
lens stop         # stops the background services
lens stop <pid>   # stops one tracked process
lens ps           # lists the tracked daemon PIDs per folder
```

### One daemon, many projects
One daemon serves every registered project (`lens add <dir>`). Pick the project per client by putting it in the URL:

```json
{ "mcpServers": { "lady-lens": { "url": "http://127.0.0.1:4318/mcp?repo=C:/git/my-project" } } }
```

`repo` is a registered folder or id (the `X-Lens-Repo` header works too). An unregistered repo is refused (HTTP 403). Without it, the folder `lens mcp -d` was started in is used, and a tool call can still override it with its own `repo` argument. Tool calls are serialized, so simultaneous requests for different projects do not mix.

The UI dashboard started by `lens mcp -d` follows the same rule: `http://127.0.0.1:4317/?repo=<folder|id>` shows that project (unregistered: HTTP 403), and a dropdown appears when more than one project is registered.

### 1. Streamable HTTP Mode (Recommended)
When running `lens mcp -d`, add this to your MCP client configuration:

```json
{
  "mcpServers": {
    "lady-lens": {
      "url": "http://127.0.0.1:4318/mcp"
    }
  }
}
```

The legacy SSE endpoint remains available at `http://127.0.0.1:4318/sse` for older clients.

Config/project files are available through MCP without extra repository configuration:

```json
{ "name": "config_grep", "arguments": { "pattern": "PackageReference|ProjectReference" } }
```

`config_update` accepts the complete new file content. Read the file first, then pass its SHA-256 as `expectedHash` to reject stale edits:

```json
{
  "name": "config_update",
  "arguments": {
    "path": "App/App.csproj",
    "content": "<Project>...</Project>",
    "expectedHash": "<sha256-of-read-content>"
  }
}
```

The update is limited to repository config files and refreshes graph dependencies automatically.

### 2. Direct Stdio Mode
If you prefer the agent to spawn lady-lens directly on demand:

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

### Client Config Locations:
- **Google Antigravity**: `%USERPROFILE%\.gemini\antigravity\mcp_config.json`
- **Gemini CLI**: `%USERPROFILE%\.gemini\settings.json`
- **Claude Code**: `%USERPROFILE%\.claude.json`
- **Windsurf**: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- **Codex**: `%USERPROFILE%\.codex\config.toml` (`[mcp_servers.lady-lens]`)
- **Mistral Vibe**: `%USERPROFILE%\.vibe\config.toml` (`[[mcp_servers]]` with `name = "lady-lens"`)
- **VS Code**: `%APPDATA%\Code\User\mcp.json` (key `servers`)
- **Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor**: `Settings -> Cursor Settings -> MCP -> Add new MCP server`
- **VS Code (Cline / Roo Code)**: Settings -> MCP Servers

In the two TOML files `lens install` appends a block whose every line ends in `# lady-lens:mcp`; `lens uninstall` removes exactly those lines. An entry you wrote by hand is left alone.

## Where the data lives

One Ladybug database per repository in `~/.lady-lens/repos/<id>/graph.lbdb` (`<id>` = a short hash of the repo path), and a list of every repo in `~/.lady-lens/repos.json`. Nothing is written into the repository itself.

What is indexed: `.js`, `.mjs`, `.cjs` and `.md`, minus `node_modules`, `.git`, `outputs`, `coverage`, `dist`, `build`, `bin`, `obj` and a few more. A repository describes its own in `.lady-lens.yaml` (`project.exclude_dirs`, `project.graph_extensions`).

Node.js `>=18` is required. Mendix `.mpr` projects are handled through the `mxcli` contributor when `mxcli` is available.

Decisions: in a `besluiten.md`, every `- **Title**: text` under a `## YYYY-MM-DD` heading is a decision node; `(vervangt: <old title>)` supersedes an older one, which is then only shown with `history: true`.

## Evals

`npm run eval:graph` syncs a frozen mini-repo and lady-lens itself into a temporary database and asks `graph_query` the hand-checked questions in `core/eval/fixtureGold.json` and `evals/graph-gold.json`: recall@5, MRR, negatives that must stay empty, and freshness after add/change/remove. It is also part of `npm test`.

A host evaluates its own repository with the same functions:

```js
import { runGraphEval, formatGraphEval, scoreAnswer, summarize } from 'lady-lens/eval';

const report = await runGraphEval({ repo: { root, queries, settings }, thresholds });   // queries: { id, query, expected: [paths] }
console.log(formatGraphEval(report));
```

`scoreAnswer` and `summarize` score a search bench: an answer text against expected and forbidden paths, with precision, characters per correct item and richness.

## Performance

`npm run bench` syncs lady-lens itself into a temporary database and times every operation (full and incremental sync, graph load, `graph_query`, direct queries, `functionView`, `folderView`, `health`), then lists the bottlenecks. `npm run test:perf` runs the same checks as a test with thresholds. Use a change's numbers against this baseline; do not compare runs from different machines.

Baseline, lady-lens 1.0.7 (226 nodes, 983 edges), 2026-11-02, one run on a development machine:

| Operation | Calls | Average |
| :--- | ---: | ---: |
| Full sync | 1 | 1605 ms |
| Incremental sync (unchanged) | 1 | 88 ms |
| `graph_query` (end to end) | 20 | 108 ms |
| `health` | 5 | 129 ms |
| `folderView` | 10 | 71 ms |
| `functionView` | 10 | 62 ms |
| Direct queries (`imports`, `importedBy`, `exports`, `definedIn`, `exists`) | 15 each | 24 to 29 ms |
| `rankGraphNodes` | 50 | 3.3 ms |
| Graph load, cold / warm | 1 | 88 / 75 ms |
| `diff_impact` (all functions of one file changed) | 3 | 253 ms |
| `cross_repo_search` (3 folders) | 3 | 146 ms |
| `hubs` and `bridges` | 3 | 48 ms |

For a large repository, `scripts/lens-scale.mjs` generates one.

## Settings & Configuration

lady-lens can be configured fully through a **`config.json`** file in the root of your repository (see [DOCUMENTATIE.md](DOCUMENTATIE.md#3-configuration-through-configjson) for all options):

```json
{
  "project": {
    "graph_roots": ["."],
    "exclude_dirs": [".git", "node_modules", "dist", "build", "outputs", "coverage"],
    "graph_extensions": [".js", ".mjs", ".ts", ".cs", ".md", ".json"]
  },
  "graph": {
    "ast": { "enabled": true },
    "documentation": { "enabled": true }
  },
  "mcp": {
    "port": 4318,
    "uiPort": 4317
  },
  "env": {
    "TOOL_RESULT_CHARS": "6000",
    "DEBUG_LEVEL": "2"
  }
}
```

Settings can also be overridden with the environment variables `LENS_<NAME>`: `LENS_GRAPH_DB`, `LENS_REPO_ROOT`, `LENS_SETTINGS_PATH`, `LENS_TOOL_RESULT_CHARS`, `LENS_READ_CHUNK_MAX_CHARS`, `LENS_READ_CHUNK_MAX_LINES`, `LENS_GREP_MAX_MATCHES`, `LENS_DEBUG_LOG_FILE`, `LENS_DEBUG_LEVEL`.

## As a library (NPM Package)

Every API port is available directly from the package:

Repository sync goes through `createGraphSync().sync()`. Use `mode: 'incremental'` for the normal sync or `mode: 'full'` for a complete re-index.

```js
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
  configureLensEnv,
  configureLensLog
} from 'lady-lens';

// Run an incremental sync through the public sync API
const syncResult = await createGraphSync().sync({ mode: 'incremental' });

// Ask for function, folder or code health details
const fn = await functionViewTool({ symbol: 'createGraphSync' });
const health = await healthTool({ limit: 10 });
```

Specific subpath imports (`lady-lens/graph`, `lady-lens/search`, `lady-lens/tools`, `lady-lens/mcp`, `lady-lens/repository`) remain fully supported.

## Supported languages

For each file lady-lens extracts symbols with line ranges, exports, imports, calls, a purpose line and an estimate of cyclomatic complexity. These feed `definedIn`, `imports`, `importedBy`, `functionView`, `folderView` and `health`.

| Kind | Languages and files | How |
| :--- | :--- | :--- |
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | full syntax tree (acorn) |
| Other code | TypeScript (`.ts`, `.tsx`), C# (`.cs`), Python, Java, Kotlin (`.kt`, `.kts`), Swift, Go, Rust, C and C++ (`.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`), PHP, Ruby | pattern-based configuration per language (`core/graph/sync/languages`) |
| Database and web | SQL, CSS, SCSS, LESS, HTML | pattern-based |
| Scripts | Bash (`.sh`, `.bash`, `.zsh`), PowerShell (`.ps1`, `.psm1`, `.psd1`), batch (`.bat`, `.cmd`) | pattern-based |
| Infrastructure | Dockerfile, YAML, TOML, Terraform (`.tf`), `package.json` | pattern-based |
| Documents | Markdown, text, reStructuredText (`.md`, `.markdown`, `.txt`, `.rst`) | links, mentions and decisions |
| Project files | `.csproj`, `.sln`, `.props`, `.targets`, `.xml`, `.ini` | file nodes |
| Mendix | `.mpr` projects, through the `mxcli` contributor when `mxcli` is on the path | project, module, element and page-field nodes (`MendixPageField`, with `metadata.required` from the attribute's `IsRequired`) |

Only JavaScript uses a real parser. The pattern-based languages can miss unusual syntax, so treat their call and complexity numbers as estimates. Adding a language means adding one configuration file in `core/graph/sync/languages` and registering it in `index.js`; see the existing ones for the fields.

## Develop

```
npm test
npm run pack            # dist/lady-lens-<version>.tgz, to install in another project
```

Not here yet: a real parser for languages other than JavaScript, and framework-specific analysis.
