# Graafschema

**Opslagschema**: versie `'2'` (`Meta.schema_version`)
**Bijgewerkt**: 2026-11-02, afgeleid uit de code. ✅ = aanwezig, 🗺️ = gepland (zie `backlog/`).
**Doel**: vastleggen wat er in de graaf staat: welke knooppunten en relaties, wie ze schrijft, en hoe ze worden opgeslagen.

---

## 1. Overzicht

Per project één ingebedde Ladybug-database. Een gerichte, getypeerde graaf met knooppunten (bestanden, documenten, besluiten, discussies) en relaties (imports, tests, aanroepen, verwijzingen). Alles wat I/O doet zit achter de graafrepository en een opslagadapter (zie `docs/architectuur.md`).

| Waar | Wat |
| :--- | :--- |
| `~/.lady-lens/repos/<id>/graph.lbdb` | database van een geregistreerd project (`id` = eerste 12 tekens van de sha1 van het pad, kleine letters) |
| `~/.lady-lens/repos.json` | register: `id`, `path`, `database`, `branch`, `lastSync`, `nodes` |
| `LENS_GRAPH_DB`, `--db <id\|pad>` | verwijst naar een andere (gedeelde) database |
| `.memory/graph/project.lbdb` | standaard als er geen register is (bibliotheekgebruik) |

Een werktree van dezelfde repo kan dezelfde database delen via `repo_add` met `db`.

---

## 2. Opslag

Eén tabelpaar, onderscheiden door `scope`:

```
Entity(id STRING PRIMARY KEY, type, kind, scope, path, name, content_hash, documentation,
       metadata_json, ast_json, created_at, updated_at, observed_at)
RELATES(FROM Entity TO Entity, relation, confidence, weight DOUBLE, created_at, updated_at)
Meta(key STRING PRIMARY KEY, value)            -- schema_version = '2'
```

- Alle kolommen met een tijd zijn tekst (ISO-datums). De DTO's die de repository teruggeeft hebben `createdAt` en `updatedAt` in milliseconden.
- `documentation` komt als `purpose` in het knooppunt; `metadata_json` wordt uitgepakt in de velden van het knooppunt. `imports`, `links` en `mentions` blijven uit de DTO (alleen `calls` komt terug).
- Een database van versie 1 (zonder `scope`) wordt bij de eerste keer openen op zijn plaats gemigreerd.
- **Adapters**: `createLadybugRepositoryStore` (standaard) en `createMemoryRepositoryStore` (tests, dezelfde rijvorm). Contract: `test/ports/graphStore.contract.test.js`.

Afgedwongen met tests: alleen `core/graph/adapters/ladybug/ladybugGraphStore.js` laadt `@ladybugdb/core`; de rest gebruikt `createGraphRepository()`, `createGraphSync()` of de contributor-haak. Imports tussen modules lopen via `index.js` (`test/moduleApi.test.js`).

---

## 3. Scopes

| Scope | Inhoud | Geschreven door | Gelezen door |
| :--- | :--- | :--- | :--- |
| `project` | `CodeFile`, `Document`, `Config`, `Decision`, Mendix-knooppunten en hun relaties | `createGraphSync()` (`lens sync`, `lens add`, `repo_sync`) | alle query-tools, `health`, dashboard |
| `session:<id>` | `Discussion` en de stubs van hun bronnen | `saveDiscussion`, `editDiscussion` | `discussion_query`, `graph_query` met `sessionId` |
| `branch:<naam>` 🗺️ | inhoud van een branch zonder uitchecken | `repo_sync({ branch })` | `branch_diff`, `branch_impact` |

Bij elke incrementele sync worden verwijderde bestanden uit `project` gehaald (`DETACH DELETE` op `scope` en `path`, relaties van die knooppunten verdwijnen mee), gewijzigde bestanden opnieuw geïndexeerd en **alle** projectrelaties opnieuw afgeleid.

---

## 4. Knooppunten

