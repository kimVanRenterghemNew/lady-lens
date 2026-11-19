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
lens install --hooks              # non-blocking Git post-commit hooks for background sync
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

### How `graph_query` ranks code: terms and names

A text query is ranked by `rankGraphNodes` (`core/graph/query/graphRank.js`). With `kind: 'code'`, `kind: 'all'` or no kind, two orders are made: the term order and the name order (over the code files only, so names never lift a document or a decision; `kind: 'doc'` and `'test'` rank on terms alone). Two ways turn them into one ranking:

- **fusion (default, `nameFusion.js`):** when the gate opens, reciprocal rank fusion of the term order (top 20, weight 1) and the name order (top 50, weight 0.4): `weight / (5 + rank)` per order, summed; otherwise the term order stays as it is.
- **learned (opt-in, `nameModel.js`):** a linear model over the name vector of each candidate (below). Ask for it with `graph_query` `ranking: 'learned'`, `rankGraphNodes(…, { ranking: 'learned' })` or `{ nameModel }`, or for a whole process with `configureNameModel(NAME_MODEL)`.

The learned ranking won on lens's own eval sets but lowered a host's plan-pick cases (long requests with many domain words), so the default stays the fusion, which lowers none.

```text
query ──► graphRank.js ── term order (top 20) ───────────┐
            │  tokenize, IDF per term, name/export/       ├─► fusion (default): gate, RRF ─► ranked files
            │  purpose matches, bonuses                   │
            └► nameRank.js ── name order (top 50) ───────┴─► learned (opt-in): feature rows,
                 words and word pairs of the names,            Σ w · (x − mean) / std ─► ranked files
                 IDF per feature
```

**Why names.** The term order counts each word of 3+ letters on its own. A query often names a concept that lives in a *name* ("task id" → `TASK_ID_RE`, "plan ids" → `planIds`). There `id` is too short to count, and `task` and `id` in two unrelated places score the same as `task→id` in one name. The name order keeps short words and the order of words.

**How the name order works** (`core/graph/query/nameRank.js`, no new nodes, no schema change):

1. **Words of a name.** `nameParts` splits camelCase, capital runs and every non-letter: `TASK_ID_RE` → `task id re`, `HTTPServer` → `http server`. Words of 2+ letters count, stop words and numbers do not.
2. **Features.** `features` makes, from a run of words: single words (`u:task`), neighbour pairs with their order (`b:task>id`) and skip pairs up to 3 words apart (`s:task>plan`).
3. **Index per file**, with a role weight: what a file *is* weighs more than what it *uses*.

   | Role | Source on the `CodeFile` node | Weight |
   | :--- | :--- | ---: |
   | name | path (folders and file name), `exports`, `symbols` | 2 |
   | purpose | `purpose`, per sentence | 1.5 |
   | use | callees in `calls`, `reads` | 0.4 |

   A feature keeps the highest role it has in that file. `buildNameIndex` keeps, per feature, the list of files with their weight; the length of that list is the document frequency.
4. **Name vector** (`nameVectors`). The query gets the same features, plus the same sentence with each word in its first lexicon translation (so Dutch questions form English pairs too). Per file the matches are summed per kind × role, kept apart: `Σ ln(1 + N / df)` for `u|name`, `b|name`, `s|purpose`, … (9 numbers). `nameScores` is the hand-weighted sum of them (kind 1 / 2.5 / 1.5 × role 2 / 1.5 / 0.4) and gives the name order.
Steps 5–7 are the learned ranking (opt-in); the default fusion uses the name order of step 4 as it is.

5. **Candidates** (`nameCandidates`). The term order's top 20 and the name order's top 50. Each candidate gets a feature row: `ln(1 + x)` of its 9 vector numbers, `1 / (6 + term rank)` (0 outside the term order), and the role **test**: `ln(1 + Σ idf)` of the query's words and neighbour pairs in the names of the tests that cover the file (`u|test`, `b|test`). Sync stores those names on each test file (`testNames`: the titles of `describe`/`it`/`test`, Python `test_…` functions, C# methods under `[Fact]`/`[Test]`/`[TestMethod]`/…); `TESTS` edges give them to the code they test. A database synced before 1.8.2 has no `testNames` until `lens sync --full`: the role is then 0 and the ranking is that of the other features.
6. **Brake on name-only candidates.** A file the term order does not hold ranks with the rest only when the gate opens (`gateOpens`: the best name hit has a query pair in a name or purpose and leads the fifth hit by 1.5 ×). Otherwise the model reorders the term order and the name-only files follow it. A long request with many domain words otherwise lets many weak name hits in.
7. **Learned score** (`rankWithNameModel`, `NAME_MODEL`). A linear model: `Σ w · (x − mean) / std`, best first. The weights are learned, not chosen: on pairs "paragraph of a document ↔ the code file it names" (the name taken out of the text), with a pairwise logistic loss and gradient descent (`trainNameModel`, `evals/learnNameModel.mjs`). The shipped weights: term rank 0.72, pair in a name 0.27, pair in what a file uses 0.27, word in a name 0.27, pair in a test name 0.15, a loose word in a test name −0.15, the rest 0.06–0.18. "task id" ranks the file that defines `TASK_ID_RE` higher. The `score` of each result stays its term score; term results beyond the candidates follow.

