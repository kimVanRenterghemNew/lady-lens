# lady-lens

A code graph for JavaScript and C# repositories: where a function is defined, who imports a file, what a function does and which tests and stories touch it, what was decided. Local, on [Ladybug](https://www.npmjs.com/package/@ladybugdb/core), no model needed.

> 📖 **Documentatie**: Zie [DOCUMENTATIE.md](DOCUMENTATIE.md) voor de volledige gids over architectuur, alle API-poorten (beschikbaar via MCP en NPM), configuratie via `config.json` en code-voorbeelden.

## Where it comes from

lady-lens grew inside the build of our own coding agent, Kura. We used it there to give the agent a better, narrower context: the right files, functions and decisions instead of everything. It turned out so handy and so fast that we exported it as its own package. Built locally, not published.

## Use

```
npm install
npm link                      # makes `lens` available
cd <your repo>
lens sync                     # index this repo (incremental; --full re-indexes everything)
lens mcp                      # MCP server (HTTP/SSE on 4318, UI dashboard on 4317)
lens mcp -d                   # run MCP + UI in background (detached)
lens stop                     # stop background lady-lens daemon
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
| `functionView` | what a function does: definition and lines, purpose, callers, tests (with test names), stories |
| `importedBy` / `imports` | who imports a file / what it imports |
| `exports` | what a file exports |
| `exists` | whether a file exists, and where a file with that name does |
| `graph_query` | files about a subject; `kind: "doc"` only documentation; `history: true` also superseded decisions |
| `grep`, `glob`, `read_chunk` | text search, paths, and lines of a file, with the same exclusions as the graph |

## MCP Configuration (Model Context Protocol)

lady-lens can be used by AI coding assistants (Antigravity, Cursor, Claude Desktop, Claude Code, Cline, Roo Code) as a native MCP server.

Start the background service:
```bash
lens mcp -d       # starts MCP on http://127.0.0.1:4318/sse and UI on http://127.0.0.1:4317
lens stop         # stops the background services
```

### 1. HTTP / SSE Mode (Recommended)
When running `lens mcp -d`, add this to your MCP client configuration:

```json
{
  "mcpServers": {
    "lady-lens": {
      "url": "http://127.0.0.1:4318/sse"
    }
  }
}
```

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
- **Google Antigravity / Gemini CLI**: `%USERPROFILE%\.gemini\config\mcp_config.json`
- **Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor**: `Settings -> Cursor Settings -> MCP -> Add new MCP server`
- **VS Code (Cline / Roo Code)**: Settings -> MCP Servers

## Where the data lives

One Ladybug database per repository in `~/.lady-lens/repos/<id>/graph.lbdb` (`<id>` = a short hash of the repo path), and a list of every repo in `~/.lady-lens/repos.json`. Nothing is written into the repository itself.

What is indexed: `.js`, `.mjs`, `.cjs` and `.md`, minus `node_modules`, `.git`, `outputs`, `coverage`, `dist`, `build`, `bin`, `obj` and a few more. A repository describes its own in `.lady-lens.yaml` (`project.exclude_dirs`, `project.graph_extensions`).

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

## Settings & Configuration

lady-lens kan volledig worden geconfigureerd via een **`config.json`** bestand in de root van uw repository (zie [DOCUMENTATIE.md](DOCUMENTATIE.md#3-configuratie-via-configjson) voor alle opties):

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

Daarnaast kunnen instellingen worden overschreven via omgevingsvariabelen `LENS_<NAME>`: `LENS_GRAPH_DB`, `LENS_REPO_ROOT`, `LENS_SETTINGS_PATH`, `LENS_TOOL_RESULT_CHARS`, `LENS_READ_CHUNK_MAX_CHARS`, `LENS_READ_CHUNK_MAX_LINES`, `LENS_GREP_MAX_MATCHES`, `LENS_DEBUG_LOG_FILE`, `LENS_DEBUG_LEVEL`.

## As a library (NPM Package)

Alle API-poorten zijn direct beschikbaar vanuit het package:

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

// Voer incrementele synchronisatie uit
const syncResult = await createGraphSync().sync({ mode: 'incremental' });

// Vraag functie-, map- of code health details op
const fn = await functionViewTool({ symbol: 'createGraphSync' });
const health = await healthTool({ limit: 10 });
```

Specifieke subpath imports (`lady-lens/graph`, `lady-lens/search`, `lady-lens/tools`, `lady-lens/mcp`, `lady-lens/repository`) blijven ook volledig ondersteund.

## Develop

```
npm test
npm run pack            # dist/lady-lens-<version>.tgz, to install in another project
```

Not here yet: languages other than JavaScript (C# first, Story 23.11).