`id` gaat altijd door `normalizeNodeId` (`core/graph/model/graphIds.js`): kleine letters, `\` wordt `/`, scheidingstekens worden `-`, per `:`-segment.

| Type | `kind` | Id | Belangrijkste velden |
| :--- | :--- | :--- | :--- |
| `CodeFile` | `source`, `test`, `script` | `file:<pad>` | `path`, `name`, `purpose`, `lines`, `exports`, `symbols`, `symbolRanges`, `keywords`, `functions`, `calls`, `reads`, `contentHash`, `parseError` |
| `Config` | `config` | `file:<pad>` | `keys` (max. 60), `runs`, `references` uit `.csproj` en reference-manager XML |
| `Dependency` | `package`, `project`, `functionalblock` | `dependency:<soort>:<naam>[@versie]` | `name`, optionele `version`, `type` |
| `Document` | `doc` | `doc:<pad>` | `title`, `purpose`, `decisions`, vermeldingen, verwijzingen, `links` uit de frontmatter |
| `Decision` | `decision` | `decision:<doc-pad>#<regel>-<slug>` | `title`, `date`, `status`, `supersededBy` (uit `backlog/besluiten.md` en gelijksoortige documenten) |
| `Discussion` | `discussion` | `discussion:<key>` | `title`, `topic`, `body`, `responses[]`, `sources[]`, `date` |
| `MendixProject`, `MendixModule`, `MendixElement` | per element | `mendix:project:<pad>`, `mendix:module:<naam>`, `mendix:<soort>:<qualified name>` | `metadata.language = 'mendix'`, `qualifiedName`, `elementType` |
| `Concept` | – | `con:<key>` | `title`; hoort bij het in-geheugen graafmodel (`createGraph`) en `graphSemantic`, niet door de sync geschreven |
| `CodeChunk` | `function` | `chunk:<pad>#<symbool>` | `startLine`, `endLine`; fabriek `createChunkNode` bestaat, de sync schrijft ze nu niet (`read_chunk` accepteert wel een chunk-id) |

`functions[]` per `CodeFile`: `{ name, loc: [van, tot], lines, params, cyclomaticComplexity, issues[] }`. `issues` wordt bij de sync vastgelegd met de drempels `LENS_MAX_CYCLOMATIC_COMPLEXITY` (15), `LENS_MAX_FUNCTION_LINES` (60) en `LENS_MAX_FUNCTION_PARAMS` (5); zie `backlog/if-ketens-afdwingen.md` voor de voorgestelde wijziging.

Een `CodeFile`-id geldt voor het pad in de projectscope. Bij het opslaan van een discussie krijgt elke bron een stubknooppunt met **hetzelfde id** (`file:<pad>`) in de sessiescope; dat verband bepaalt wat er na een sync met discussiekoppelingen gebeurt (zie 6).

---

## 5. Relaties

Relaties staan in `RELATES(relation, confidence, weight)`. `confidence` is `EXTRACTED` (uit de bron gelezen), `INFERRED` (afgeleid) of `AMBIGUOUS` (standaard als niets is opgegeven); andere waarden worden geweigerd. Een relatie is uniek per (van, naar, type) en wijst niet naar zichzelf.

| Relatie | Van → naar | Confidence | Gewicht | Afgeleid uit |
| :--- | :--- | :--- | :--- | :--- |
| `IMPORTS` | `CodeFile` → `CodeFile` | `EXTRACTED` | 1 | imports in de code |
| `TESTS` | testbestand → `CodeFile` | `EXTRACTED` | 1 | imports van een testbestand |
| `CALLS` | `CodeFile` → `CodeFile` | `EXTRACTED` | aantal aanroepplaatsen | aanroepen over bestanden heen |
| `READS` | `CodeFile` → `Config` | `INFERRED` | 1 | code die een configbestand bij naam noemt |
| `RUNS` | `Config` → `CodeFile` | `EXTRACTED` | 1 | configbestand dat een script uitvoert (bijv. `package.json`) |
| `PROJECT_REFERENCE` | `Config` → `Config` | `EXTRACTED` | 1 | lokale `<ProjectReference>` in een `.csproj` |
| `DEPENDS_ON` | `Config` → `Dependency` | `EXTRACTED` | 1 | `<PackageReference>` of `<functionalblock>` in reference-manager XML |
| `REFERENCES` | `Document` → `Document`/`CodeFile` | `EXTRACTED` | aantal verwijzingen | markdownlinks en paden tussen backticks |
| `MENTIONS` | `Document` → `CodeFile` | `EXTRACTED` of `INFERRED` | 1 | pad of functienaam in een document (functienaam alleen bij ten hoogste 3 bestanden die hem declareren) |
| *(vrije naam)* | `Document` → `Document` | `EXTRACTED` | `weight` uit de link | frontmatter `links:` (gaan voor op `REFERENCES`) |
| `CO_CHANGES` | `CodeFile` ↔ `CodeFile` | `INFERRED` | aantal gezamenlijke commits | `git log` (laatste 1000 commits, minstens 3 samen, geen bulkcommits, per bestand de 5 sterkste) |
| `SUPERSEDES` | `Decision` → `Decision` | – | – | volgorde van besluiten in een document |
| `DISCUSSES` | `Discussion` → bron | `EXTRACTED`/`INFERRED` | uit `relevance`, standaard 0.5 | bronnen die bij de discussie horen |
| `DISCUSSED_IN` | bron → `Discussion` | idem | idem | de omgekeerde richting van `DISCUSSES` |
| `CONTAINS` | Mendix-project/module → element | – | – | structuur van een Mendix-project |

