# Werkafspraken lady-lens

> Hoe lady-lens wordt gebouwd: waarden, testaanpak en werkwijze. Afgeleid van de afspraken van Kura, aangepast aan wat lady-lens heeft. ✅ = afgedwongen of aanwezig, 🗺️ = afgesproken, nog niet gebouwd (zie `backlog/`).

---

## 1. Uitgangspunten

### Elke stap maakt een merkbaar verschil
Na elke wijziging verandert er iets wat je kunt laten zien met `lens`, het dashboard of een MCP-tool: een nieuw commando (`lens ps`), een antwoord dat anders is (`health` toont een geur), een project dat nu ook werkt (`/mcp?repo=…`). Een stap is pas af als er zo'n verschil is en we er een nieuwe controle op kunnen baseren. Kleine stappen zijn goed.

### Gedrag eerst (BDD)
Elke wijziging heeft een toetsbaar doel dat bewijst dat het gedrag werkt.

```
❌ SLECHT: "Voeg een git-module toe"
✅ GOED:   "Een discussie blijft gekoppeld aan een bestand na een wissel naar een branch zonder dat bestand en terug"
```

### Test eerst (TDD)
1. Schrijf het **toetsbare doel** (wat moet waar zijn?).
2. Schrijf de **acceptatiecriteria** (hoe controleren we dat?).
3. Schrijf de **tests** (en zie ze falen).
4. Schrijf de **implementatie** (tests slagen).
5. **Verifieer** in een echt scenario (zie 3).

### Sturen op antwoordkwaliteit: eerst evals
Als de *kwaliteit* van wat lens teruggeeft moet verbeteren (rangschikking, antwoorden van `graph_query`, wat `health` meldt) en het geen codefout is, dan is de volgorde altijd: **eval → wijziging → meten**. Zonder een falend voorbeeld in `evals/graph-gold.json` is bijsturen gokken. Een wijziging die de eval (`npm run eval:graph`) laat zakken, wordt niet geaccepteerd.

---

## 2. Werkwijze

### Stap 1: Plannen
Voor je code schrijft:
1. Kies een item uit `backlog/<naam>.md` (kopjes: Probleem, Aanpak, Acceptatiecriteria, Journey-tests, Buiten scope, Open vragen).
2. Lees het toetsbare doel en de acceptatiecriteria.
3. Bedenk het bewijs: welke test of meting laat zien dat het klopt?
4. Bepaal de demo: wat verandert er zichtbaar?
5. Beantwoord: **welke module is eigenaar van dit gedrag, wat is het kleine contract, en welke afhankelijkheden kunnen worden meegegeven voor een test?**

### Stap 2: Tests schrijven
Schrijf tests vanuit wat een gebruiker kan doen, niet vanuit interne functies.

```javascript
// ✅ GOED: beschrijft wat de gebruiker ziet
describe('Een bugfix op release raakt een feature', () => {
    it('meldt de aanroepers van de gewijzigde functie in de feature', async () => {
        // Arrange: twee branches in een fake git, f() op release gewijzigd, h() op feature roept f aan
        // Act: branch_impact({ change: 'release', against: 'feature-x' })
        // Assert: f, de commit en h (bestand en regel) staan in de risicolijst
    });
});

// ❌ SLECHT: te technisch
describe('diffNameStatus', () => {
    it('geeft een array van strings terug', () => { /* ... */ });
});
```

Tests kijken niet naar functienamen, bestandsindeling of opslagvorm; alleen naar wat de gebruiker ziet. Een uitzondering zijn de tests van interne onderdelen (`*.internal.test.js`): die mogen modules binnenin importeren.

### Stap 3: Implementeren
Alleen na de tests:
1. Schrijf zo weinig code als nodig om de tests te laten slagen.
2. Geen vroege optimalisatie; los de test op, niet denkbeeldige behoeften.
3. De interne structuur mag veranderen zolang het gedrag gelijk blijft.

### Stap 4: Verifiëren
```bash
npm run check          # eslint + tests met dekkingsdrempels
npm run eval:graph     # kwaliteit van de antwoorden
npm run test:perf      # prestaties (bij wijzigingen aan sync of query)
```
Daarnaast een echt scenario: `lens mcp -d`, `lens ps`, een tool aanroepen via `lens ask <tool> '<json>'`, het dashboard openen op `:4317`.

### Levenscyclus van een item
```
PLAN (toetsbaar doel lezen)  →  TEST (gedrag beschrijven)  →  IMPLEMENTEER  →  VERIFIEER  →  UPDATE (backlog bijwerken)
```

---

## 3. Teststrategie

Tests beantwoorden: **wat kan de gebruiker?** Niet: hoe is het gebouwd?

| Niveau | Plaats | Doel |
| :--- | :--- | :--- |
| Gedrag | `test/*.test.js` | één gedrag, snel |
| Component | `test/component/` | meerdere onderdelen samen |
| Contract | `test/ports/` | elke adapter van een poort voert hetzelfde scenario uit (echt en geheugen) |
| Eigenschappen | `test/*.property.test.js` (fast-check) | invarianten over veel invoer |
| Journey | `test/…` 🗺️ | een heel scenario tegen een fake (git, graaf), in milliseconden |
| Prestaties | `test/performance.test.js`, `npm run bench`, `npm run eval:graph` | tijden en kwaliteit met drempels |
| Integratie | `*.integration.test.js` | trager of met een echte omgeving; niet in `npm test` (`vitest.config.js`) |

**Snelle tests.** Alles wat I/O doet zit achter een poort met een geheugen-adapter, zodat bijna elke test zonder proces of echte database draait. Echte `git` en echte Ladybug alleen in contracttests en een kleine set journeys, in eigen bestanden.