**Training is deterministic.** Documents are sorted by path, a paragraph repeated in a mirror counts once, documents are split into training and held-out by a seeded shuffle, and training runs full-batch from zero weights: the same input gives byte-equal weights (tested). `node evals/learnNameModel.mjs --repo <synced dir>[=<exclude file>] … --out model.json` reproduces `NAME_MODEL` from the two repositories it was learned on.

**Public API** (from `lady-lens` and `lady-lens/graph`): every step is a port, so a caller can rank its own entries, train on the pairs it selects, and give lens its model.

```js
import { nameParts, nameFeatures, buildNameIndex, nameScores, nameVectors, rankWithNameModel,
         namePairsFromDocs, nameTrainingExamples, trainNameModel, configureNameModel, NAME_MODEL } from 'lady-lens';

nameParts('TASK_ID_RE');            // ['task', 'id', 're']
nameFeatures('task id');            // ['u:task', 'b:task>id', 'u:id']; prefix = kind (u word, b pair, s skip pair)

// rank your own entries, no graph: the test file of a source file
const tests = buildNameIndex(testPaths.map(path => ({ path })));   // entries: { path, exports?, symbols?, purpose?, calls?, reads? }
rankWithNameModel(tests, 'core/routing/modeClassifier.js')[0];     // { node, score, row }; no brake: every entry is your own
buildNameIndex(codeNodes, { testNamesOf: node => namesOfItsTests }); // your own test link, for the role test
nameIndexFor(graph, codeNodes);                                      // the index graph_query uses (test names from TESTS edges)

// train on what you select, and use it
const pairs = namePairsFromDocs(docs, codePaths, { include: ['docs/'], exclude: ['backlog/'] }); // or your own [{ text, files }]
const model = trainNameModel(nameTrainingExamples(buildNameIndex(codeNodes), pairs, termOrderFor));
configureNameModel(model);          // every code query of this process; null = NAME_MODEL again
rankGraphNodes(graph, text, { kind: 'code', nameModel: model });   // or per call
```