Gewichten zijn dus niet genormaliseerd naar 0 tot 1: `CALLS`, `REFERENCES` en `CO_CHANGES` zijn aantallen.

Geplande relaties 🗺️ (zie `backlog/branch-bewuste-graaf.md`): `Branch -HEAD_AT-> Commit`, `Discussion -CREATED_AT-> Commit`, `Discussion -ON_BRANCH-> Branch`.

---

## 6. Discussies en de projectscope

Een discussie staat in de sessiescope en blijft bestaan als bestanden uit de projectscope verdwijnen. De relaties naar die bestanden gaan wel mee, omdat de stub en het projectknooppunt hetzelfde id hebben en `DETACH DELETE` alle relaties van het knooppunt verwijdert. Komt het bestand terug (bijvoorbeeld na een branch-wissel), dan wordt het knooppunt opnieuw gemaakt maar worden de relaties niet hersteld. Dit is uit de code afgeleid en nog niet met een test bevestigd; de oplossing (`relinkDiscussions`) staat in het backlog-item.

---

## 7. Vragen stellen

Tools lezen de graaf via de repository, niet rechtstreeks. Voor graafvragen:

| Tool | Vraag |
| :--- | :--- |
| `graph_query` | knooppunt of tekst als startpunt (`node`, `query`), `outgoing`/`incoming` met een type of `true`, `path` (pijl-gescheiden relatietypen), `maxDepth`, `limit`, `kind: 'doc'`, `history: true` voor vervangen besluiten |
| `definedIn`, `exists`, `exports`, `imports`, `importedBy` | bestanden en symbolen uit de importgraaf |
| `functionView`, `folderView` | definitie, aanroepers, tests, verhalen; opbouw van een map |
| `health` | zonder test, cycli, grote en complexe functies, hotspots (churn × grootte) |
| `searchView`, `grep`, `glob`, `read_chunk` | tekst, bestanden en regelbereiken |
| `discussion_build`, `_save`, `_edit`, `_load`, `_query` | discussies als knooppunten |

---

## 8. Regels

- Elk knooppunt-id gaat door `normalizeNodeId`; `validateGraph` controleert dat.
- Relaties verwijzen naar bestaande knooppunten; wijst een relatie naar een ontbrekend knooppunt, dan wordt hij bij het schrijven overgeslagen (Ladybug `MATCH`).
- Geen self-loops, geen dubbele (van, naar, type).
- Alle relaties worden vóór het eerste schrijven gevalideerd, zodat een foute relatie geen half vervangen scope achterlaat.
- Geen runtime-code leest of schrijft een graaf-JSON-bestand.
- De database wordt per opdracht geopend en gesloten (geen vergrendeling tussen opdrachten).

---

## 9. Geschiedenis

- **1.0** (2026-10-01): eerste schema met zes knooppunttypen en een JSON-bestand per sessie.
- **2.0**: opslag in Ladybug met `scope`; JSON-bestanden zijn verdwenen.
- **2.1** (2026-11-02): document opnieuw geschreven vanuit de code van lady-lens; Kura-termen (`/govern`, `/plan`, `persistSessionGraph`, `KURA_GRAPH_DB`) en niet-bestaande types (`Module`, `Feature`, `Task`) zijn verwijderd.
