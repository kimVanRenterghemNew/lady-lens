# lady-lens Documentatie

Uitgebreide gids voor architectuur, API-poorten, MCP-integratie, npm package gebruik en configuratie via `config.json`.

---

## 1. Architectuuroverzicht & Filosofie

`lady-lens` is een snelle, lokale code-graaf en semantische analyse-engine gebouwd op [LadybugDB](https://www.npmjs.com/package/@ladybugdb/core). Het indexeert broncode, documentatie, besluiten en afhankelijkheden in een gerichte graaf. Hierdoor kunnen AI coding agents en ontwikkelaars direct exacte feiten over de codebase opvragen (zoals definities, import-ketens, callers, test reach, code health en architecture metrics) zonder dat er dure LLM-tokens aan context verloren gaan.

De codebase is opgebouwd volgens een strikte **hexagonale architectuur (Ports & Adapters)**:
- **Core Domain / Model**: Grafen, nodes (bestanden, functies, documenten, besluiten) en edges (`IMPORTS`, `CALLS`, `TESTS`, `READS`, `CO_CHANGES`).
- **Storage Port (`GraphStorePort`)**: Uitwisselbare opslagadapters (in-memory voor snelle tests, LadybugDB voor persistente indexering).
- **Sync & Extraction Port**: Incrementele parsing en AST-extractie voor JavaScript/TypeScript en C#.
- **Query & View Ports**: `functionView`, `folderView`, `codeHealth`, `rankGraphNodes`, `impact`.
- **Primary Adapters**: Zowel toegankelijk via het **npm package** als via de **MCP Server (Model Context Protocol)** en de **CLI (`lens`)**.

---

## 2. API-Poorten: Toegang via MCP en NPM Package

Alle functionaliteiten van `lady-lens` zijn ontworpen als **first-class API-poorten**. Elke poort is zowel programmatisch via het npm package (`lady-lens`) als interactief via het Model Context Protocol (MCP) beschikbaar.

### Overzicht van alle Poorten

| Poort / Domein | MCP Tool Naam | NPM Package Export (`lady-lens`) | Beschrijving |
| :--- | :--- | :--- | :--- |
| **Functie Analyse** | `functionView` | `functionView(graph, symbol)` / `functionViewTool(args)` | Geeft de definitie, regelnummers, docstring/purpose, alle aanroepende bestanden (`callers`), gekoppelde tests en gerefereerde backlog stories van een functie. |
| **Map & Module Analyse** | `folderView` | `folderView(graph, folder)` / `folderViewTool(args)` | Analyseert de structuur van een map: onderliggende onderdelen, interne datastroom, wie de map van buitenaf aanroept en potentiële afwijkingen (cycli, ongeteste bestanden). |
| **Code Health & Metrics** | `health` | `codeHealth(graph, opts)` / `healthTool(args)` | Berekent NDepend-achtige statistieken: testbereik (inclusief index.js barrels), cyclische afhankelijkheden, grens-overtredingen, hotspots (churn x regels), coupling (Ca, Ce, Instability) en zone of pain. |
| **Symbool Locatie** | `definedIn` | `definedIn(graph, symbol)` / `definedInTool(args)` | Waar is een identifier gedefinieerd of geëxporteerd? Retourneert het bestandspad en de exacte start/eindregels. |
| **Imports Zoeken** | `imports` | `importsOf(graph, file)` / `imports(args)` | Welke bestanden en modules worden direct geïmporteerd door een opgegeven bestand. |
| **Afhankelijkheden** | `importedBy` | `importersOf(graph, file)` / `importedBy(args)` | Welke bestanden importeren het opgegeven bestand (fan-in analyse). |
| **Exports Inspectie** | `exports` | `exportsOf(graph, file)` / `exportsTool(args)` | Volledige gesorteerde lijst van geëxporteerde functies, variabelen en types uit een bestand. |
| **Bestandsverificatie** | `exists` | `fileLookup(graph, file)` / `fileExists(args)` | Controleert of een bestand in de projectgraaf bestaat; geeft suggesties bij typefouten of verplaatste mappen. |
| **Graaf Zoeken** | `graph_query` | `graph_query(args)` / `rankGraphNodes(graph, query)` | Semantisch en trefwoord-gebaseerd zoeken door de graaf op basis van relevantiescore, IDF-weging en relaties. |
| **Interactiviteit** | `searchView` | `searchView(args)` | Geavanceerd zoeken met regex, hoofdlettergevoeligheid, filtering op bestandstype (code, doc, test) en padglobs. |
| **Tekst & Regex** | `grep` | `grep(args)` | Snelle regex-zoekopdracht door code, rekening houdend met `.gitignore` en project-exclusies. |
| **Pad Matching** | `glob` | `glob(args)` | Vindt repository-paden op basis van glob-patronen (bijv. `core/**/*.js`). |
| **AST Chunk Lezer** | `read_chunk` | `read_chunk(args)` | Leest een specifiek AST-chunk (klasse/functie) of een bereik regels. Grote bestanden leveren een compacte samenvatting op. |
| **Besluiten & Discussies** | `discussion_save`, `discussion_query`, etc. | `saveDiscussion`, `loadDiscussions`, `queryDiscussions` | Beheert architectuurbesluiten en discussies met frontmatter-koppelingen naar code-nodes. |
| **Multi-Repo Beheer** | `repo_list`, `repo_add`, `repo_remove`, `repo_sync` | `registerRepo`, `unregisterRepo`, `listRegisteredRepos` | Beheert meerdere projecten in de centrale Ladybug-database registry. |
| **Graaf Synchronisatie** | `repo_sync` | `createGraphSync(options).sync()` | Scant het project incrementeel (op basis van bestandshash/mtime) of volledig (`mode: 'full'`). |

---

## 3. Configuratie via `config.json`

Alle instellingen van `lady-lens` kunnen worden geconfigureerd via een centraal **`config.json`** bestand in de hoofdmap van het project.

### Automatische Detectie
`lady-lens` controleert automatisch op configuratiebestanden in de volgende volgorde:
1. Bestand opgegeven via `--config <pad>` of de omgevingsvariabele `LENS_SETTINGS_PATH`.
2. `config.json` (aanbevolen standaard)
3. `lens.config.json`
4. `.lady-lens.json`
5. `.lady-lens.yaml`

### Volledig Voorbeeld van `config.json`

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
      "enabled": true
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

### Configuratie-secties Uitgelegd

1. **`project`**:
   - `graph_roots`: Mappen die geïndexeerd moeten worden (standaard `["."]`).
   - `exclude_dirs`: Mappen die genegeerd worden tijdens sync, glob en grep.
   - `graph_extensions`: Bestandsextensies die meegenomen worden in de code-graaf.
2. **`graph`**:
   - `ast.enabled`: Genereer AST-chunks en symbooldefinities.
   - `documentation.enabled`: Indexeer markdown documenten en koppel frontmatter.
   - `links.enabled`: Automatisch koppelen van import- en call-relaties.
   - `freshness.default_max_age_days`: Maximale leeftijd voor automatische re-indexering.
3. **`mcp`**:
   - `port`: HTTP/SSE poort voor de MCP server (standaard `4318`).
   - `uiPort`: Web UI dashboard poort (standaard `4317`).
4. **`database`**:
   - Pad naar het LadybugDB databasebestand. Als dit niet is ingesteld, gebruikt lens `~/.lady-lens/repos/<id>/graph.lbdb`.
5. **`env`**:
   - Directe toewijzing van lens omgevingsvariabelen (zoals `TOOL_RESULT_CHARS`, `DEBUG_LEVEL`, etc.).

---

## 4. Gebruik als NPM Package

Installeer de package lokaal of als dependency:

```bash
npm install lady-lens
```

### Directe Imports (Hoofdingang)

Alle poorten zijn direct beschikbaar vanuit de root export:

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

// 1. Instellingen inlezen (leest automatisch config.json)
const settings = loadProjectSettingsSync();

// 2. Incrementele sync van de repository
const syncResult = await createGraphSync().sync({ mode: 'incremental' });
console.log(`Graaf gesynchroniseerd: ${syncResult.nodes} nodes`);

// 3. Functie view opvragen
const fnDetails = await functionViewTool({ symbol: 'createGraphSync' });
console.log('Callers van createGraphSync:', fnDetails.callers);

// 4. Code health inspecteren
const health = await healthTool({ limit: 5 });
console.log('Top hotspots:', health.hotspots);

// 5. Semantische graaf query
const queryResult = await graph_query({ query: 'database storage' });
console.log('Gevonden nodes:', queryResult.nodes);
```

### Modulaire Subpath Imports

Voor gespecialiseerde scenario's zijn ook specifieke subpath imports beschikbaar:

```javascript
import { createGraph, createGraphRepository } from 'lady-lens/graph';
import { RESEARCH_TOOLS, grep, glob } from 'lady-lens/search';
import { createLadyLensMcpServer, createMcpHttpServer } from 'lady-lens/mcp';
import { listRegisteredRepos, registerRepo } from 'lady-lens/repository';
import { createProfiler, globalProfiler } from 'lady-lens/observability';
```

---

## 5. Gebruik als MCP Server

Start de achtergrondservice met de CLI:

```bash
lens mcp -d
```

Dit start:
- De **MCP SSE Server** op `http://127.0.0.1:4318/sse`
- Het **UI Dashboard** op `http://127.0.0.1:4317`

### AI Assistent Configuratie

Voeg de server toe aan uw MCP-configuratiebestand (bijvoorbeeld in Antigravity, Claude Desktop, Cursor of VS Code):

#### HTTP/SSE Mode (Aanbevolen)
```json
{
  "mcpServers": {
    "lady-lens": {
      "url": "http://127.0.0.1:4318/sse"
    }
  }
}
```

#### Directe Stdio Mode
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

## 6. CLI Command Referentie

De command line interface `lens` biedt directe toegang tot alle functionaliteiten:

| Commando | Beschrijving |
| :--- | :--- |
| `lens sync [--repo <dir>] [--full]` | Synchroniseer de graaf voor het huidige project of een doelmap. |
| `lens ask <tool> '<json>'` | Roep direct een van de research tools aan (bijv. `lens ask functionView '{"symbol":"createProfiler"}'`). |
| `lens mcp [-d]` | Start de MCP server (optioneel op de achtergrond met `-d`). |
| `lens stop` | Beëindig de achtergronddaemon en vrijgave van poorten/locks. |
| `lens ui [--port 4317]` | Start de interactieve graaf-visualisatie in de browser. |
| `lens list` | Overzicht van alle geregistreerde repositories en hun databasepaden. |
| `lens add <dir>` | Registreer een nieuw project en voer direct de eerste sync uit. |
| `lens remove <id\|dir>` | Verwijder een repository uit de registry. |
| `lens tools` | Toont alle beschikbare tools met hun schema's en parameters. |