**Isolatie.** Elke worker heeft zijn eigen Ladybug-database (`test/setup/isolateGraph.js`, `LENS_PROJECT_GRAPH=0`); de echte graaf van de ontwikkelaar wordt nooit geopend.

**Dekking is een ratchet.** `vitest.config.js` heeft drempels (statements 91, branches 82, functions 91, lines 88). Verhoog ze als er code bijkomt, verlaag ze nooit om groen te worden.


---

## 4. Code

### JavaScript
- ES-modules (`import`/`export`), `async/await`, geen callbacks.
- Fouten gooien in functies, opvangen aan de rand (CLI, MCP, dashboard).
- Commentaar legt het *waarom* uit, niet het *wat*, in één korte regel.
- PowerShell op Windows: geen `&&`, gebruik `;`.

### Modulariteit en SOLID
Modulariteit is een architectuurvereiste, geen latere opruiming. Nieuw gedrag past in een duidelijke module; de CLI (`bin/lens.mjs`) blijft een dunne dispatcher.

- **Eén verantwoordelijkheid**: routering, handlers, opmaak, opslag, graafprojectie en I/O gescheiden.
- **Open voor uitbreiding**: een nieuwe tool of bewerking is een nieuw bestand in `core/mcp/handlers/` plus één regel in `TOOL_ROUTES`, geen langere `if`-keten.
- **Inwisselbaar**: een fake en de echte adapter houden zich aan hetzelfde kleine contract (contracttests).
- **Kleine interfaces**: geef `git`, `repository` of `output` mee, geen groot object dat alles mag veranderen.
- **Afhankelijkheden omkeren**: logica krijgt afhankelijkheden als parameter (zoals `createGraphSync({ repository })`), geen module-singletons, `console`, bestandspaden of `process.env` waar het kan.
- **Samenstellen in plaats van laten groeien**: wordt een bestand verantwoordelijk voor meerdere dingen, splits het vóór de volgende functie.

### Modules: een map is een module, `index.js` is zijn API
- Een map is een module; zijn `index.js` exporteert alleen wat andere modules mogen gebruiken. ✅ `test/moduleApi.test.js`
- Code buiten een module importeert alleen zijn `index.js`, nooit een bestand erin.
- Eén doel per module; geen opruimmappen als `utils`, `helpers`, `common`, `shared`, `misc` of `lib`: noem een map naar wat hij doet.
- **Geen `class`, ook niet voor fouten.** ✅ ESLint `no-restricted-syntax`. Objecten komen uit fabrieksfuncties; fouten krijgen een code in plaats van een subklasse:

```js
export const ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND';
export const routeNotFound = (name) => Object.assign(new Error(`Unknown tool: ${name}`), { code: ROUTE_NOT_FOUND });
export const isRouteNotFound = (error) => error?.code === ROUTE_NOT_FOUND;
```

### Klein en vlak
- Elk bestand maximaal 200 regels; bestaande uitzonderingen staan in `TOO_BIG` en mogen alleen kleiner worden. ✅ `test/codeStructure.test.js`
- Geen HTML of CSS in een `.js`-bestand; markup in `.html`, stijl in `.css`. Uitzonderingen in `MARKUP_IN_JS` mogen alleen verdwijnen. ✅
- Elke functie maximaal complexiteit 5, geen `else if`-ketens, geen diepe nesting; uitzonderingen alleen met reden en alleen krimpend. 🗺️ `backlog/if-ketens-afdwingen.md`

### Markdown
- Duidelijke kopjes (`#`, `##`, `###`), codeblokken altijd met taal, lijsten consistent, relatieve links voor interne verwijzingen.

---

## 6. Commando's

**CLI**
- `lens sync [--full]`, `lens add <map>`, `lens remove <id|map>`, `lens list`
- `lens ask <tool> '<json>'`, `lens tools`
- `lens mcp [-d]`, `lens ps`, `lens stop [pid]`, `lens ui`
- `lens install [--skill]`, `lens uninstall [--skill]`, `lens v`

**npm**
- `npm test` vitest (zonder `*.integration.test.js`); `npm run test:coverage` met dekking
- `npm run lint` ESLint; `npm run check` = lint + dekking (draait ook voor `npm publish`)
- `npm run eval:graph` kwaliteit van de graafantwoorden (`evals/graph-gold.json`)
- `npm run bench` en `npm run test:perf` prestaties; `scripts/lens-scale.mjs` maakt grote testrepo's
- `npm run mcp`, `npm start` de daemon starten

**Voor een lange of echte controle**
Controleer eerst dat de wijziging echt in je werkmap staat (`git status`, `git log -1`); een controle op een oudere stand bewijst niets.

---

## 7. Kernprincipes

1. **Item eerst**: elke regel code komt voort uit een toetsbaar doel in `backlog/`.
2. **Gedrag eerst**: tests beschrijven wat de gebruiker kan, niet hoe het werkt.
3. **Tests eerst**: schrijf ze voor de code en zie ze falen.
4. **Altijd eenvoudig**: voeg complexiteit toe als een test erom vraagt.
5. **Alles verifiëren**: een item is pas klaar als `npm run check` en de eval slagen.

## Waar vind je wat

- **Architectuur** → `docs/architectuur.md`
- **Graafschema** → `docs/GRAPH_SCHEMA.md`
- **Backlog** → `backlog/<naam>.md`
- **Deze gids** → `docs/project-conventions.md`
- **Gebruik en commando's** → `README.md`, `DOCUMENTATIE.md`
- **Bestaande tests** → `test/` (zie de patronen)
