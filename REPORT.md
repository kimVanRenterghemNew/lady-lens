# lady-lens Status- en Gezondheidsrapport

**Datum**: 30 oktober 2026  
**Locatie**: `C:\git\lady-lens`  
**Geverifieerd tegen**: Node.js v24.20.0 / Windows 11  
**Doel**: Overzicht van de architectuur, stabiliteit, testresultaten, MCP-integraties en operationele procedures.

---

## 1. Samenvatting & Huidige Status

`lady-lens` draait stabiel als lokale code graph engine en MCP-server voor AI coding agents (Kura, Antigravity, Claude Code, Cursor).

* **MCP Status**: Actief op `http://127.0.0.1:4318/` (PID: 49696)
* **MCP SSE Endpoint**: `http://127.0.0.1:4318/sse`
* **UI Dashboard**: `http://127.0.0.1:4317/`
* **Geïndexeerde repository**: `C:\git\kura-secrets` (12.417 nodes, incrementele sync in 1,5s)
* **Beschikbare MCP Tools**: 18 actieve tools

---

## 2. Testresultaten & Codekwaliteit

### 2.1 Testsuite (Vitest)
Alle tests zijn integraal uitgevoerd en slagen:
* **Testbestanden**: 62 / 62 geslaagd (100%)
* **Tests**: 356 / 356 geslaagd (100%)
* **Totale runtime**: ~16,2 seconden
* **Dekking**: Contract-tests voor GraphStore (`test/ports/graphStore.contract.test.js`), Ladybug persistentie, property tests voor round-trips, co-change Git geschiedenis, en live MCP HTTP/SSE tests.

### 2.2 ESLint & Statische Analyse
* `eslint .` is 100% schoon (0 errors, 0 warnings).
* Een ongebruikte `body`-variabele in `core/discussions/storage/discussionStore.js` (`editDiscussion`) is opgeruimd.

---

## 3. Analyse: npm link vs npm install -g . op Windows

### 3.1 Waarom `npm link` problemen gaf:
1. **Windows Native File Locks (`.node`)**:  
   `@ladybugdb/core` gebruikt een native C++ binary binding. Op Windows vergrendelt het OS ingeladen DLL/.node-bestanden in actieve Node-processen exclusief. `npm link` creëert NTFS-junctions/symlinks; zodra de daemon of een client draaide, faalden bewerkingen met `EBUSY` of `EPERM`.
2. **Ladybug Buffer Pool Allocatie**:  
   Bij grote repositories liep de buffer manager van `@ladybugdb/core` eerder vast op grote batches (5000 nodes). Dit is structureel verholpen door de buffer pool op 1 GB te zetten en batchgroottes op 1000 te begrenzen.
3. **In-memory Modules & Tool Cache**:  
   Node.js herlaadt modules niet in een actief proces. Een MCP-client haalt `tools/list` bovendien eenmalig op bij het starten van de sessie. Zonder herstart van de daemon merkt een client niets van nieuwe tools (zoals `discussion_*`).

### 3.2 Aanbevolen Rolling Update Procedure
De ingebouwde daemon-beheerder maakt veilige updates mogelijk:
```bash
# 1. Stop de actieve daemon (geeft locks op graph.lbdb en .node vrij)
lens stop

# 2. Installeer de gewijzigde versie globaal
npm install -g .

# 3. Start de daemon opnieuw met de doelrepository
lens mcp -d --repo C:/git/kura-secrets
```

---

## 4. Beschikbare MCP Tools (18)

| Categorie | Tool | Omschrijving |
|---|---|---|
| **Discussions** | `discussion_save` | Slaat een AI-overleg op als Discussion-node in de graaf, gekoppeld aan code/docs/besluiten. |
| | `discussion_edit` | Vult een bestaande discussie aan met nieuwe antwoorden of bronnen. |
| | `discussion_load` | Laadt opgeslagen discussies per sessie of id. |
| | `discussion_query` | Zoekt discussies gerelateerd aan een bestand, besluit, symbool of trefwoord. |
| | `discussion_build` | Bouwt een discussie-record met frontmatter zonder direct op te slaan. |
| **Inspectie & Navigatie** | `functionView` | Toont wat een functie doet, wie haar aanroept, welke tests haar raken en welke stories haar noemen. |
| | `folderView` | Geeft de opbouw van een map, rollen van subbestanden en in-/uitgaande koppelingen. |
| | `definedIn` | Vindt het bestand waarin een symbool of functie gedefinieerd is. |
| | `exists` | Controleert of een bestand bestaat (en waar eventuele naamgenoten staan). |
| | `exports` | Geeft alle geëxporteerde symbolen van een bestand. |
| | `imports` / `importedBy` | Volledige in- en uitgaande importrelaties van een module. |
| **Gezondheid & Zoeken** | `health` | Toont code health: onbereikte bestanden, import-cycli, hotspots en grote bestanden. |
| | `graph_query` | Semantische/tekstuele query door code, docs en beslissingen. |
| | `grep` / `glob` / `read_chunk` | Scoped zoeken en chunks lezen met dezelfde uitsluitingen als de graaf. |
| **Repo Beheer** | `repo_list` / `repo_add` / `repo_remove` / `repo_sync` | Beheer van geregistreerde repositories en handmatige synchronisatie. |

---

## 5. Aanbevelingen voor Agents & Kura

1. **Configuratie in agents**:
   Gebruik de SSE transport-koppeling in `mcp_config.json`:
   ```json
   {
     "mcpServers": {
       "lady-lens": {
         "url": "http://127.0.0.1:4318/sse"
       }
     }
   }
   ```
2. **Contextminimalisatie**:
   Agents kunnen `folderView` en `functionView` gebruiken in plaats van hele bestanden in de prompt te laden; dit bespaart tokens en levert direct gerichte context op (inclusief gerelateerde tests en stories).