IDF is counted over the entries you pass, so pass the whole set you choose from (for example every test file of the repo). Over MCP, `graph_query` takes `names: false` for the term order alone, and **`name_match`** does the same name matching on files you choose: `{ text, files? | glob?, limit? }` → `[{ path, kind, score, pairs, words }]`, the pairs and words being the reasons (e.g. the test file of a source file: `text` = the source path, `glob` = `"test/**"`; or the code a paragraph of a document is about: `text` = the paragraph, `glob` = `"core/**"`, and `doc` = the document's path, so the files that document names elsewhere come first when one of them is a clear match (a word pair, twice the score of the next; marked `fromDoc`). Measured on documents that name a file, with the name taken out: without `doc` the right file is in the top 3 for 35–82 %; with `doc` a `fromDoc` match was the named file 81 % of the time on one repo's docs and 49 % on another's (docs that name many files per page), and the named file, a file of the same section or a direct graph neighbour of it 83 % and 60 %. So it stays a suggestion to check: lens does not turn it into an edge).

**Lifetime.** The index is built in memory once per loaded graph (`nameIndexFor`). In a process that has asked a code query before (a daemon or MCP server using the name ranking), every later graph load builds it in the background (`warmNameIndex`, an unref'd timer), so the next code query finds it ready; a process that never ranks code spends nothing on it, and a one-off CLI run does not wait for it. `npm run bench` measures it as `query: graph_query code`. A sync loads a new graph, so the next query uses a new index with the renamed symbols. Sync itself does not change, apart from reading the test names of test files.

**Measured** (top 3 / MRR, `evals/behaviourEval.mjs`; backlog item `backlog/bloom-tree-compresier-match.md`):

| Set | 1.7.2 (terms) | 1.8.1 and 1.8.2 default (fusion) | 1.8.2 `ranking: 'learned'` |
| :--- | :--- | :--- | :--- |
| Kura, 50 mined commits | 26 / 0.478 | 27 / 0.496 | 29 / 0.500 |
| Kura, 50 more (seed 2) | 25 / 0.468 | 26 / 0.486 | 29 / 0.524 |
| graphify, 20 | 15 / 0.595 | 15 / 0.595 | 15 / 0.604 |
| behaviour NL + EN, 7 | 3 / 0.204 | 3 / 0.261 | 4 / 0.427 |
| behaviour NL, 8 | 5 / 0.347 | 5 / 0.358 | 5 / 0.459 |
| Polly (C#), 50 | 8 / 0.148 | 8 / 0.152; with C# type edges 11 / 0.188 | 11 / 0.187 (with type edges) |
| a closed C# code base on a platform, 50 (stress test) | 14 / 0.234 | 15 / 0.258; with C# type edges 18 / 0.312 | 25 / 0.387 (with type edges) |

On JavaScript and Python the 1.8.2 default is the 1.8.1 ranking exactly (the same numbers on every set); C# gains from the type edges of 1.8.2.

**C#: links by type.** C# imports namespaces, not files, so sync links C# files by the types they use: a file whose code names a type (`typeRefs`, PascalCase names outside comments) gets an `IMPORTS` edge to the one file that declares that type (`types`), a `TESTS` edge from a test file. A name that two or more files declare gets no edge (no guess). These edges are `INFERRED`. They feed `importedBy`, `functionView` callers and tests, impact, and the role test of the learned ranking.

The weights transfer across repositories: learned on graphify alone, they lift every Kura set above the hand fusion, and learned on Kura alone they lift graphify (0.595 → 0.624). The price of every re-ranking stays: some single cases drop a place.

---

## 2. API ports: access through MCP and the npm package

Every feature of `lady-lens` is a **first-class API port**, available programmatically through the npm package (`lady-lens`) and interactively through the Model Context Protocol (MCP).

The library sync API is `createGraphSync().sync({ mode: 'incremental' })`; use `mode: 'full'` for a complete re-index.

### Overview of all ports

| Port / domain | MCP tool | npm export (`lady-lens`) | Description |
| :--- | :--- | :--- | :--- |
| **Function analysis** | `functionView` | `functionView(graph, symbol, { readFile, maxSites })` / `functionViewTool(args)` | Definition, line numbers, docstring/purpose, parameter seams (`parameterSeams`: methods and properties called on parameters), all calling files (`callers`), linked tests and referenced backlog stories of a function; `resolved` and `unresolved` call counts (a `note` "niet bewezen leeg" when none is bound but the name appears); for a class `children` (methods) and `inheritors` (subclasses). |
| **Folder and module analysis** | `folderView` | `folderView(graph, folder)` / `folderViewTool(args)` | Structure of a folder: parts, internal data flow, who calls the folder from outside and possible deviations (cycles, untested files). |
| **Code health and metrics** | `health` | `codeHealth(graph, opts)` / `healthTool(args)` | NDepend-style statistics: test reach (including index.js barrels), cyclic dependencies, boundary violations, hotspots (churn x lines), coupling (Ca, Ce, instability), zone of pain, and AST design smells with actionable pattern advice (`dispatch-chain`, `fallback-heavy`, `deep-nesting`, `loop-branching`, `long-condition`, `flag-parameter`, `repeated-literal`, `global-mutable-state`, `direct-io`, `god-module`). A measured line coverage (`coverage-summary.json`, written by `vitest --coverage` with the `json-summary` reporter) beats the import guess: a file covered through another one is tested, and its exports are not guessed by name. Barrels (`index.js`) are never flagged for untested exports, fan-in/out, zone of pain or god-module; tool config files (`*.config.*`) are scripts. On request `hubs` (most neighbours) and `bridges` (betweenness), each with `total` and `truncated` (`hubsAndBridges(graph, opts)`). |
| **Symbol location** | `definedIn` | `definedIn(graph, symbol)` / `definedInTool(args)` | Where an identifier is defined or exported: file path and exact start/end lines. |
| **Imports** | `imports` | `importsOf(graph, file)` / `imports(args)` | Which files and modules a given file imports directly. |
| **Dependents** | `importedBy` | `importersOf(graph, file)` / `importedBy(args)` | Which files import the given file (fan-in analysis). |
| **Exports** | `exports` | `exportsOf(graph, file)` / `exportsTool(args)` | Complete sorted list of exported functions, variables and types of a file. |
| **File check** | `exists` | `fileLookup(graph, file)` / `fileExists(args)` | Checks whether a file is in the project graph; suggests matches for typos or moved folders. |
| **Graph search** | `graph_query` | `graph_query(args)` / `rankGraphNodes(graph, query)` | Semantic and keyword search through the graph by relevance score, IDF weighting and relations. With `kind: 'code'` the words of names count too: see [How `graph_query` ranks code](#how-graph_query-ranks-code-terms-and-names). |
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
| **Mendix model difference** | `mendix_diff` | `mendixDiff({ from, to, root, detail, ignore, documents, modules })` | The Mendix model changes `to` brings since its merge-base with `from`, read from git or disk worktree without a checkout or mxcli, for single-file `.mpr` (MPR v1) and `mprcontents/` (MPR v2). Supports cross-folder resolution for multi-clone repos (`repo_list` groups), `to: 'working-tree'`, compact element diffing (`detail: 'changes' | 'summary' | 'full'`), noise reduction (`ignore: ['translations', 'layout']`), and added/deleted document elements. Returns `schemaVersion: 1`, `resolved`, `commits`, `widgets`, `files`, `documents` and `ignored`. Needs Node 22.13+ (`lens node`). |
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
  "arguments": { "reference": "INVENTORY_OP" }
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

> Use Lady Lens MCP. First pick the right repo with `repo` or register it with `lens add`. Use `config_references` for questions like: who references `INVENTORY_OP`? Do not use `imports` or `importedBy`. Then read the config files found. Use `config_update` with the complete new content and `expectedHash`. Do not write directly outside `config_update`.

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
| `lens bench [--repo <dir>] [--runs N] [--baseline] [--no-processes] [--json]` | Time the sync (with its phases) and every question on a repository, in a temporary database: the registry and the repository's own database stay as they are. Saves the run in `~/.lady-lens/bench/<repo id>/` (numbers and environment, no paths or code) and compares it with the baseline there; `lens bench compare` compares the newest run again. See README, Performance. |
| `lens install [agent...]` | Install the MCP stdio configuration in detected agents. |
| `lens install --skill` | Install the Lady-lens workflow skill, write `~/.lady-lens/lens-instructions.md`, and add one marked line pointing to it in `~/.claude/CLAUDE.md`, `~/.copilot/copilot-instructions.md`, `~/.codex/AGENTS.md` and `~/.vibe/AGENTS.md`; own rules files for VS Code and Antigravity. |
| `lens install --hooks` | Install non-blocking Git hooks (`post-commit`, `post-checkout`, `post-merge`, `post-rewrite`) in `.git/hooks` for bundled background daemon sync (`POST /sync?repo=...`). `LENS_HOOKS=0` disables. |
| `lens uninstall [agent...]` | Remove the MCP entry from the agents. |
| `lens uninstall --skill` | Remove the skill, the marked line and the two rules files. |
| `lens uninstall --hooks` | Remove lady-lens hook blocks from `.git/hooks`, leaving other hook content intact. |
| `lens install --mendix` | Install the `lady-lens-mendix` skill in the detected Claude, Copilot and Agents skill directories: search Mendix pages, widgets and flows in `.mxcli/mdl` (written from mxcli's catalog by a background export that `lens sync` starts after a model change; it never holds up the sync or MCP calls: `LENS_MDL_EXPORT=background|inline|off`, state in `.mxcli/lens-mdl.json`), change them with `mxcli`. Every other mxcli call stops after `LENS_MXCLI_TIMEOUT_MS` (default 120000); when mxcli gives nothing, the previous Mendix model is kept. `lens uninstall --mendix` removes it. |
| `lens update [<version or file.tgz>]` | Update lady-lens: stop every lens process (on Windows they keep the graph database module open and npm cannot replace it), `npm install -g` the newest version (or the given version or local tgz), then let the new lens re-register itself where it was registered and copy again the skills and policies that are installed (`lens install --refresh`), and start the daemon again if it ran. Reconnect your agents afterwards. `lens install skill`, `lens install skill-mendix` and agent names (`vscode`, `claude-code`) work as well as `--skill` / `--mendix`. |
| `lens node [<path to node.exe> or --clear]` | Run lens on another Node than the one on PATH, e.g. Node 22.13+ for the Mendix MDL export while nvm keeps Node 18 for your projects. The choice is kept in `~/.lady-lens/lens.json`, so it holds at once, in every terminal and for agents started from the desktop (unlike `setx`, which only reaches terminals started later). It stops lens, re-registers the agents with that Node (`lens install --refresh`) and starts the daemon again if it ran. `lens node` shows the choice, `--clear` undoes it. `LENS_NODE` overrides the file. |
| `lens v` / `lens version` | Show the installed package version. |
| `.\scripts\update-lens.ps1 [-Pack] [-Source <source>]` | Older script for a build from source; `lens update <file.tgz>` does the same and also refreshes the agents and skills. |
