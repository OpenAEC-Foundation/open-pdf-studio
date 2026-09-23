# JavaScript-reductie — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Minder JavaScript voor hetzelfde gedrag, in acht los mergebare delen: eerst een meetlat, dan dode code weg, dan het startpakket kleiner door lui laden, dan dubbele regels samenvoegen, en pas daarna de drie reuzenfuncties (tekenen, opslaan, laden) per annotatietype uit elkaar halen — met als eindbeeld geen bestand boven ~800 regels.

**Architecture:** Er komt geen nieuwe laag bij. Elke fase gebruikt een patroon dat al in de repo staat: pure regelmodules naast de grote module (zoals `js/annotations/minimummaat.js` en `js/pdf/loader/geen-rand.js`), submappen per verantwoordelijkheid (zoals `js/annotations/rendering/` en `js/pdf/loader/`), en `node --test`-bestanden naast de module. De drie reuzenfuncties worden per annotatietype omgezet van één `switch` naar één tabel `{ type → functie }`, waarbij elke tak letterlijk naar een eigen bestand verhuist. Lui laden gebeurt met Solid's `lazy()` en `await import()`; er wordt geen bundler-configuratie voor `manualChunks` toegevoegd, omdat een dynamische import al een eigen chunk oplevert.

**Tech Stack:** SolidJS 1.9, Vite 7, pdf-lib, pdf.js, i18next, `node:test` (`node --test`) voor unittests. Geen nieuwe afhankelijkheden.

## Global Constraints

- **Alle acht fasen zijn los mergebaar.** Elke fase is één PR, met werkende software aan het eind. Een fase die halverwege stukloopt wordt teruggedraaid, niet half gemerged.
- **Geen gedragsverandering voor de gebruiker**, in geen enkele fase. Waar een fase toch iets zichtbaar verandert, staat dat expliciet in de fasekop onder "Wat verandert er voor de gebruiker". Voor fase 1 t/m 8 geldt: alleen fase 3 verandert iets waarneembaars (het eerste openen van een venster kan één frame later zijn) en dat staat daar beschreven.
- **Vóór elke commit groen**, vanuit `open-pdf-studio/`:
  - `npm run test:unit`
  - `npx vite build` — dit is de enige echte syntaxcontrole voor `js/`. `node --check` leest `js/` als CommonJS en mist ES-fouten. Nooit `| tail` op de build-uitvoer om succes te beoordelen; lees de hele uitvoer.
- **Byte-identieke uitvoer waar niets mag veranderen.** Fase 5, 6 en 7 zijn pure verplaatsingen. De opslag-rondgang (`node scripts/verify-opslag-rondgang.mjs`) en, bij render-/saver-/rotatiewijzigingen, de vergelijkings-sweep (`node scripts/verify-mupdf-compare.mjs`) horen bij die fasen verplicht gedraaid te worden. Zie `docs/release-testprotocol.md`.
- **Verificatiebestanden worden nooit overschreven.** Testuitvoer gaat naar een eigen tijdelijke map.
- **Geen namen van commerciële software** in code, comments, doc-strings, testnamen, documentatie of commit-berichten. Gebruik "externe referentie-berekening", "extern PDF-pakket", "het referentiebestand".
- **Geen AI-attributie** in commit-berichten. Geen lokale of persoonsgebonden paden in de repo-inhoud. Geen chat- of sessiegeschiedenis in de repo.
- **Engels op GitHub:** commit-berichten, PR-titels, PR-teksten, issue-opmerkingen en release-notes in het Engels. Dit plandocument en `docs/` blijven Nederlands.
- **Eén fase = één branch = één PR.** Branchnamen: `refactor/454-fase-<n>-<kort>`. Nooit `git stash`, nooit `git reset --hard`, nooit `git add -A` — voeg bestanden per pad toe.
- **Printer-, poort- en formulierscripts worden op deze machine nooit uitgevoerd.**

**Leesconventie voor de codeblokken.** Dit plan verplaatst bestaande code; het schrijft die code niet opnieuw. Waar in een codeblok `// … de regels A-B uit <bestand>, ongewijzigd …` staat, betekent dat: **knip precies dat regelbereik uit het genoemde bestand en plak het hier, letterlijk, inclusief comments.** Het is geen TODO en geen samenvatting. Herformuleren, variabelen hernoemen of regels samenvoegen tijdens het verplaatsen is in dit plan een fout: het maakt het verschil tussen "de sweep vlagt dezelfde pagina's" en "iemand moet uitzoeken waar het beeld veranderde".

---

## Gemeten uitgangspunten

Gemeten op `origin/main`, commit `53cefd2d`, 23-09-2026, in een schone worktree. `node_modules` was **niet** geïnstalleerd, dus `npx vite build` kon niet draaien: **alle chunk-groottes in dit plan zijn schattingen op basis van statische analyse van de modulegraaf, geen gemeten bytes.** Regelaantallen, bestandsaantallen en paden zijn wél exact gemeten.

### Omvang

| | Bestanden | Regels |
|---|---:|---:|
| `js/**` bron (`.js`, `.jsx`, `.ts`) | 603 | 136 482 |
| waarvan `.js` | 429 | 102 851 |
| waarvan `.jsx` | 162 | 31 525 |
| waarvan `.ts` | 12 | 2 106 |
| `js/**` tests (`*.test.mjs`) | 113 | 18 606 |

TypeScript is dus **1,5 %** van de broncode: `js/bridge.ts`, `js/core/state.ts`, `js/core/constants.ts`, de vijf bestanden in `js/core/stores/`, en de vier in `js/types/`. De rest is gewoon JavaScript. Er zijn geen `.tsx`-bestanden; alle Solid-componenten zijn `.jsx`.

### Per map

| Map | Bestanden | Regels |
|---|---:|---:|
| `js/solid` | 230 | 39 061 |
| `js/pdf` | 91 | 31 260 |
| `js/annotations` | 77 | 20 275 |
| `js/tools` | 65 | 18 142 |
| `js/ui` | 24 | 5 021 |
| `js/symbols` | 35 | 4 577 |
| `js/core` | 18 | 3 484 |
| `js/text` | 7 | 2 974 |
| `js/search` | 4 | 1 590 |
| `js/compare` | 7 | 1 332 |
| `js/bcf` | 6 | 935 |
| `js/quantities` | 6 | 721 |
| `js/plugins` | 7 | 672 |
| `js/types` | 4 | 667 |
| overige mappen | 13 | 1 883 |
| los in `js/` | 6 | 3 878 |

### De 27 bestanden boven 800 regels (samen 39 562 regels, 29 % van de bron)

| Regels | Bestand |
|---:|---|
| 3 223 | `js/annotations/rendering.js` |
| 3 197 | `js/pdf/saver.js` |
| 2 918 | `js/mcp-bridge.js` |
| 2 637 | `js/pdf/renderer.js` |
| 2 243 | `js/tools/text-edit-tool.js` |
| 1 927 | `js/solid/stores/propertiesStore.js` |
| 1 549 | `js/pdf/loader/annotation-converter.js` |
| 1 508 | `js/pdf/loader/color-extraction.js` |
| 1 387 | `js/pdf/pdf-viewport.js` |
| 1 278 | `js/annotations/transforms.js` |
| 1 235 | `js/tools/tools/measurement-tool.js` |
| 1 233 | `js/pdf/loader.js` |
| 1 213 | `js/annotations/systeemraster.js` |
| 1 190 | `js/solid/components/compare/CompareView.jsx` |
| 1 174 | `js/pdf/cad-import-logica.js` |
| 1 113 | `js/tools/tool-dispatcher.js` |
| 1 107 | `js/solid/components/ContextMenu.jsx` |
| 1 098 | `js/tools/snap-engine.js` |
| 1 003 | `js/solid/components/dialogs/PrintDialog.jsx` |
| 987 | `js/tools/keyboard-handlers.js` |
| 978 | `js/solid/components/dialogs/CadImportDialog.jsx` |
| 973 | `js/pdf/page-manager.js` |
| 928 | `js/ui/panels/left-panel.js` |
| 923 | `js/core/undo-manager.js` |
| 867 | `js/annotations/geometry.js` |
| 839 | `js/annotations/handles.js` |
| 834 | `js/pdf/saver/appearance-vectors.js` |

### De kern van het probleem: drie functies, 6 434 regels

Niet de bestandsgroottes maar drie enkele functies dragen het leeuwendeel:

| Functie | Bestand | Regels | Vorm |
|---|---|---:|---|
| `_savePDFNu` | `js/pdf/saver.js:301-3132` | 2 831 | één functie, met daarin één `switch (ann.type)` op regel 499-2859 met **42 takken** |
| `drawAnnotation` | `js/annotations/rendering.js:419-2516` | 2 098 | één functie, met daarin één `switch (annotation.type)` op regel 489-2512 met **42 takken** |
| `converteerPdfAnnotatie` | `js/pdf/loader/annotation-converter.js:41-1546` | 1 505 | één functie, met daarin `switch (annot.subtype)` op regel 120-1546 met **7 takken** |

De twee `switch`-blokken van 42 takken dekken dezelfde typenverzameling: `box, mask, highlight, polygon, cloud, textbox, callout, circle, wall, betonbalk, line, arrow, draw, polyline, splineArrow, cloudPolyline, spline, arc, measureDistance, measureAngle, measureArea, measurePerimeter, filledArea, scaleRegion, comment, count, text, systeemraster, stavenreeks, viewport, image, stamp, signature, scaleBar, scheduleTable, parametricSymbol, vectorSnippet, redaction, textHighlight, textStrikethrough, textUnderline, textSquiggly`.

Dezelfde typenverzameling komt nog vier keer terug als `switch`: `js/annotations/transforms.js:274-1000` (30 takken, 726 regels), `js/annotations/handles.js:61-107` (21 takken) en `:116-643` (39 takken, 527 regels).

### Dode code

Gemeten met een eigen importgraaf over `js/**`, `scripts/**`, `web-unit/**` en `mcp-stdio/**`, met `.js → .ts`-resolutie (TypeScript-conventie) en met de 113 `*.test.mjs`-bestanden als extra ingangen.

- **Dode modules: 3 bestanden, 97 regels.** `js/pdf/page-manager-test-hooks.mjs` (58), `js/types/global.d.ts` (21), `js/quantities/label-i18n.js` (18). Meer niet — het bestandsniveau is opvallend schoon.
- **Dode exports: 133 symbolen, 951 regels, verspreid over 74 bestanden.** Dit zijn top-level `export function` / `export const` die nergens in de repo als identifier voorkomen, ook niet in het eigen bestand en ook niet in een test. De zwaarste: `js/pdf/pdf-viewport.js` (6 exports, 116 regels, waaronder `clampAndCenterUnused_keptForReference` van 86 regels), `js/tools/text-edit-tool.js::createReplaceTextEdit` (83), `js/compare/overlay-renderer.js` (4 exports, 61), `js/annotations/redaction.js::applyAllRedactions` (45), `js/annotations/smart-guides.js::findAlignmentGuides` (45), `js/annotations/rendering/selection.js` (2 exports, 41).
- **Overbodige `export`-sleutelwoorden: 173 symbolen, ~3 400 regels.** Deze functies wórden binnen hun eigen bestand gebruikt, maar nergens daarbuiten. Ze leveren geen regelwinst op, wél een kleiner openbaar oppervlak en betere tree-shaking.
- **No-op-stubs die nog worden aangeroepen:** `updateAllStatus()` is 12 keer aangeroepen en is een lege functie (`js/ui/chrome/status-bar.js:25`). Idem `updateStatusTool` (1 aanroep), `updateStatusAnnotations` (1), `initMenus` (1). `js/ui/panels/properties-panel.js:91-94` bevat vier lege exports met nul aanroepen.

### Dubbele code

Exacte-kloondetectie (genormaliseerd, venster van 12 betekenisvolle regels) vindt weinig: 66 kloongroepen over meerdere bestanden. Grote kopieer-plak-blokken zijn er dus niet. De duplicatie zit in **kleine helpers die tientallen keren zijn overgeschreven**:

| Groep | Kopieën | Canonieke plek | Winst |
|---|---:|---|---:|
| `redraw()`-wrapper (`viewMode === 'continuous' ? redrawContinuous() : redrawAnnotations()`) | 29 benoemde wrappers + ~25 inline | nieuw in `js/annotations/rendering/ui-state.js` | ~150 |
| omhullende uit punten (`minX = Infinity`-lus en `Math.min(...xs)`-vorm) | 18 + 12 | `js/annotations/spatial-index.js::boundsFromPoints` | ~100 |
| `getAnnotationBounds` naast `annotationBounds` | 2 per-type-`switch`es van 125 en 140 regels | `js/annotations/spatial-index.js` | ~80 |
| micro-helpers in `js/symbols/templates/**` (`_schaalOf` 6×, `_snapPoints` 5×, `num`/`getal` 6×) | 17 | nieuw `js/symbols/templates/gedeeld.js` | ~70 |
| id-generatie (`Date.now().toString(36) + Math.random().toString(36).slice(2,…)`) | 13 benoemd + ~25 inline, met 4 verschillende lengtes | `js/utils/helpers.js` | ~60 |
| kleine bestands-/UI-helpers (`formatDate`, `formatFileSize`, `getPdfBaseName`, `getSnapSide`) | 14 | `js/utils/helpers.js` | ~60 |
| punt roteren om een middelpunt | 5 | `js/utils/math.js` | ~35 |
| rechthoek normaliseren en doorsnijden | 9, in 4 coördinaatconventies | `js/annotations/minimummaat.js` | ~35 |
| punt-in-veelhoek | 4 | `js/annotations/geometry.js::pointInPolygon` (nu privé) | ~30 |
| hex → kleurarray | 4 (`hexToColorArray`, `hexToRgb`, `hexToRgbArr`, `hexToRgbObj`), plus 2× `darken()` | `js/utils/colors.js` | ~30 |
| hoeknormalisatie `((x % 360) + 360) % 360` | 32 | `js/utils/math.js` | ~25 |
| aanwijzer → app-coördinaten | 2 volwaardige (`resolvePointerCoords`, `pointerToAppCoords`) + de primitieve | `js/tools/tool-context.js` | ~25 |
| afstand punt → lijnstuk | 5 | `js/utils/math.js::distanceToLine` | ~20 |
| lijnsnijpunt | 4 | `js/annotations/geometry.js::lineLineIntersection` | ~20 |
| HTML-/XML-ontsnapping | 5 + 4 inline | `js/bcf/bcf-xml.js::escapeXml` | ~20 |
| kleurarray → hex | 4 | `js/utils/colors.js::colorArrayToHex` | ~15 |
| diepe kopie (`JSON.parse(JSON.stringify(…))`) | 2 benoemd + 16 inline | `js/annotations/factory.js::cloneAnnotation` | ~15 |
| `clamp(v, lo, hi)` — drie byte-identieke definities | 3 | `js/utils/math.js` | ~10 |
| "geen vulling / doorzichtig"-test langs `fill-utils.js` heen | 6 | `js/annotations/fill-utils.js` | ~10 |
| veelhoekoppervlak (schoenveter) | 3 | `js/annotations/vlak-ringen.js::ringOppervlak` | ~10 |
| `approxTextWidth` — drie byte-identieke exports | 3 | `js/annotations/tekstmaat.js` (nieuw) | ~10 |

Samen ongeveer **820 regels**. Drie voorbeelden ter illustratie van hoe letterlijk de duplicatie is:

```js
// js/annotations/betonbalk.js:94, js/annotations/stavenreeks.js:150,
// js/annotations/systeemraster.js:292 — drie keer byte-identiek
function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
```

```js
// js/annotations/betonbalk.js:166, js/annotations/stavenreeks.js:415,
// js/annotations/systeemraster.js:440 — drie keer byte-identiek
export function approxTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.55;
}
```

```js
// js/pdf/saver/utils.js:7 heet hexToRgb, js/utils/colors.js:4 heet
// hexToColorArray. js/pdf/saver.js importeert ze ALLEBEI: 41 aanroepen van
// de ene, 9 van de andere, in hetzelfde bestand, met dezelfde regex.
const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
```

### Bundel

`open-pdf-studio/vite.config.js` bevat **geen `manualChunks`** en geen `splitVendorChunkPlugin`. Het `output`-blok hernoemt alleen bestanden zodat de pdf.js-worker als `.js` wordt weggeschreven. Wat opvalt: `chunkSizeWarningLimit: 6000` — twaalf keer de Vite-standaard van 500 kB. De waarschuwing is weggezet in plaats van gesplitst.

De statische modulegraaf vanaf `js/main.js` telt **519 modules / 122 137 regels**. Slechts 73 van de 591 `js/**`-modules vallen erbuiten. Er staan wel 621 `await import()`-plekken in de code, maar de overgrote meerderheid daarvan is een **cyclusbreker, geen splitsing**: de doelen (`state.js` 38×, `manager.js` 38×, `renderer.js` 35×, `tabs.js` 23×) zijn allemaal óók statisch bereikbaar, en Rollup voegt een module bij de statische chunk zodra dat het geval is.

Wat wél al goed staat en met rust gelaten moet worden:

- **Taalbestanden.** `js/i18n/config.js:9` gebruikt `import.meta.glob('./locales/*/*.json')` **zonder `eager`**, over een boom van 4,7 MB en 39 talen. Alleen Engels en de actieve taal worden opgehaald. Niets aan doen.
- **`@pdf-lib/fontkit`.** Eén importplek in de hele repo, en die is al lui: `js/pdf/saver/ocr-text-layer.js:69`. Alleen `embedOcrFont()` gebruikt hem, alleen bij het opslaan van een OCR-tekstlaag. Watermerken gebruiken `StandardFonts` uit pdf-lib. Niets aan doen.
- **`mupdf`.** Eén importplek, al lui: `js/pdf/mupdf-renderer.js:14`.
- **BCF.** Volledig lui, via `ExportPanel.jsx:29` en `ImportPanel.jsx:22`.
- **OCR-motor.** `js/pdf/ocr.js` is al lui, via `OcrLanguageDialog.jsx:29`.

Wat in de hoofdchunk zit terwijl de gebruiker het misschien nooit opent:

| Gebied | Bestanden | Regels in de hoofdchunk |
|---|---:|---:|
| vensters `js/solid/components/dialogs/**` | 47 | 10 547 |
| symbolencatalogus `js/symbols/**` | 33 | 4 174 |
| CAD (het statische deel: 2 vensters, voorbeeld, weergave, logica, plaatsing) | 7 | 3 518 |
| `js/mcp-bridge.js` | 1 | 2 919 |
| vergelijken (`js/compare/**` + de vergelijk-UI) | 9 | 2 752 |
| afdrukken (`js/pdf/print-*` + de printvensters) | 10 | 2 680 |
| handtekeningen | 6 | 912 |

Samen ongeveer **23 000 – 24 000 regels, zo'n 19 %** van de statische graaf, achter een functie die de meeste gebruikers in een sessie niet aanraken.

De snijpunten zijn opvallend dun. Deze doelen hebben elk **precies één** statische importeur:

| Doel | Enige statische importeur |
|---|---|
| `js/mcp-bridge.js` | `js/main.js:75` |
| `js/solid/components/DialogHost.jsx` | `js/solid/App.jsx:17` |
| `js/solid/components/compare/CompareView.jsx` | `js/solid/App.jsx:24` |
| `js/solid/components/dialogs/PrintDialog.jsx` | `js/solid/components/DialogHost.jsx:11` |
| `js/solid/components/dialogs/CadImportDialog.jsx` | `js/solid/components/DialogHost.jsx:45` |
| `js/solid/components/dialogs/CadExportDialog.jsx` | `js/solid/components/DialogHost.jsx:44` |
| `js/pdf/print-job.js` | `js/solid/components/dialogs/PrintDialog.jsx:9` |

`js/solid/components/DialogHost.jsx` is 127 regels en is een zuivere statische verzamelstaaf: 54 importregels die een `DIALOG_MAP` vullen (regel 58-106), plus zeven altijd-gemonteerde overlays. Eén bestand houdt 10 547 regels in de hoofdchunk.

Twee blokkades die eerst weg moeten:

1. `js/ui/chrome/dialogs.js:223` doet `export { getPageSetupSettings } from '../../solid/components/dialogs/PageSetupDialog.jsx';` — een kale doorexport in een module die via `js/pdf/loader.js:2` op het documentopen-pad staat. Zolang die regel er is, splitst `PageSetupDialog` niet, ook niet als `DialogHost` op `lazy()` overgaat.
2. `js/solid/components/dialogs/CadExportDialog.jsx:15` importeert `getalTekst` uit `js/pdf/cad-import-logica.js` — één getalopmaakfunctie van tien regels (`cad-import-logica.js:317`) die 3 518 regels CAD-code de hoofdchunk in trekt.

`lazy()` uit `solid-js` wordt **nergens** in de repo gebruikt; `Suspense` evenmin. Fase 3 introduceert dat patroon.

### Legacy-laag

`js/ui/**` (24 bestanden, 5 021 regels) is de voor-Solid-laag. Een deel is inmiddels pure doorgeefluik: `js/ui/chrome/menus.js` is 6 regels, `js/ui/chrome/status-bar.js` bestaat voor 5 van de 25 regels uit lege functies, `js/ui/panels/properties-panel.js` eindigt met vier lege exports. Maar `js/ui/panels/attachments.js` (407), `links.js` (381), `bookmarks.js` (400) en `left-panel.js` (928) bevatten **echte logica** die PDF-structuren uitleest en het resultaat in de Solid-stores duwt. Die laag opheffen is een herontwerp, geen opruiming. Zie "Risico's en wat we NIET doen".

`js/bridge.ts` (285 regels) doorexporteert Solid-stores onder aliassen naar 54 bestanden. Het heeft 21 doorexports die niemand gebruikt. Die 21 gaan weg in fase 2; de brug zelf blijft.

---

## Meten

Elke fase meet vóór en na. De meetlat komt in fase 1 als `open-pdf-studio/scripts/meet-js.mjs`; tot die er is gelden de losse commando's hieronder. Alles draait vanuit `open-pdf-studio/`.

### Regels en bestanden

```bash
# totaal aantal regels in de bron (zonder tests)
find js -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" \) ! -name "*.test.*" -exec cat {} + | wc -l

# totaal aantal bronbestanden
find js -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" \) ! -name "*.test.*" | wc -l

# aantal bestanden boven 800 regels, en welke
find js -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" \) ! -name "*.test.*" \
  -exec wc -l {} + | grep -v ' total$' | awk '$1>800' | sort -rn
```

### Bundelgrootte

`npx vite build` vraagt `node_modules`. Draai dus eerst `npm ci` (nooit `npm install` in een worktree met een junction naar `node_modules` van de hoofdcheckout). Daarna:

```bash
npx vite build
# alle chunks, groot naar klein
ls -S dist/assets/*.js | while read f; do printf '%8d  %s\n' "$(stat -c%s "$f")" "$f"; done

# alleen de ingangschunk (de "hoofdchunk" uit issue #454)
ls -S dist/assets/index-*.js | head -1 | xargs stat -c%s
```

Noteer per fase drie getallen: **grootte van de ingangschunk**, **som van alle `dist/assets/*.js`**, en **aantal chunks**. De som blijft bij lui laden ongeveer gelijk; de ingangschunk hoort te dalen en het aantal chunks te stijgen. Alleen de ingangschunk telt als winst.

### Tests

```bash
npm run test:unit          # de 113 node:test-bestanden
npx vite build             # de enige echte syntaxcontrole voor js/
```

Bij fase 5, 6 en 7 daarbovenop, met de rig actief (zie `docs/release-testprotocol.md`):

```bash
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-opslag-duplicaten.mjs
node scripts/verify-mupdf-compare.mjs
node scripts/verify-tekstrotatie.mjs
```

### Vastleggen

Elke fase-PR zet de drie regels hieronder in de PR-tekst, met de echte getallen:

```
lines before/after:        136482 -> <n>   (-<d>)
files before/after:        603 -> <n>
files >800 lines:          27 -> <n>
entry chunk before/after:  <n> kB -> <n> kB
```

---

## Bestandsstructuur

Wat er per fase bij komt, verandert of verdwijnt. Nieuwe bestanden volgen het patroon dat al bestaat: een pure module naast de grote module, met een `*.test.mjs` ernaast.

### Nieuw

| Pad | Verantwoordelijkheid | Fase |
|---|---|---|
| `scripts/meet-js.mjs` | telt regels, bestanden, bestanden >800, en leest `dist/assets/` als die er is | 1 |
| `scripts/meet-js.test.mjs` | test op de tellers van `meet-js.mjs` | 1 |
| `js/core/console-ring.js` | de console-ringbuffer + `console`-patch, losgetrokken uit `mcp-bridge.js` zodat die lui kan worden | 3 |
| `js/core/console-ring.test.mjs` | test op de opnameregel en de idempotentie | 3 |
| `js/utils/math.js` (bestaat, groeit) | `clamp`, `normDeg`, `kwartslag`, `rotatePoint`, `distanceToSegment`, `projectPointOnSegment` | 4 |
| `js/utils/math.test.mjs` | tests op alle nieuwe wiskunde-helpers | 4 |
| `js/utils/helpers.js` (bestaat, groeit) | `newId(prefix, lengte)`, `formatFileSize`, `getPdfBaseName`, `escapeHtml` | 4 |
| `js/utils/helpers.test.mjs` | tests op de id- en opmaakhelpers | 4 |
| `js/utils/colors.js` (bestaat, groeit) | `rgbTripleToHex`, `darken` | 4 |
| `js/utils/colors.test.mjs` | tests op de hex-lezer en de hex-schrijver | 4 |
| `js/annotations/tekstmaat.js` | `approxTextWidth` — één plek voor de breedteschatting | 4 |
| `js/annotations/tekstmaat.test.mjs` | test op de breedteschatting | 4 |
| `js/annotations/rendering/redraw-keuze.js` | `kiesHertekening(viewMode)` — de keuzeregel achter `redrawActive`, los van het canvas | 4 |
| `js/annotations/rendering/redraw-actief.test.mjs` | test op die keuzeregel | 4 |
| `js/annotations/punt-in-veelhoek.test.mjs` | test op `pointInPolygon` zodra die geëxporteerd is | 4 |
| `js/solid/components/palet-dok.js` | `getSnapSide` — één dokzijde-bepaling voor de drie paletten | 4 |
| `js/annotations/rendering/tekenstaat.js` | `bouwTekenstaat(annotation, halftone)` — de acht waarden uit de preambule van `drawAnnotation` | 5 |
| `js/annotations/rendering/tekenstaat.test.mjs` | tests op de dekking, de randregels en de halftone-override | 5 |
| `js/annotations/rendering/tekenen-per-type.js` | de tabel `TEKENAARS` en `tekenaarVoor(type)` | 5 |
| `js/annotations/rendering/typen/*.js` | 42 bestanden, één per annotatietype, elk met één standaardexport `(ctx, annotation, staat) => void` | 5 |
| `js/pdf/saver/opslagcontext.js` | `maakOpslagcontext(velden)` en `CONTEXT_VELDEN` — de afsluiting van `_savePDFNu`, expliciet gemaakt | 6 |
| `js/pdf/saver/opslagcontext.test.mjs` | test dat de context compleet is en niets stilzwijgend aanvult | 6 |
| `scripts/opslag-vingerafdruk.mjs` | `vingerafdruk(bytes)` — SHA-256 met `/ID`, `/CreationDate` en `/ModDate` genuliseerd | 6 |
| `scripts/opslag-vingerafdruk.test.mjs` | test dat vluchtige velden de afdruk niet beïnvloeden | 6 |
| `js/pdf/saver/opslaan-per-type.js` | de tabel `OPSLAGERS` en `opslagerVoor(type)` | 6 |
| `js/pdf/saver/typen/*.js` | 42 tabelingangen over ~30 bestanden (doorvaltakken delen één bestand), elk met één standaardexport `(annotation, opslag) => void` | 6 |
| `js/pdf/loader/laadcontext.js` | `maakLaadcontext({annot, pageNum, viewport, stampImageMap, annotColorMap})` | 7 |
| `js/pdf/loader/laadcontext.test.mjs` | test op de doorgifte en de rotatienormalisatie | 7 |
| `js/pdf/loader/laden-per-subtype.js` | de tabel `LADERS` en `laderVoor(subtype)` | 7 |
| `js/pdf/loader/subtypen/*.js` | 7 bestanden, één per PDF-subtype, elk met één standaardexport `(ctx) => object \| null` | 7 |
| `js/mcp/respond.js` | `respond(requestId, result)` en `tauriInvoke()` — wat de zes handlergroepen gemeen hebben | 8 |
| `js/mcp/handlers/*.js` | 6 bestanden waarin de handlers van `mcp-bridge.js` uiteenvallen | 8 |
| `js/pdf/renderer/*.js` | 6 bestanden waarin `renderer.js` uiteenvalt | 8 |
| `js/pdf/pagina-rotatie.test.mjs` | karakteriseringstest op de paginarotatie-afbeelding | 8 |
| `js/tools/text-edit/*.js` | 4 bestanden waarin `text-edit-tool.js` uiteenvalt | 8 |

### Wijzigt ingrijpend

| Pad | Van → naar | Fase |
|---|---|---|
| `js/solid/components/DialogHost.jsx` | 54 statische imports → 47 × `lazy()` | 3 |
| `js/main.js` | statische `import { initMcpBridge }` → `await import()` | 3 |
| `js/annotations/rendering.js` | 3 223 → ~600 regels (de `switch` van 2 023 regels verhuist) | 5 |
| `js/pdf/saver.js` | 3 197 → ~700 regels (de `switch` van 2 360 regels verhuist) | 6 |
| `js/pdf/loader/annotation-converter.js` | 1 549 → ~200 regels | 7 |
| `js/pdf/renderer.js` | 2 637 → ~120 regels (verzamelstaaf met dezelfde exports) | 8 |
| `js/mcp-bridge.js` | 2 918 → ~150 regels (de `HANDLERS`-tabel plus `initMcpBridge`) | 8 |
| `js/tools/text-edit-tool.js` | 2 243 → ~120 regels (verzamelstaaf) | 8 |

### Verdwijnt

| Pad | Reden | Fase |
|---|---|---|
| `js/pdf/page-manager-test-hooks.mjs` | 58 regels, nergens geïmporteerd | 2 |
| `js/types/global.d.ts` | 21 regels, nergens gerefereerd | 2 |
| `js/quantities/label-i18n.js` | 18 regels, nergens geïmporteerd | 2 |

---

## De acht fasen

| # | Fase | Doel (meetbaar) | Hangt af van |
|---|---|---|---|
| 1 | Meetlat | `node scripts/meet-js.mjs` geeft regels, bestanden, >800-lijst en chunkgroottes; +~150 regels gereedschap, 0 regels bron | — |
| 2 | Dode code weg | −1 050 regels, −3 bestanden; 173 overbodige `export`-sleutelwoorden weg | 1 (voor de meting) |
| 3 | Lui laden | ingangschunk −35 à −45 %; ~23 000 regels uit de hoofdchunk; aantal chunks van enkele naar ~55 | 1 |
| 4 | Dubbele helpers | −800 regels; 20 helper-families terug naar één plek | 1 |
| 5 | Tekenen per type | `rendering.js` 3 223 → ~600 regels | 4 |
| 6 | Opslaan per type | `saver.js` 3 197 → ~700 regels | 4 |
| 7 | Laden per subtype | `annotation-converter.js` 1 549 → ~200 regels | 4 |
| 8 | Overige reuzen | 0 bestanden boven 800 regels | 3, 5, 6, 7 |

Fase 2, 3 en 4 zijn onderling onafhankelijk en mogen in elke volgorde of parallel. Fase 5, 6 en 7 zijn onderling onafhankelijk maar raken alle drie de annotatietypen, dus ze gaan één voor één om samenvoegconflicten te vermijden.

---

## Fase 1 — De meetlat

**Doel:** één commando dat de cijfers uit dit plan reproduceert, zodat elke volgende fase haar winst hard kan maken.

**Wat verandert er voor de gebruiker:** niets. Er komt alleen een script in `scripts/` bij; er wordt geen bronbestand aangeraakt.

**Meting na afloop:** `node scripts/meet-js.mjs` geeft exact `136482` regels en `603` bestanden op de commit waar fase 1 van uitgaat.

**Branch:** `refactor/454-fase-1-meetlat`

### Task 1: het meetscript

**Files:**
- Create: `open-pdf-studio/scripts/meet-js.mjs`
- Test: `open-pdf-studio/scripts/meet-js.test.mjs`
- Modify: `open-pdf-studio/package.json` (het `test:unit`-script)

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: `telRegels(wortel)` geeft `{ bestanden: number, regels: number, perMap: Map<string, {bestanden: number, regels: number}>, groot: Array<{pad: string, regels: number}> }`, waarbij `groot` de bestanden boven 800 regels bevat, aflopend gesorteerd. `leesChunks(distMap)` geeft `Array<{naam: string, bytes: number}>`, aflopend gesorteerd, of `[]` als de map niet bestaat.

- [ ] **Step 1: Schrijf de falende test**

Maak `open-pdf-studio/scripts/meet-js.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { telRegels, leesChunks } from './meet-js.mjs';

function maakBoom() {
  const wortel = mkdtempSync(join(tmpdir(), 'meet-js-'));
  mkdirSync(join(wortel, 'a'), { recursive: true });
  mkdirSync(join(wortel, 'node_modules'), { recursive: true });
  writeFileSync(join(wortel, 'a', 'klein.js'), 'een\ntwee\ndrie\n');
  writeFileSync(join(wortel, 'a', 'groot.js'), 'x\n'.repeat(801));
  writeFileSync(join(wortel, 'a', 'component.jsx'), 'y\n'.repeat(10));
  writeFileSync(join(wortel, 'a', 'typen.ts'), 'z\n'.repeat(5));
  writeFileSync(join(wortel, 'a', 'iets.test.mjs'), 'q\n'.repeat(99));
  writeFileSync(join(wortel, 'node_modules', 'pakket.js'), 'w\n'.repeat(500));
  return wortel;
}

test('telRegels telt js, jsx en ts en slaat tests en node_modules over', () => {
  const wortel = maakBoom();
  try {
    const r = telRegels(wortel);
    assert.equal(r.bestanden, 4);
    assert.equal(r.regels, 4 + 802 + 11 + 6);
  } finally {
    rmSync(wortel, { recursive: true, force: true });
  }
});

test('telRegels meldt de bestanden boven 800 regels, aflopend', () => {
  const wortel = maakBoom();
  try {
    const r = telRegels(wortel);
    assert.equal(r.groot.length, 1);
    assert.equal(r.groot[0].regels, 802);
    assert.match(r.groot[0].pad, /groot\.js$/);
  } finally {
    rmSync(wortel, { recursive: true, force: true });
  }
});

test('telRegels groepeert per eerste map onder de wortel', () => {
  const wortel = maakBoom();
  try {
    const r = telRegels(wortel);
    assert.equal(r.perMap.get('a').bestanden, 4);
    assert.equal(r.perMap.get('a').regels, 823);
  } finally {
    rmSync(wortel, { recursive: true, force: true });
  }
});

test('leesChunks geeft een lege lijst als de map ontbreekt', () => {
  assert.deepEqual(leesChunks(join(tmpdir(), 'bestaat-niet-meet-js')), []);
});

test('leesChunks sorteert aflopend op grootte', () => {
  const wortel = mkdtempSync(join(tmpdir(), 'meet-chunks-'));
  try {
    writeFileSync(join(wortel, 'klein-aaa.js'), 'a'.repeat(10));
    writeFileSync(join(wortel, 'index-bbb.js'), 'b'.repeat(100));
    const c = leesChunks(wortel);
    assert.equal(c.length, 2);
    assert.equal(c[0].bytes, 100);
    assert.equal(c[1].bytes, 10);
  } finally {
    rmSync(wortel, { recursive: true, force: true });
  }
});
```

Let op de getallen: `split('\n')` op een bestand dat op een newline eindigt geeft één leeg element extra. `'een\ntwee\ndrie\n'` telt dus als 4, en `'x\n'.repeat(801)` als 802. Dat is precies hoe `wc -l` en dit script van elkaar verschillen; het gaat om het verschil tussen twee metingen, dus consistentie telt, niet de absolute conventie. De cijfers in dit plan zijn met `wc -l` gemeten; `meet-js.mjs` zal er één per bestand boven zitten. Documenteer dat in de kopregel van het script.

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test scripts/meet-js.test.mjs
```

Verwacht: FAIL met `Cannot find module` voor `./meet-js.mjs`.

- [ ] **Step 3: Schrijf het script**

Maak `open-pdf-studio/scripts/meet-js.mjs`:

```js
// Meetlat voor issue #454. Telt de broncode onder js/ en leest, als er een
// build ligt, de chunkgroottes uit dist/assets/. Draait zonder node_modules.
//
//   node scripts/meet-js.mjs            # regels, bestanden, grote bestanden
//   node scripts/meet-js.mjs --json     # dezelfde cijfers als JSON
//
// Telconventie: een bestand dat op een newline eindigt telt hier één regel
// hoger dan bij `wc -l`. Vergelijk dus altijd meting met meting, nooit met wc.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSIES = ['.js', '.jsx', '.ts'];
const OVERSLAAN = new Set(['node_modules', '.git', 'dist', 'dist-web-unit', 'target']);
const GROOT_VANAF = 800;

function isBron(naam) {
  if (naam.includes('.test.')) return false;
  return EXTENSIES.some((e) => naam.endsWith(e));
}

function loop(map, uit = []) {
  for (const item of readdirSync(map, { withFileTypes: true })) {
    if (OVERSLAAN.has(item.name)) continue;
    const pad = join(map, item.name);
    if (item.isDirectory()) loop(pad, uit);
    else if (isBron(item.name)) uit.push(pad);
  }
  return uit;
}

/** Telt regels en bestanden onder `wortel`. Tests en node_modules tellen niet mee. */
export function telRegels(wortel) {
  const bestanden = loop(wortel);
  const perMap = new Map();
  const groot = [];
  let regels = 0;
  for (const pad of bestanden) {
    const n = readFileSync(pad, 'utf8').split('\n').length;
    regels += n;
    const rel = relative(wortel, pad).split(sep).join('/');
    const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '.';
    const rij = perMap.get(top) || { bestanden: 0, regels: 0 };
    rij.bestanden += 1;
    rij.regels += n;
    perMap.set(top, rij);
    if (n > GROOT_VANAF) groot.push({ pad: rel, regels: n });
  }
  groot.sort((a, b) => b.regels - a.regels);
  return { bestanden: bestanden.length, regels, perMap, groot };
}

/** Chunkgroottes uit een dist/assets-map, aflopend. Lege lijst als de map er niet is. */
export function leesChunks(distMap) {
  if (!existsSync(distMap)) return [];
  return readdirSync(distMap)
    .filter((n) => n.endsWith('.js'))
    .map((n) => ({ naam: n, bytes: statSync(join(distMap, n)).size }))
    .sort((a, b) => b.bytes - a.bytes);
}

function kB(b) {
  return (b / 1024).toFixed(1) + ' kB';
}

function main() {
  const hier = fileURLToPath(new URL('.', import.meta.url));
  const app = join(hier, '..');
  const r = telRegels(join(app, 'js'));
  const chunks = leesChunks(join(app, 'dist', 'assets'));
  const ingang = chunks.find((c) => c.naam.startsWith('index-')) || null;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      regels: r.regels,
      bestanden: r.bestanden,
      boven800: r.groot.length,
      groot: r.groot,
      perMap: Object.fromEntries(r.perMap),
      chunks,
      ingangChunkBytes: ingang ? ingang.bytes : null,
    }, null, 2));
    return;
  }

  console.log(`regels      ${r.regels}`);
  console.log(`bestanden   ${r.bestanden}`);
  console.log(`boven ${GROOT_VANAF}   ${r.groot.length}`);
  console.log('');
  console.log('per map:');
  for (const [naam, rij] of [...r.perMap].sort((a, b) => b[1].regels - a[1].regels)) {
    console.log(`  ${String(rij.regels).padStart(7)}  ${String(rij.bestanden).padStart(4)}  ${naam}`);
  }
  console.log('');
  console.log(`bestanden boven ${GROOT_VANAF} regels:`);
  for (const g of r.groot) console.log(`  ${String(g.regels).padStart(6)}  ${g.pad}`);

  if (!chunks.length) {
    console.log('');
    console.log('geen dist/assets — draai `npx vite build` voor de chunkgroottes');
    return;
  }
  const som = chunks.reduce((s, c) => s + c.bytes, 0);
  console.log('');
  console.log(`chunks      ${chunks.length}`);
  console.log(`som         ${kB(som)}`);
  console.log(`ingang      ${ingang ? kB(ingang.bytes) : 'niet gevonden'}`);
  console.log('');
  console.log('grootste chunks:');
  for (const c of chunks.slice(0, 12)) console.log(`  ${kB(c.bytes).padStart(10)}  ${c.naam}`);
}

if (process.argv[1] && process.argv[1].endsWith('meet-js.mjs')) main();
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test scripts/meet-js.test.mjs
```

Verwacht: PASS, 5 tests.

- [ ] **Step 5: Controleer dat het script de nullijn reproduceert**

```bash
cd open-pdf-studio && node scripts/meet-js.mjs | head -3
```

Verwacht op commit `53cefd2d` ongeveer:

```
regels      137085
bestanden   603
boven 800   27
```

`bestanden` en `boven 800` moeten exact kloppen. `regels` ligt ongeveer 603 hoger dan de 136 482 uit dit plan, door de telconventie uit Step 1. Noteer de werkelijke uitvoer in de PR-tekst als nullijn voor alle volgende fasen.

- [ ] **Step 6: Hang de test aan `test:unit`**

In `open-pdf-studio/package.json`, in de waarde van `scripts.test:unit`, voeg ` scripts/meet-js.test.mjs` toe direct achter `scripts/test-nen-ifc-map.mjs`. Het is één lange regel; verander verder niets aan die regel.

- [ ] **Step 7: Draai de volledige suite en de build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

Verwacht: beide groen. Lees de volledige build-uitvoer, niet alleen de laatste regels.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/scripts/meet-js.mjs open-pdf-studio/scripts/meet-js.test.mjs open-pdf-studio/package.json
git commit -m "chore(metrics): add a line and bundle size meter for the JavaScript reduction (#454)"
```

---

## Fase 2 — Dode code weg

**Doel:** −1 050 regels en −3 bestanden. Van 603 naar 600 bestanden, van 136 482 naar ~135 430 regels. Daarnaast 173 overbodige `export`-sleutelwoorden weg (geen regelwinst, wel een kleiner openbaar oppervlak en betere tree-shaking) en 21 ongebruikte doorexports uit `js/bridge.ts`.

**Wat verandert er voor de gebruiker:** niets. Er verdwijnt alleen code die nergens wordt aangeroepen.

**Branch:** `refactor/454-fase-2-dode-code`

**Waarschuwing die voor élke taak in deze fase geldt.** Een statische analyse ziet geen aanroep via een tekenreeks. Controleer per symbool dat het ook niet voorkomt in:

```bash
# i18n-sleutels, MCP-opdrachtnamen, DOM-id's, dynamische property-toegang
grep -rn "'<naam>'" open-pdf-studio/js open-pdf-studio/index.html
grep -rn '"<naam>"' open-pdf-studio/js open-pdf-studio/src-tauri open-pdf-studio/mcp-server ../mcp-stdio
grep -rn "<naam>" open-pdf-studio/scripts ../scripts
```

Pas verwijderen als alle drie leeg zijn. Bij twijfel: laten staan en in de PR-tekst noemen.

### Task 1: de drie dode modules

**Files:**
- Delete: `open-pdf-studio/js/pdf/page-manager-test-hooks.mjs` (58 regels)
- Delete: `open-pdf-studio/js/types/global.d.ts` (21 regels)
- Delete: `open-pdf-studio/js/quantities/label-i18n.js` (18 regels)

**Interfaces:**
- Consumes: niets.
- Produces: niets. Dit is puur verwijderen.

- [ ] **Step 1: Bevestig dat de drie nergens voorkomen**

```bash
cd open-pdf-studio
grep -rn "page-manager-test-hooks" js scripts ../scripts ../mcp-stdio index.html
grep -rn "global.d.ts\|global\.d" js scripts tsconfig.json 2>/dev/null
grep -rn "label-i18n" js scripts ../scripts
```

Verwacht: geen uitvoer. Levert een van de drie wél een treffer op, sla dat bestand over en noteer waarom in de PR-tekst.

- [ ] **Step 2: Controleer of `global.d.ts` niet impliciet door `tsc` wordt opgepakt**

```bash
cd open-pdf-studio && cat tsconfig.json
```

Staat er een `include` die `js/**/*` of `**/*.d.ts` dekt, dan is het bestand niet dood maar een ambient-declaratiebestand. Draai in dat geval eerst `npx tsc --noEmit` met het bestand nog aanwezig, noteer het aantal fouten, verwijder het, en draai opnieuw. Alleen bij een gelijk aantal fouten mag het weg.

- [ ] **Step 3: Verwijder de bestanden**

```bash
cd open-pdf-studio
git rm js/pdf/page-manager-test-hooks.mjs js/types/global.d.ts js/quantities/label-i18n.js
```

- [ ] **Step 4: Draai tests, typecheck en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npm run typecheck
cd open-pdf-studio && npx vite build
```

Verwacht: alle drie groen, en `npm run typecheck` met hetzelfde aantal fouten als vóór Step 3.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(cleanup): drop three modules nothing imports (#454)"
```

### Task 2: de lege stubs en hun aanroepen

`js/ui/chrome/status-bar.js:21-25` bevat vijf lege functies. `updateAllStatus()` wordt nog 12 keer aangeroepen, `updateStatusTool()` en `updateStatusAnnotations()` elk één keer. `js/ui/panels/properties-panel.js:91-94` bevat vier lege functies met nul aanroepen. `js/ui/chrome/menus.js:5` bevat `initMenus() {}`, één keer aangeroepen vanuit `js/main.js`.

**Files:**
- Modify: `open-pdf-studio/js/ui/chrome/status-bar.js:21-25`
- Modify: `open-pdf-studio/js/ui/panels/properties-panel.js:91-94`
- Modify: `open-pdf-studio/js/ui/chrome/menus.js:5`
- Modify: `open-pdf-studio/js/main.js` (de `initMenus`-import en -aanroep)
- Modify: alle bestanden met een aanroep van `updateAllStatus`, `updateStatusTool` of `updateStatusAnnotations`

**Interfaces:**
- Consumes: niets.
- Produces: `js/ui/chrome/status-bar.js` exporteert na deze taak alleen nog `updateStatusMessage(message, duration = 3000)`. `js/ui/chrome/menus.js` exporteert nog `openAppMenu()`, `closeAppMenu()` en `closeAllMenus()`; `initMenus` bestaat niet meer.

- [ ] **Step 1: Verzamel de aanroepplekken**

```bash
cd open-pdf-studio
grep -rn "updateAllStatus\|updateStatusTool\|updateStatusPage\|updateStatusZoom\|updateStatusAnnotations" js --include=*.js --include=*.jsx --include=*.ts
grep -rn "updateAnnotationProperties\|updateArrowProperties\|updateTextFormatProperties\|updateColorDisplay" js --include=*.js --include=*.jsx --include=*.ts
grep -rn "initMenus" js --include=*.js --include=*.jsx --include=*.ts
```

Schrijf de lijst op. Verwacht: 12 + 1 + 1 aanroepen voor de eerste groep, 0 voor de tweede, 1 voor de derde.

- [ ] **Step 2: Bevestig dat de functies werkelijk leeg zijn**

```bash
cd open-pdf-studio && sed -n '19,26p' js/ui/chrome/status-bar.js && sed -n '88,95p' js/ui/panels/properties-panel.js && sed -n '1,7p' js/ui/chrome/menus.js
```

Verwacht, letterlijk:

```js
// Kept for backward compatibility - now no-ops since StatusBar.jsx derives from state
export function updateStatusTool() {}
export function updateStatusPage() {}
export function updateStatusZoom() {}
export function updateStatusAnnotations() {}
export function updateAllStatus() {}
```

Is een van deze functies niet leeg, dan is de meting achterhaald: sla die functie over.

- [ ] **Step 3: Verwijder eerst de aanroepen, daarna de definities**

Voor elke aanroepplek uit Step 1: haal de aanroepregel weg én het bijbehorende symbool uit de `import`-regel bovenaan dat bestand. Blijft er een lege `import {} from '...'` over, haal dan de hele importregel weg.

Daarna in `js/ui/chrome/status-bar.js` de regels 20 t/m 25 verwijderen (het comment én de vijf lege functies), in `js/ui/panels/properties-panel.js` de regels 91 t/m 94, en in `js/ui/chrome/menus.js` regel 5.

In `js/main.js`: haal `initMenus` uit de import op regel 38 (de hele regel vervalt, want er staat niets anders in) en haal de `initMenus();`-aanroep weg.

- [ ] **Step 4: Controleer dat er geen verwijzing is blijven staan**

```bash
cd open-pdf-studio
grep -rn "updateAllStatus\|updateStatusTool\|updateStatusPage\|updateStatusZoom\|updateStatusAnnotations\|updateAnnotationProperties\|updateArrowProperties\|updateTextFormatProperties\|updateColorDisplay\|initMenus" js --include=*.js --include=*.jsx --include=*.ts
```

Verwacht: geen uitvoer.

- [ ] **Step 5: Draai tests en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js
git commit -m "chore(cleanup): remove no-op status and properties stubs and their call sites (#454)"
```

### Task 3: de zes zwaarste dode exports

Zes bestanden dragen 391 van de 951 dode regels.

**Files:**
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` — verwijder `destroyViewport` (84-94), `clampAndCenterUnused_keptForReference` (541-626), `clearAnchor` (640), `zoomAtPoint` (1213-1218), `screenToWorld` (1285-1290), `worldToScreen` (1292-1297). Samen 116 regels.
- Modify: `open-pdf-studio/js/tools/text-edit-tool.js` — verwijder `createReplaceTextEdit` (1440-1522). 83 regels.
- Modify: `open-pdf-studio/js/compare/overlay-renderer.js` — verwijder `OLD_TINT` (17), `NEW_TINT` (18), `tintCanvas` (34-42), `INK_THRESHOLD` (52). 61 regels inclusief hun comments.
- Modify: `open-pdf-studio/js/annotations/redaction.js` — verwijder `applyAllRedactions` (58-102). 45 regels.
- Modify: `open-pdf-studio/js/annotations/smart-guides.js` — verwijder `findAlignmentGuides` (16-60). 45 regels.
- Modify: `open-pdf-studio/js/annotations/rendering/selection.js` — verwijder `drawMultiSelectionOutline` (422-432) en `drawMultiSelectionBounds` (435-464). 41 regels.

**Interfaces:**
- Consumes: niets.
- Produces: niets nieuws. Let op de valkuil hieronder: `screenToWorld`/`worldToScreen` zijn juist de primitieven die fase 4 wil gaan gebruiken.

- [ ] **Step 1: Bewaar `screenToWorld` en `worldToScreen`**

```bash
cd open-pdf-studio && sed -n '1283,1300p' js/pdf/pdf-viewport.js
```

Deze twee zijn nu ongebruikt, maar fase 4 Task 8 maakt ze juist tot de enige plek voor de scherm↔wereld-omrekening. **Verwijder ze niet.** Haal alleen het `export`-sleutelwoord er niet af en laat ze staan; zet er een comment boven:

```js
// Wordt nog niet gebruikt; fase 4 van issue #454 laat resolvePointerCoords en
// pointerToAppCoords hierop terugvallen in plaats van (x - vp.offsetX) / vp.zoom
// zelf uit te rekenen.
```

- [ ] **Step 2: Controleer de overige vier in `pdf-viewport.js`**

```bash
cd open-pdf-studio
for n in destroyViewport clampAndCenterUnused_keptForReference clearAnchor zoomAtPoint; do
  echo "== $n"; grep -rn "\b$n\b" js scripts ../scripts ../mcp-stdio index.html --include=* | grep -v "^js/pdf/pdf-viewport.js"
done
```

Verwacht: geen uitvoer per naam.

- [ ] **Step 3: Verwijder de vier, en de vijf uit de andere bestanden**

Verwijder per bestand de genoemde regelbereiken inclusief de doc-comment die er direct boven staat. Laat de omliggende blanco regels netjes achter (geen dubbele lege regels).

Bij `js/compare/overlay-renderer.js`: `tintCanvas` gebruikt `OLD_TINT`/`NEW_TINT`; die drie horen bij elkaar en gaan samen weg. `composeOverlay` (48-50) en `HIGHLIGHT_COLORS` (55-59) staan in dezelfde lijst dode exports, maar controleer die apart — `HIGHLIGHT_COLORS` klinkt als iets wat via een tekenreekssleutel kan worden aangesproken.

- [ ] **Step 4: Controleer opnieuw op resten**

```bash
cd open-pdf-studio
grep -rn "destroyViewport\|clampAndCenterUnused_keptForReference\|clearAnchor\|zoomAtPoint\|createReplaceTextEdit\|tintCanvas\|OLD_TINT\|NEW_TINT\|INK_THRESHOLD\|applyAllRedactions\|findAlignmentGuides\|drawMultiSelectionOutline\|drawMultiSelectionBounds" js scripts
```

Verwacht: geen uitvoer.

- [ ] **Step 5: Draai tests en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 6: Meet**

```bash
cd open-pdf-studio && node scripts/meet-js.mjs | head -3
```

Verwacht: ongeveer 391 regels minder dan na Task 2.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js
git commit -m "chore(cleanup): remove the six heaviest unreferenced exports (#454)"
```

### Task 4: de resterende dode exports en de ongebruikte doorexports in de brug

De volledige lijst staat hieronder. Werk hem van boven naar beneden af, per bestand, met de grep-controle uit de fasekop.

**Files:**
- Modify: 68 bestanden, elk voor één tot elf symbolen. De volledige lijst:

| Bestand | Te verwijderen symbolen (regelbereik) | Regels |
|---|---|---:|
| `js/search/find-bar.js` | `triggerSearch`(142-146) `onReplaceAll`(672-699) `handleReplaceInput`(701-703) | 36 |
| `js/ui/panels/left-panel.js` | `showPageProperties`(806-835) | 30 |
| `js/text/text-layer.js` | `mapPdfFontToCss`(124-148) `getTextLayer`(527-530) | 29 |
| `js/ui/chrome/dialogs.js` | `showAboutPanel`(25-28) `hideDocPropertiesDialog`(44-46) `hideNewDocDialog`(139-141) `hideInsertPageDialog`(155-157) `hideExtractPagesDialog`(175-177) `hideMergePdfsDialog`(191-193) `hidePrintDialog`(207-209) `hidePageSetupDialog`(219-221) | 25 |
| `js/utils/colors.js` | `parseColor`(39-63) | 25 |
| `js/text/text-markup.js` | `getTextMarkupDefaults`(184-207) | 24 |
| `js/solid/stores/countStore.js` | `countCategories`(14) `activeCountCategoryId`(15) `setActiveCountCategory`(17) `addCountCategory`(19-23) `updateCountCategory`(25-27) `removeCountCategory`(30-37) `countTotal`(61) `countCsvRows`(64-66) | 23 |
| `js/tools/pdf-snap-extractor.js` | `loadAllPdfSnapData`(78-93) `isPdfSnapLoaded`(98-100) `getCachedPdfEdgeSegments`(117-120) | 23 |
| `js/annotations/spline-arrow-geometry.js` | `sampleSplineArrow`(70-89) | 20 |
| `js/solid/components/ExtensionToolPalette.jsx` | `toggleExtPalette`(68-79) `isExtPaletteVisible`(81-84) | 16 |
| `js/pdf/tile-cache.js` | `tileCacheClearForFile`(64-72) `tileCacheClearAll`(74-79) | 15 |
| `js/tools/manager.js` | `getCursorForTool`(24-38) | 15 |
| `js/pdf/renderer.js` | `clearBitmapJSCacheForFile`(58-68) `clearLowResCache`(1041-1043) | 14 |
| `js/pdf/page-bitmap-cache.js` | `prefetchFallbackBitmap`(160-162) `invalidatePageBitmaps`(221-230) | 13 |
| `js/pdf/page-type-cache.js` | `evictFile`(45-50) `evictAll`(53-55) `cacheSize`(58-60) | 12 |
| `js/core/preferences.js` | `resetPreferencesToDefaults`(336-346) | 11 |
| `js/solid/data/ribbonIcons.js` | `screenshotDropdownArrow`(21) `screenshotPageMenuIcon`(23) `screenshotRegionMenuIcon`(25) `northArrowIcon`(119) `snapToDrawingIcon`(133) `undoIcon`(143) `thinLinesIcon`(168) `themeDropdownArrow`(170) `styleMoreArrow`(210) `colorDropdownArrow`(212) `dropdownArrowSmall`(214) | 11 |
| `js/annotations/rendering/walls.js` | `isPointOnWall`(298-307) | 10 |
| `js/tools/tool-registry.js` | `getToolCursor`(18-24) `hasRegisteredTool`(26-28) | 10 |
| `js/annotations/rendering.js` | `rebuildSpatialIndex`(2697-2702) `hideContinuousSharpOverlays`(3153-3155) | 9 |
| `js/annotations/vector-snippet-preview.js` | `wisOngebruikteBitmaps`(170-178) | 9 |
| `js/solid/stores/scheduleStore.js` | `allElementsTally`(169-176) `allElementsTotal`(178) | 9 |
| `js/annotations/image-drop.js` | `refreshAllLinkedImages`(74-80) | 7 |
| `js/pdf/page-transition.js` | `clearPagePlaceholder`(104-110) | 7 |
| `js/solid/stores/elementVisibilityStore.js` | `setTypeHidden`(80-86) | 7 |
| `js/solid/stores/propertiesStore.js` | `updateOpacity`(1824-1830) | 7 |
| `js/text/text-selection.js` | `getSelectionRects`(230-236) | 7 |
| `js/tools/type-length-input.js` | `getTypeLengthStart`(72-74) `clearTypeLengthBuffer`(93-96) | 7 |
| `js/pdf/vector-renderer.js` | `clearVectorCache`(38-40) `invalidatePageCache`(44-46) | 6 |
| `js/search/find-controller.js` | `didSearchWrap`(407-412) | 6 |
| `js/solid/data/symbolLocales.js` | `industryName`(21-23) `countryName`(25-27) | 6 |
| `js/ui/panels/annotations-list.js` | `showAnnotationsListPanel`(38-40) `hideAnnotationsListPanel`(43-45) | 6 |
| `js/core/platform.js` | `toggleWindowFullscreen`(131-135) | 5 |
| `js/symbols/registry.js` | `listCategories`(111-115) | 5 |
| `js/ui/panels/bookmarks.js` | `clearBookmarkSelection`(197-201) | 5 |
| `js/pdf/ocr.js` | `hasOcrResults`(71-74) | 4 |
| overige 31 bestanden, elk één tot drie symbolen van 3 regels | zie de uitvoer van Step 1 | ~100 |

**Interfaces:**
- Consumes: niets.
- Produces: niets nieuws.

- [ ] **Step 1: Genereer de actuele lijst**

De tabel hierboven is gemeten op commit `53cefd2d`. Genereer hem opnieuw op de werkelijke commit met een wegwerpscript in een tijdelijke map (niet in de repo):

```bash
cat > "$TMPDIR/dode-exports.mjs" <<'EOF'
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
const APP = process.argv[2];
const EXT = ['.js', '.jsx', '.ts', '.mjs', '.cjs'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web-unit', 'target', 'locales']);
function loop(d, o = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) loop(p, o);
    else if (EXT.some((x) => e.name.endsWith(x))) o.push(p);
  }
  return o;
}
const alle = [
  ...loop(join(APP, 'js')), ...loop(join(APP, 'scripts')),
  ...loop(join(APP, 'web-unit')), ...loop(join(APP, '../mcp-stdio')),
  ...loop(join(APP, '../scripts')),
];
const body = new Map(alle.map((f) => [f, readFileSync(f, 'utf8')]));
const elders = new Map();
for (const [f, src] of body) {
  for (const id of new Set(src.match(/[A-Za-z_$][\w$]*/g) || [])) {
    if (!elders.has(id)) elders.set(id, new Set());
    elders.get(id).add(f);
  }
}
for (const [f, src] of body) {
  if (f.includes('.test.')) continue;
  const regels = src.split('\n');
  for (let i = 0; i < regels.length; i++) {
    const m = regels[i].match(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    const naam = m[1];
    if ([...(elders.get(naam) || [])].some((x) => x !== f)) continue;
    const eigen = (src.match(new RegExp('\\b' + naam + '\\b', 'g')) || []).length;
    if (eigen > 1) continue;
    let diep = 0, begonnen = false, eind = i;
    for (let j = i; j < regels.length; j++) {
      const op = (regels[j].match(/{/g) || []).length;
      const dicht = (regels[j].match(/}/g) || []).length;
      if (op) begonnen = true;
      diep += op - dicht;
      eind = j;
      if (begonnen && diep <= 0) break;
      if (!begonnen && /;\s*$/.test(regels[j])) break;
    }
    const rel = relative(APP, f).split(sep).join('/');
    console.log(`${eind - i + 1}\t${rel}\t${naam}\t${i + 1}-${eind + 1}`);
  }
}
EOF
cd open-pdf-studio && node "$TMPDIR/dode-exports.mjs" "$PWD" | sort -rn > "$TMPDIR/dode-exports.tsv"
wc -l "$TMPDIR/dode-exports.tsv"
```

Verwacht: 133 regels op commit `53cefd2d`, minus wat Task 3 al heeft weggehaald. Wijkt het af, gebruik de nieuwe lijst.

- [ ] **Step 2: Controleer de hele lijst op aanroepen via tekenreeksen**

```bash
cd open-pdf-studio
cut -f3 "$TMPDIR/dode-exports.tsv" | sort -u | while read n; do
  treffers=$(grep -rn "['\"]$n['\"]" js index.html ../mcp-stdio ../scripts 2>/dev/null | wc -l)
  if [ "$treffers" != "0" ]; then echo "LATEN STAAN: $n ($treffers treffers als tekenreeks)"; fi
done
```

Elke naam die hier verschijnt blijft staan. Noteer ze in de PR-tekst onder "kept: reachable by name".

- [ ] **Step 3: Verwijder de symbolen, bestand voor bestand**

Werk per bestand van onder naar boven (hoogste regelnummer eerst), zodat eerdere regelnummers geldig blijven. Verwijder per symbool de declaratie en de doc-comment die er direct boven staat. Haal geen blanco regels weg die twee overgebleven functies scheiden.

Commit per tien bestanden, met een bericht als `chore(cleanup): drop unreferenced exports in js/pdf (#454)`, zodat de review behapbaar blijft en een terugdraai klein is.

- [ ] **Step 4: Haal de 21 ongebruikte doorexports uit `js/bridge.ts`**

De brug blijft; alleen wat niemand importeert gaat eruit. Gemeten ongebruikt:

`propertiesPanelMode`, `findBarVisible`, `findBarResultsText`, `findBarMessageText`, `findBarNotFound`, `findBarNavDisabled`, `findBarSearching`, `findBarReplaceMode`, `setFindBarReplaceMode`, `findBarReplaceText`, `setFindBarReplaceText`, `findBarSearchInText`, `setFindBarSearchInText`, `findBarSearchInAnnotations`, `setFindBarSearchInAnnotations`, `findBarResultGroups`, `findBarResultsOpen`, `findBarCurrentResultPage`, `findBarSourcesOff`, `setFindBarSourcesOff`, `setFindBarNotFound`.

Bevestig eerst per naam:

```bash
cd open-pdf-studio
for n in propertiesPanelMode findBarVisible findBarResultsText findBarMessageText findBarNotFound \
         findBarNavDisabled findBarSearching findBarReplaceMode setFindBarReplaceMode findBarReplaceText \
         setFindBarReplaceText findBarSearchInText setFindBarSearchInText findBarSearchInAnnotations \
         setFindBarSearchInAnnotations findBarResultGroups findBarResultsOpen findBarCurrentResultPage \
         findBarSourcesOff setFindBarSourcesOff setFindBarNotFound; do
  c=$(grep -rn "\b$n\b" js --include=*.js --include=*.jsx --include=*.ts --include=*.mjs | grep -cv "^js/bridge.ts")
  echo "$n: $c"
done
```

Verwacht: `0` achter elke naam. Verwijder daarna precies die aliasregels uit het `export { … } from './solid/stores/findBarStore.js';`-blok (regels 85-113) en uit het propertiesStore-blok. Laat de blokken zelf staan; `findBarStore.js` blijft via de overgebleven aliassen bereikbaar.

- [ ] **Step 5: Draai tests, typecheck en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npm run typecheck
cd open-pdf-studio && npx vite build
```

- [ ] **Step 6: Meet en commit**

```bash
cd open-pdf-studio && node scripts/meet-js.mjs | head -3
git add open-pdf-studio/js
git commit -m "chore(cleanup): drop the remaining unreferenced exports and bridge re-exports (#454)"
```

### Task 5: `export` weghalen waar het niets oplevert

173 symbolen dragen een `export` maar worden alleen binnen hun eigen bestand gebruikt. Dat is geen dode code, maar het houdt Rollup tegen bij het snoeien en het maakt elk bestand groter dan zijn werkelijke openbare oppervlak.

**Files:**
- Modify: ~90 bestanden, alleen het woord `export ` aan het begin van een declaratieregel.

**Interfaces:**
- Consumes: de lijst uit Step 1.
- Produces: niets nieuws; alle overgebleven exports houden dezelfde naam en signatuur.

- [ ] **Step 1: Genereer de lijst**

Gebruik hetzelfde script als Task 4 Step 1, maar met `if (eigen > 1) continue;` vervangen door `if (eigen <= 1) continue;`. Schrijf naar `$TMPDIR/over-exports.tsv`.

Verwacht: 173 regels.

- [ ] **Step 2: Sluit alles uit wat via een tekenreeks of een test bereikbaar is**

Dezelfde controle als Task 4 Step 2. Daarbovenop: sluit elk bestand uit dat een `*.test.mjs` naast zich heeft, want een test importeert per definitie de export.

```bash
cd open-pdf-studio
cut -f2 "$TMPDIR/over-exports.tsv" | sort -u | while read f; do
  basis="${f%.*}"
  if [ -f "$basis.test.mjs" ]; then echo "OVERSLAAN (heeft een test): $f"; fi
done
```

- [ ] **Step 3: Haal `export ` weg**

Voor elke overgebleven regel: verander

```js
export function eenNaam(a, b) {
```

in

```js
function eenNaam(a, b) {
```

Niets anders. Geen herschikking, geen hernoeming, geen samenvoeging.

- [ ] **Step 4: Draai tests, typecheck en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npm run typecheck
cd open-pdf-studio && npx vite build
```

Een fout hier betekent dat het symbool tóch elders wordt gebruikt — zet het `export` terug en noteer het bestand.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js
git commit -m "chore(cleanup): unexport symbols used only inside their own module (#454)"
```

### PR van fase 2

Titel: `chore: remove dead code (3 modules, 133 exports, 173 needless exports) (#454)`

Tekst met de meting uit `node scripts/meet-js.mjs`, en een expliciete lijst van alles wat is blijven staan omdat het via een tekenreeks bereikbaar bleek.

---

## Fase 3 — Lui laden: het startpakket kleiner

**Doel:** de ingangschunk 35 à 45 % kleiner. Zo'n 23 000 regels die nu onvoorwaardelijk in de hoofdchunk zitten verhuizen naar chunks die pas worden opgehaald als de gebruiker de functie gebruikt. Het aantal chunks gaat van enkele naar ongeveer 55.

**Dit is de enige fase die géén bronregels weghaalt.** Het totaal aantal regels blijft gelijk; de som van alle chunks blijft ongeveer gelijk. Wat daalt is wat de app bij het opstarten moet downloaden, parsen en uitvoeren.

**Wat verandert er voor de gebruiker:** het eerste openen van een venster kost één netwerk- of schijfronde extra. Dat is bij een bureaubladapp een lokale bestandslees van enkele tientallen kB; reken op één frame. Elk volgend openen is gratis, want de chunk zit dan in het geheugen. Het opstarten van de app wordt merkbaar sneller. Dit is de enige waarneembare verandering in het hele plan en hoort in de release-notes.

**Branch:** `refactor/454-fase-3-lui-laden`

**Meting:** noteer vóór en na `npx vite build` de drie getallen uit de sectie "Meten": ingangschunk, som van alle chunks, aantal chunks.

### Task 1: de twee blokkades opruimen

Twee importregels houden 14 000 regels vast. Zolang ze er staan heeft `lazy()` op `DialogHost` geen effect voor `PageSetupDialog` en geen enkel effect voor de CAD-code.

**Files:**
- Modify: `open-pdf-studio/js/ui/chrome/dialogs.js:223` — verwijder de doorexport
- Modify: `open-pdf-studio/js/pdf/cad-export-logica.js` — voeg `getalTekst` toe
- Modify: `open-pdf-studio/js/solid/components/dialogs/CadExportDialog.jsx:15` — importeer `getalTekst` uit `cad-export-logica.js`
- Modify: `open-pdf-studio/js/pdf/cad-import-logica.js:317` — laat `getalTekst` staan maar laat hem `cad-export-logica.js` gebruiken
- Test: `open-pdf-studio/js/pdf/cad-export.test.mjs` (bestaat al; breid uit)

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: `js/pdf/cad-export-logica.js` exporteert na deze taak `getalTekst(n: number, taal: string | undefined): string` — getal in de notatie van de taal, maximaal drie decimalen, met een echt minteken (U+2212) in plaats van een koppelteken.

- [ ] **Step 1: Bevestig dat de doorexport niemand bedient**

```bash
cd open-pdf-studio && grep -rn "getPageSetupSettings" js --include=*.js --include=*.jsx
```

Verwacht: `js/mcp-bridge.js:2612` haalt hem lui rechtstreeks uit `PageSetupDialog.jsx`, `js/solid/components/dialogs/PrintDialog.jsx:13` importeert rechtstreeks, en `js/ui/chrome/dialogs.js:223` doorexporteert zonder afnemer. Verschijnt er wél een afnemer van de doorexport, laat de regel dan staan en verplaats in plaats daarvan `pageSetupSettings` naar een eigen store — dat is dan een eigen taak.

- [ ] **Step 2: Verwijder de doorexport**

In `open-pdf-studio/js/ui/chrome/dialogs.js`, verwijder regel 223:

```js
export { getPageSetupSettings } from '../../solid/components/dialogs/PageSetupDialog.jsx';
```

Dit is de enige statische boog van het documentopen-pad (`js/pdf/loader.js:2` → `js/ui/chrome/dialogs.js`) naar een venster.

- [ ] **Step 3: Schrijf de falende test voor `getalTekst` op zijn nieuwe plek**

Voeg toe aan `open-pdf-studio/js/pdf/cad-export.test.mjs`:

```js
import { getalTekst } from './cad-export-logica.js';

test('getalTekst gebruikt de notatie van de taal', () => {
  assert.equal(getalTekst(1234.5, 'nl'), '1.234,5');
  assert.equal(getalTekst(1234.5, 'en'), '1,234.5');
});

test('getalTekst rondt af op drie decimalen', () => {
  assert.equal(getalTekst(1.23456, 'en'), '1.235');
});

test('getalTekst gebruikt een echt minteken', () => {
  assert.equal(getalTekst(-5, 'en'), '−5');
});

test('getalTekst valt terug op een ruwe afronding bij een onbekende taal', () => {
  assert.equal(getalTekst(2.5, 'zzz-onbekend'), '2.5');
});
```

- [ ] **Step 4: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/pdf/cad-export.test.mjs
```

Verwacht: FAIL, `getalTekst is not a function` of `does not provide an export named 'getalTekst'`.

- [ ] **Step 5: Verplaats de functie**

Knip uit `open-pdf-studio/js/pdf/cad-import-logica.js` de regels 317-326 en zet ze in `open-pdf-studio/js/pdf/cad-export-logica.js`, met de doc-comment mee:

```js
/** Getal in de notatie van de taal, met een echt minteken. */
export function getalTekst(n, taal) {
  let tekst;
  try {
    tekst = new Intl.NumberFormat(taal || undefined, { maximumFractionDigits: 3 }).format(n);
  } catch {
    tekst = String(Math.round(n * 1000) / 1000);
  }
  return tekst.replace(/^-/, '−');
}
```

Zet in `cad-import-logica.js` op die plek een doorexport terug, zodat bestaande afnemers van de importkant niets merken:

```js
export { getalTekst } from './cad-export-logica.js';
```

Controleer of `cad-import-logica.js` de functie zelf nog gebruikt:

```bash
cd open-pdf-studio && grep -n "getalTekst" js/pdf/cad-import-logica.js
```

Gebruikt hij hem zelf, zet dan bovenaan een gewone `import { getalTekst } from './cad-export-logica.js';` en laat de doorexport ernaast staan.

- [ ] **Step 6: Laat `CadExportDialog.jsx` de nieuwe plek gebruiken**

In `open-pdf-studio/js/solid/components/dialogs/CadExportDialog.jsx`, verwijder regel 15:

```js
import { getalTekst } from '../../../pdf/cad-import-logica.js';
```

en voeg `getalTekst` toe aan de bestaande importlijst uit `cad-export-logica.js` op regel 10-14, achter `modelOorsprongMogelijk`.

- [ ] **Step 7: Controleer dat er geen statische boog meer is naar `cad-import-logica.js`**

```bash
cd open-pdf-studio && grep -rn "cad-import-logica" js --include=*.js --include=*.jsx | grep -v "await import\|= import("
```

Verwacht: alleen de doorexport-regel in `cad-import-logica.js` zelf en de dynamische importen. Blijft er een statische importeur over, noteer die: die moet in dezelfde taak mee.

- [ ] **Step 8: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/pdf/cad-export.test.mjs
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 9: Commit**

```bash
git add open-pdf-studio/js/ui/chrome/dialogs.js open-pdf-studio/js/pdf/cad-export-logica.js \
        open-pdf-studio/js/pdf/cad-import-logica.js \
        open-pdf-studio/js/solid/components/dialogs/CadExportDialog.jsx \
        open-pdf-studio/js/pdf/cad-export.test.mjs
git commit -m "refactor(bundle): cut the two static edges that pin dialogs and CAD into the entry chunk (#454)"
```

### Task 2: de MCP-brug lui maken

`js/mcp-bridge.js` is 2 918 regels en zit in de hoofdchunk terwijl hij alleen werk doet als de app met `--mcp-server` draait. Hij haalt intern al alles lui op (130 dynamische importen), dus hij sleept vrijwel niets mee. Eén ding moet blijven: de console-ringbuffer op regel 30-66 wordt bij het laden van de module gezet en door `js/solid/components/MiniLog.jsx:77` uit `window.__consoleRing` gelezen.

**Files:**
- Create: `open-pdf-studio/js/core/console-ring.js`
- Modify: `open-pdf-studio/js/mcp-bridge.js` — regels 30-66 weg, vervangen door een import
- Modify: `open-pdf-studio/js/main.js:75` en `:243`
- Test: `open-pdf-studio/js/core/console-ring.test.mjs`

**Interfaces:**
- Consumes: niets.
- Produces: `js/core/console-ring.js` exporteert `CONSOLE_RING: Array<{t: number, level: string, text: string}>`, `CONSOLE_RING_MAX: number` (500) en `startConsoleCapture(): void`. `startConsoleCapture()` is idempotent: twee aanroepen patchen `console` één keer.

- [ ] **Step 1: Schrijf de falende test**

Maak `open-pdf-studio/js/core/console-ring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('de ring vangt alleen regels die het patroon matchen', async () => {
  globalThis.window = globalThis;
  const { CONSOLE_RING, startConsoleCapture } = await import('./console-ring.js');
  startConsoleCapture();
  const origineel = console.log;
  console.log('[render] pagina 3 klaar');
  console.log('iets willekeurigs zonder markering');
  assert.equal(CONSOLE_RING.length, 1);
  assert.match(CONSOLE_RING[0].text, /\[render\]/);
  assert.equal(CONSOLE_RING[0].level, 'log');
  assert.equal(typeof CONSOLE_RING[0].t, 'number');
  console.log = origineel;
});

test('startConsoleCapture patcht console maar één keer', async () => {
  globalThis.window = globalThis;
  const { startConsoleCapture } = await import('./console-ring.js');
  startConsoleCapture();
  const na1 = console.log;
  startConsoleCapture();
  assert.equal(console.log, na1);
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/core/console-ring.test.mjs
```

Verwacht: FAIL, module niet gevonden.

- [ ] **Step 3: Maak de module**

Maak `open-pdf-studio/js/core/console-ring.js` met de inhoud van `js/mcp-bridge.js:30-66`, letterlijk, met één toevoeging: de `patchConsole`-IIFE wordt een geëxporteerde, idempotente functie.

```js
// Console-ringbuffer voor observatie door MCP en de MiniLog.
//
// Vangt de laatste N consoleregels waarvan de tekst het observatiepatroon
// matcht. De MCP-opdracht `app_get_recent_console` leest deze ring, en
// MiniLog.jsx leest hem via window.__consoleRing zonder IPC-ronde.
//
// Deze module stond tot issue #454 in mcp-bridge.js. Hij staat hier apart
// zodat mcp-bridge.js lui geladen kan worden terwijl de opname vanaf de
// eerste regel van de app loopt.
export const CONSOLE_RING = [];
export const CONSOLE_RING_MAX = 500;

// Ring op window zodat in-app UI (MiniLog) recente motorgebeurtenissen kan
// lezen. De MCP-handler leest dezelfde array — één bron van waarheid.
try { window.__consoleRing = CONSOLE_RING; } catch { /* noop */ }

// Patronen die de renderpijplijn gebruikt. Vul aan als er een subsysteem bij
// komt dat opgenomen moet worden.
const CONSOLE_CAPTURE_RE = /\[render\]|\[tile\]|\[wheel-zoom\]|\[PERF\]|\[pre-render\]|\[thumb\]|\[bitmap-orch\]|\[tile-orch\]|\[prog\]|\[prog-guard\]|\[pbc\]|\[bo\]|STALE|JANK/;

function capture(level, args) {
  try {
    const s = args.map((a) => (typeof a === 'string' ? a : (a && a.message) ? a.message : String(a))).join(' ');
    if (!CONSOLE_CAPTURE_RE.test(s)) return;
    CONSOLE_RING.push({ t: Date.now(), level, text: s });
    if (CONSOLE_RING.length > CONSOLE_RING_MAX) CONSOLE_RING.shift();
  } catch {
    // Opslikken — observatie MAG de app nooit laten vallen.
  }
}

let gepatcht = false;

/** Patcht console.log/warn/error zodat ze door de ring lopen. Idempotent. */
export function startConsoleCapture() {
  if (gepatcht) return;
  gepatcht = true;
  const ORIG_LOG = console.log;
  const ORIG_WARN = console.warn;
  const ORIG_ERROR = console.error;
  console.log = function (...args) { capture('log', args); ORIG_LOG.apply(console, args); };
  console.warn = function (...args) { capture('warn', args); ORIG_WARN.apply(console, args); };
  console.error = function (...args) { capture('error', args); ORIG_ERROR.apply(console, args); };
}
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/core/console-ring.test.mjs
```

Verwacht: PASS, 2 tests.

- [ ] **Step 5: Laat `mcp-bridge.js` de module gebruiken**

Verwijder in `open-pdf-studio/js/mcp-bridge.js` de regels 30 t/m 66 en zet er één import voor in de plaats, direct onder de bestaande kopcomment:

```js
import { CONSOLE_RING, CONSOLE_RING_MAX } from './core/console-ring.js';
```

`handleGetRecentConsole` gebruikt `CONSOLE_RING` op regel 676 en `CONSOLE_RING`/`CONSOLE_RING_MAX` op 683-684; die regels blijven ongewijzigd werken.

- [ ] **Step 6: Start de opname vanuit `main.js` en maak de brug lui**

In `open-pdf-studio/js/main.js`: vervang de statische import op regel 75

```js
import { initMcpBridge } from './mcp-bridge.js';
```

door

```js
import { startConsoleCapture } from './core/console-ring.js';
```

en zet de aanroep van `startConsoleCapture()` zo vroeg mogelijk neer — direct onder `recordStartupDiagnostic('frontend-boot-start');` op regel 16, vóór alle andere imports hun werk doen.

Vervang daarna de aanroep op regel 243

```js
initMcpBridge().catch(e => console.warn('initMcpBridge failed:', e));
```

door

```js
// De MCP-brug is 2 900 regels die alleen werk doen wanneer de app met
// --mcp-server draait. Buiten Tauri is initMcpBridge() sowieso een no-op,
// dus we halen de module pas op als window.__TAURI__ bestaat.
if (window.__TAURI__?.core?.invoke) {
  import('./mcp-bridge.js')
    .then((m) => m.initMcpBridge())
    .catch((e) => console.warn('initMcpBridge failed:', e));
}
```

- [ ] **Step 7: Controleer dat niemand anders `mcp-bridge.js` statisch importeert**

```bash
cd open-pdf-studio && grep -rn "mcp-bridge" js --include=*.js --include=*.jsx --include=*.ts | grep -v "^js/mcp-bridge.js" | grep -v "await import\|import("
```

Verwacht: alleen commentregels (in `js/pdf/cad-export-opdracht.js`, `js/pdf/cad-mcp-opdracht.js`, `js/pdf/print-opdracht.js`, `js/solid/components/MiniLog.jsx`). Geen importregel.

- [ ] **Step 8: Draai tests en build, en controleer de chunk**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
cd open-pdf-studio && ls -S dist/assets/*.js | head -5
```

Verwacht: er staat nu een aparte chunk met `mcp-bridge` in de naam, en de `index-*.js` is kleiner dan vóór deze taak.

- [ ] **Step 9: Controleer de MiniLog in de draaiende app**

Start de rig (zie `docs/release-testprotocol.md`), open een zwaar blad, zoom in, en kijk of de MiniLog nog regels toont. De opname loopt nu vanuit `main.js` in plaats van vanuit de brug; dit is de enige gedragsrisico van deze taak.

- [ ] **Step 10: Commit**

```bash
git add open-pdf-studio/js/core/console-ring.js open-pdf-studio/js/core/console-ring.test.mjs \
        open-pdf-studio/js/mcp-bridge.js open-pdf-studio/js/main.js
git commit -m "refactor(bundle): load the MCP bridge on demand, keep the console ring eager (#454)"
```

### Task 3: alle 47 vensters lui

`js/solid/components/DialogHost.jsx` is 127 regels en houdt 10 547 regels in de hoofdchunk. `lazy()` uit `solid-js` wordt nog nergens in de repo gebruikt; deze taak introduceert het patroon.

**Files:**
- Modify: `open-pdf-studio/js/solid/components/DialogHost.jsx` — 47 statische imports worden `lazy()`, de zeven altijd-gemonteerde overlays blijven statisch

**Interfaces:**
- Consumes: Task 1 (zonder die taak splitst `PageSetupDialog` niet).
- Produces: `DialogHost` exporteert nog steeds standaard één component zonder props. `DIALOG_MAP` houdt dezelfde sleutels; de waarden zijn nu `lazy`-componenten in plaats van gewone.

- [ ] **Step 1: Zet de importkop om**

Vervang in `open-pdf-studio/js/solid/components/DialogHost.jsx` de regels 1-45 door:

```jsx
import { For, Suspense, lazy } from 'solid-js';
import { getDialogs } from '../stores/dialogStore.js';

// Elk venster is een eigen chunk. Een venster dat de gebruiker niet opent
// wordt nooit opgehaald; een venster dat hij opent wordt één keer opgehaald
// en blijft daarna in het geheugen. Zie issue #454.
const DocPropertiesDialog = lazy(() => import('./DocPropertiesDialog.jsx'));
const PreferencesDialog = lazy(() => import('./preferences/PreferencesDialog.jsx'));
const NewDocDialog = lazy(() => import('./dialogs/NewDocDialog.jsx'));
const InsertPageDialog = lazy(() => import('./dialogs/InsertPageDialog.jsx'));
const DeletePagesDialog = lazy(() => import('./dialogs/DeletePagesDialog.jsx'));
const PagePropertiesDialog = lazy(() => import('./dialogs/PagePropertiesDialog.jsx'));
const ExtractPagesDialog = lazy(() => import('./dialogs/ExtractPagesDialog.jsx'));
const MergePdfsDialog = lazy(() => import('./dialogs/MergePdfsDialog.jsx'));
const PrintDialog = lazy(() => import('./dialogs/PrintDialog.jsx'));
const PrintQueueDialog = lazy(() => import('./dialogs/PrintQueueDialog.jsx'));
const PageSetupDialog = lazy(() => import('./dialogs/PageSetupDialog.jsx'));
const WatermarkDialog = lazy(() => import('./dialogs/WatermarkDialog.jsx'));
const HeaderFooterDialog = lazy(() => import('./dialogs/HeaderFooterDialog.jsx'));
const ManageWatermarksDialog = lazy(() => import('./dialogs/ManageWatermarksDialog.jsx'));
const SignatureDialog = lazy(() => import('./dialogs/SignatureDialog.jsx'));
const TextAnnotationDialog = lazy(() => import('./dialogs/TextAnnotationDialog.jsx'));
const UpdateDialog = lazy(() => import('./dialogs/UpdateDialog.jsx'));
const BookmarkDialog = lazy(() => import('./dialogs/BookmarkDialog.jsx'));
const FormValidationDialog = lazy(() => import('./dialogs/FormValidationDialog.jsx'));
const StampPickerDialog = lazy(() => import('./dialogs/StampPickerDialog.jsx'));
const CalibrationDialog = lazy(() => import('./dialogs/CalibrationDialog.jsx'));
const ScaleDialog = lazy(() => import('./dialogs/ScaleDialog.jsx'));
const CropMarginsDialog = lazy(() => import('./dialogs/CropMarginsDialog.jsx'));
const StraightenDialog = lazy(() => import('./dialogs/StraightenDialog.jsx'));
const ShiftPageDialog = lazy(() => import('./dialogs/ShiftPageDialog.jsx'));
const OcrLanguageDialog = lazy(() => import('./dialogs/OcrLanguageDialog.jsx'));
const ResizePagesDialog = lazy(() => import('./dialogs/ResizePagesDialog.jsx'));
const CompressDialog = lazy(() => import('./dialogs/CompressDialog.jsx'));
const FeedbackDialog = lazy(() => import('./dialogs/FeedbackDialog.jsx'));
const MessageDialog = lazy(() => import('./dialogs/MessageDialog.jsx'));
const AboutDialog = lazy(() => import('./dialogs/AboutDialog.jsx'));
const WhatsNewDialog = lazy(() => import('./dialogs/WhatsNewDialog.jsx'));
const ShortcutsDialog = lazy(() => import('./dialogs/ShortcutsDialog.jsx'));
const ExtensionsDialog = lazy(() => import('./dialogs/ExtensionsDialog.jsx'));
const ConfirmDialog = lazy(() => import('./dialogs/ConfirmDialog.jsx'));
const HandtekeningDetailDialog = lazy(() => import('./dialogs/HandtekeningDetailDialog.jsx'));
const ViewportScaleDialog = lazy(() => import('./dialogs/ViewportScaleDialog.jsx'));
const ScaleRegionDialog = lazy(() => import('./dialogs/ScaleRegionDialog.jsx'));
const MeasuredLengthDialog = lazy(() => import('./dialogs/MeasuredLengthDialog.jsx'));
const TitleBlockDialog = lazy(() => import('./dialogs/TitleBlockDialog.jsx'));
const CompareDialog = lazy(() => import('./compare/CompareDialog.jsx'));
const CadExportDialog = lazy(() => import('./dialogs/CadExportDialog.jsx'));
const CadImportDialog = lazy(() => import('./dialogs/CadImportDialog.jsx'));
const StyleTypeEditorDialog = lazy(() => import('./dialogs/StyleTypeEditorDialog.jsx'));
const TekeninstellingenDialog = lazy(() => import('./dialogs/TekeninstellingenDialog.jsx'));
const SysteemtypenDialog = lazy(() => import('./dialogs/SysteemtypenDialog.jsx'));
const SysteemPaneelComponentDialog = lazy(() => import('./dialogs/SysteemPaneelComponentDialog.jsx'));
```

De zeven overlays die altijd gemonteerd staan blijven statische imports, want die renderen bij elke frame mee en hebben geen "openen"-moment:

```jsx
import TextEditOverlay from './TextEditOverlay.jsx';
import StavenreeksInlineEditor from './StavenreeksInlineEditor.jsx';
import ParametricLabelInlineEditor from './ParametricLabelInlineEditor.jsx';
import PdfTextEditOverlay from './PdfTextEditOverlay.jsx';
import StickyNotePopupHost from './StickyNotePopup.jsx';
import ParametricSymbolPicker from './dialogs/ParametricSymbolPicker.jsx';
import PrintProgressToast from './PrintProgressToast.jsx';
```

`DIALOG_MAP` (regels 58-106) blijft exact zoals hij is: dezelfde sleutels, dezelfde namen aan de rechterkant.

- [ ] **Step 2: Zet een `Suspense` om de `For`**

Een `lazy`-component schort op tot zijn chunk binnen is. Zonder `Suspense` slaat Solid dat op tot de dichtstbijzijnde grens, en die is hier de wortel van de app — dan flikkert de hele UI bij het eerste openen van een venster. Vervang daarom de `return` van `DialogHost`:

```jsx
export default function DialogHost() {
  return (
    <>
      {/* Suspense vangt het ophalen van de venster-chunk op. fallback is leeg:
          een venster dat nog binnenkomt is onzichtbaar, niet een spinner die
          één frame flitst. */}
      <Suspense fallback={null}>
        <For each={getDialogs()}>
          {(dialog) => {
            const Component = DIALOG_MAP[dialog.name];
            if (!Component) return null;
            return <Component data={dialog.data} />;
          }}
        </For>
      </Suspense>
      <TextEditOverlay />
      <StavenreeksInlineEditor />
      <ParametricLabelInlineEditor />
      <PdfTextEditOverlay />
      <StickyNotePopupHost />
      <ParametricSymbolPicker />
      <PrintProgressToast />
    </>
  );
}
```

- [ ] **Step 3: Bouw en tel de chunks**

```bash
cd open-pdf-studio && npx vite build
cd open-pdf-studio && ls dist/assets/*.js | wc -l
cd open-pdf-studio && ls -S dist/assets/index-*.js | head -1 | xargs stat -c%s
```

Verwacht: het aantal chunks springt naar ongeveer 50, en `index-*.js` is fors kleiner. Blijft het aantal chunks laag, dan is er nog een statische boog naar een venster; zoek hem met:

```bash
cd open-pdf-studio && grep -rn "components/dialogs/" js --include=*.js --include=*.jsx | grep -v "await import\|lazy(() => import"
```

- [ ] **Step 4: Open elk venster in de draaiende app**

Dit is de kern van de verificatie en er is geen unittest voor. Start de rig en open, één voor één, alle 47 vensters uit `DIALOG_MAP`. Let per venster op: het venster verschijnt, de titel is vertaald, de knoppen werken, en er staat geen fout in de console over een mislukte chunk. Noteer de doorlopen lijst in de PR-tekst.

Bijzondere aandacht voor:
- **`message` en `confirm`** — die worden vanuit foutpaden geopend, soms terwijl er al iets misgaat. Een venster dat pas ná een ronde binnenkomt mag een `showMessage()` niet laten vallen.
- **`update`** — wordt bij het opstarten geopend als er een nieuwe versie is.
- **`print`** — het zwaarste venster (1 003 regels) en het venster met de meeste eigen afhankelijkheden.
- **`cad-import` en `cad-export`** — pas na Task 1 daadwerkelijk gesplitst.

- [ ] **Step 5: Draai tests en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/solid/components/DialogHost.jsx
git commit -m "refactor(bundle): load all 47 dialogs on demand (#454)"
```

### Task 4: vergelijken en de bijwerker lui

**Files:**
- Modify: `open-pdf-studio/js/solid/App.jsx:24` — `CompareView` via `lazy()`
- Modify: `open-pdf-studio/js/solid/components/dialogs/UpdateDialog.jsx:4` — `@tauri-apps/plugin-process` dynamisch
- Modify: `open-pdf-studio/js/ui/chrome/updater.js:7` — `@tauri-apps/plugin-updater` dynamisch

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: niets nieuws.

- [ ] **Step 1: Kijk hoe `CompareView` wordt gemonteerd**

```bash
cd open-pdf-studio && grep -n "CompareView" js/solid/App.jsx
```

Staat het achter een `<Show when={…}>`, dan is `lazy()` genoeg. Staat het onvoorwaardelijk gemonteerd, dan moet er eerst een `<Show>` omheen op de bestaande vergelijk-modus-vlag uit `js/compare/compare-store.js`; anders wordt de chunk alsnog meteen opgehaald.

- [ ] **Step 2: Zet `CompareView` om**

Vervang in `open-pdf-studio/js/solid/App.jsx` regel 24:

```jsx
import CompareView from './components/compare/CompareView.jsx';
```

door

```jsx
// 1 190 regels vergelijk-UI plus js/compare/** (1 332 regels). Alleen nodig
// als de gebruiker twee documenten naast elkaar legt. Zie issue #454.
const CompareView = lazy(() => import('./components/compare/CompareView.jsx'));
```

en voeg `lazy` en `Suspense` toe aan de bestaande `solid-js`-import bovenaan. Zet `<Suspense fallback={null}>` om de plek waar `<CompareView />` wordt gerenderd.

- [ ] **Step 3: Zet de twee Tauri-plug-ins om**

In `open-pdf-studio/js/solid/components/dialogs/UpdateDialog.jsx`: haal de statische import van `@tauri-apps/plugin-process` weg en gebruik hem op de plek van de aanroep:

```jsx
const { relaunch } = await import('@tauri-apps/plugin-process');
await relaunch();
```

In `open-pdf-studio/js/ui/chrome/updater.js`: haal de statische import van `@tauri-apps/plugin-updater` weg en gebruik hem in de functie die de controle doet:

```js
const { check } = await import('@tauri-apps/plugin-updater');
const update = await check();
```

Zorg dat de omringende functie `async` is. Dit zijn de enige twee statische `@tauri-apps/*`-importen in de hele app; de rest gaat via het globale `__TAURI__`-object (zie de kopcomment van `js/core/platform.js`).

- [ ] **Step 4: Controleer in de draaiende app**

Start de app en open het vergelijkscherm. Controleer dat het document laadt, dat het schuiven synchroon loopt en dat de overlay-kleuren kloppen. Controleer daarna de bijwerkcontrole (Help → controleren op updates, of de automatische controle bij het opstarten).

- [ ] **Step 5: Draai tests en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/solid/App.jsx \
        open-pdf-studio/js/solid/components/dialogs/UpdateDialog.jsx \
        open-pdf-studio/js/ui/chrome/updater.js
git commit -m "refactor(bundle): load compare view and updater plugins on demand (#454)"
```

### Task 5: de waarschuwingsgrens terugzetten

`vite.config.js:38` zet `chunkSizeWarningLimit: 6000` — twaalf keer de standaard. Nu de ingangschunk kleiner is mag die grens weer iets betekenen.

**Files:**
- Modify: `open-pdf-studio/vite.config.js:38`

**Interfaces:**
- Consumes: Task 2, 3 en 4 (anders faalt de bouw op de waarschuwing).
- Produces: niets.

- [ ] **Step 1: Meet de werkelijke ingangschunk**

```bash
cd open-pdf-studio && npx vite build
cd open-pdf-studio && ls -S dist/assets/*.js | while read f; do printf '%8d  %s\n' "$(stat -c%s "$f")" "$f"; done | head -6
```

- [ ] **Step 2: Zet de grens net boven de grootste eigen chunk**

Vervang in `open-pdf-studio/vite.config.js` regel 38:

```js
    chunkSizeWarningLimit: 6000,
```

door de gemeten waarde in kB, afgerond naar boven op 100, met een comment:

```js
    // Net boven de grootste eigen chunk van dit moment. Loopt de bouw hier
    // tegenaan, dan is er iets de ingangschunk in gelekt: zoek de nieuwe
    // statische boog in plaats van de grens op te hogen. Zie issue #454.
    chunkSizeWarningLimit: 2200,
```

De pdf.js-worker (1,9 MB) en de mupdf-wasm zijn assets, geen chunks, en tellen hier niet mee.

- [ ] **Step 3: Bouw en controleer dat er geen waarschuwing valt**

```bash
cd open-pdf-studio && npx vite build
```

Verwacht: geen `Some chunks are larger than…`-waarschuwing. Valt hij wel, verhoog dan naar de gemeten waarde en noteer in de PR waarom.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/vite.config.js
git commit -m "build: lower the chunk size warning back to something meaningful (#454)"
```

### PR van fase 3

Titel: `refactor: load dialogs, compare, MCP bridge and CAD on demand (#454)`

De PR-tekst bevat de drie chunkgetallen vóór en na, de lijst van 47 handmatig geopende vensters, en één zin over de waarneembare verandering (het eerste openen van een venster kost één frame extra) voor de release-notes.

---

## Fase 4 — Eén regel, één plek

**Doel:** −800 regels. Twintig helper-families die nu 2 tot 29 keer zijn overgeschreven gaan terug naar één plek, met een test op die ene plek.

**Wat verandert er voor de gebruiker:** niets. Elke samenvoeging is óf byte-identiek, óf de verschillen zijn expliciet benoemd en de canonieke versie krijgt een parameter zodat beide gedragingen blijven bestaan.

**Branch:** `refactor/454-fase-4-een-regel-een-plek`

**Regel voor deze hele fase:** een helper wordt pas samengevoegd als de verschillen tussen de kopieën zijn opgeschreven. Staan er twee varianten die net niet hetzelfde doen, dan gaat de *ruimere* variant naar de canonieke plek en krijgen de krappere aanroepers een expliciete parameter. Nooit stilzwijgend de ene variant door de andere vervangen.

De taken staan op volgorde van risico. Task 1 t/m 4 zijn byte-identieke kopieën; Task 5 t/m 8 vragen een dunne adapter.

### Task 1: de `redraw()`-wrapper — 29 kopieën naar één

De grootste enkele post. Het lichaam is overal hetzelfde:

```js
if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
else redrawAnnotations();
```

**Files:**
- Modify: `open-pdf-studio/js/annotations/rendering/ui-state.js` — voeg `redrawActive()` toe
- Test: `open-pdf-studio/js/annotations/rendering/redraw-actief.test.mjs`
- Modify (verwijder de eigen wrapper, importeer `redrawActive`): `js/annotations/alignment.js:14`, `js/annotations/image-crop-overlay.js:39`, `js/annotations/segment-ops.js:33`, `js/annotations/z-order.js:208`, `js/quantities/schedule-drop.js:17`, `js/solid/components/ContextMenu.jsx:53`, `js/solid/components/dialogs/MeasuredLengthDialog.jsx:15`, `js/solid/components/dialogs/ScaleRegionDialog.jsx:24`, `js/solid/components/dialogs/SysteemtypenDialog.jsx:30`, `js/solid/components/dialogs/TekeninstellingenDialog.jsx:26`, `js/solid/components/dialogs/ViewportScaleDialog.jsx:39`, `js/solid/components/left-panel/panels/MeasurementsPanel.jsx:11`, `js/solid/components/TextEditOverlay.jsx:81`, `js/solid/stores/formatStore.js:61`, `js/solid/stores/imageEditStore.js:32`, `js/solid/stores/propertiesStore.js:212`, `js/tools/edit-ops.js:36`, `js/tools/g-move-mode.js:119`, `js/tools/g-rotate-mode.js:43`, `js/tools/keyboard-handlers.js:32`, `js/tools/manager.js:282`, `js/tools/tools/lengthen-tool.js:17`, `js/tools/tools/remove-image-tool.js:50`, `js/tools/tools/scale-region-tool.js:18`, `js/tools/tools/split-tool.js:18`, `js/tools/tools/vector-snippet-tool.js:25`, `js/tools/tools/viewport-tool.js:12`, `js/ui/panels/properties-panel.js:17`

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: `js/annotations/rendering/ui-state.js` exporteert `redrawActive(lightweight = false): void` — tekent het actieve document opnieuw, in de doorlopende of de enkele weergave, afhankelijk van `viewMode`. `lightweight` wordt doorgegeven aan `redrawAnnotations`/`redrawContinuous`.

- [ ] **Step 1: Schrijf de falende test**

Maak `open-pdf-studio/js/annotations/rendering/redraw-actief.test.mjs`. De echte `rendering.js` trekt het halve canvas mee, dus de test controleert de keuzeregel als pure functie. Voeg daarom naast `redrawActive` een pure `kiesHertekening(viewMode)` toe die de test wél kan laden:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiesHertekening } from './redraw-keuze.js';

test('de doorlopende weergave kiest de doorlopende hertekening', () => {
  assert.equal(kiesHertekening('continuous'), 'continuous');
});

test('elke andere weergave kiest de enkele hertekening', () => {
  assert.equal(kiesHertekening('single'), 'single');
  assert.equal(kiesHertekening('facing'), 'single');
  assert.equal(kiesHertekening(undefined), 'single');
  assert.equal(kiesHertekening(null), 'single');
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/annotations/rendering/redraw-actief.test.mjs
```

Verwacht: FAIL, module `./redraw-keuze.js` niet gevonden.

- [ ] **Step 3: Maak de pure keuzemodule**

Maak `open-pdf-studio/js/annotations/rendering/redraw-keuze.js`:

```js
// De keuzeregel achter redrawActive(), los van het canvas zodat hij te
// testen is onder node. Zie issue #454, fase 4.

/** 'continuous' of 'single' — welke hertekening bij deze weergavemodus hoort. */
export function kiesHertekening(viewMode) {
  return viewMode === 'continuous' ? 'continuous' : 'single';
}
```

- [ ] **Step 4: Voeg `redrawActive` toe aan `ui-state.js`**

In `open-pdf-studio/js/annotations/rendering/ui-state.js`:

```js
import { getActiveDocument } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../rendering.js';
import { kiesHertekening } from './redraw-keuze.js';

/**
 * Tekent het actieve document opnieuw, in de weergave die het document heeft.
 * Vervangt 29 identieke lokale redraw()-wrappers. Zie issue #454.
 */
export function redrawActive(lightweight = false) {
  if (kiesHertekening(getActiveDocument()?.viewMode) === 'continuous') {
    redrawContinuous(lightweight);
  } else {
    redrawAnnotations(lightweight);
  }
}
```

Controleer eerst of `ui-state.js` `rendering.js` al importeert; is dat niet zo, kijk dan of die import een laadcyclus maakt:

```bash
cd open-pdf-studio && grep -n "^import" js/annotations/rendering/ui-state.js
cd open-pdf-studio && grep -n "ui-state" js/annotations/rendering.js
```

Importeert `rendering.js` op zijn beurt `ui-state.js`, gebruik dan in `redrawActive` een luie import, net zoals `js/solid/stores/elementVisibilityStore.js:56` dat al doet:

```js
export function redrawActive(lightweight = false) {
  const doorlopend = kiesHertekening(getActiveDocument()?.viewMode) === 'continuous';
  import('../rendering.js').then((m) => {
    if (doorlopend) m.redrawContinuous(lightweight);
    else m.redrawAnnotations(lightweight);
  });
}
```

Let op: die variant is asynchroon. Gebruik hem alleen als er écht een cyclus is, en noteer dat in de PR-tekst, want het verandert de volgorde waarin een hertekening plaatsvindt.

- [ ] **Step 5: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/annotations/rendering/redraw-actief.test.mjs
```

Verwacht: PASS, 2 tests.

- [ ] **Step 6: Vervang de 28 wrappers, in groepen van zeven**

Per bestand: verwijder de lokale `redraw`/`_redraw`-functie, voeg bovenaan toe

```js
import { redrawActive } from '<relatief pad>/annotations/rendering/ui-state.js';
```

en hernoem de aanroepplekken van `redraw()` / `_redraw()` naar `redrawActive()`. Haal de dan ongebruikte importen van `redrawAnnotations` en `redrawContinuous` weg. Blijft één van beide in hetzelfde bestand nog rechtstreeks gebruikt, laat die import dan staan.

**Drie uitzonderingen — niet vervangen:**

1. `js/tools/tool-dispatcher.js:140` — die wrapper doet méér: hij houdt het eigenschappenpaneel tegen zolang er gesleept wordt. Laat staan.
2. `js/annotations/z-order.js:208` `redrawAndRefresh` — die roept daarnaast het paneel bij. Vervang alleen het hertekengedeelte door `redrawActive()`; laat de paneelaanroep staan.
3. `js/solid/stores/elementVisibilityStore.js:56` — die gebruikt al een luie import om een laadcyclus te vermijden. Vervang alleen als Step 4 tot de synchrone variant heeft geleid.

Commit per groep van zeven bestanden.

- [ ] **Step 7: Controleer dat er geen lokale wrapper meer over is**

```bash
cd open-pdf-studio && grep -rn -B2 "redrawContinuous()" js --include=*.js --include=*.jsx | grep -c "viewMode === 'continuous'"
```

Verwacht: aanzienlijk lager dan de 81 van vóór deze taak. Wat overblijft zijn de inline-kopieën (Step 8) en de drie uitzonderingen.

- [ ] **Step 8: Vervang ook de inline-kopieën**

Zoek de plekken waar de tweeregelige schakelaar inline staat in plaats van in een wrapper:

```bash
cd open-pdf-studio && grep -rn "viewMode === 'continuous'" js --include=*.js --include=*.jsx
```

Bekende plekken: `js/annotations/clipboard.js` 184/239/329/386, `js/annotations/stamps.js` 199/218, `js/annotations/image-drop.js:63`, `js/annotations/z-order.js:30`, `js/bcf/bcf-ui.js:140`, `js/pdf/cad-import.js:294`, `js/mcp-bridge.js:961`. Vervang elk blok door `redrawActive();`. Sla plekken over waar `viewMode` voor iets ánders dan hertekenen wordt getest (bijvoorbeeld een lay-outbeslissing).

- [ ] **Step 9: Draai tests en build, en controleer in de app**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

Start daarna de rig en controleer in beide weergavemodi: een annotatie verplaatsen, een eigenschap wijzigen, plakken, een symbool schalen. Het beeld moet na elke handeling meteen kloppen.

- [ ] **Step 10: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(render): one redrawActive() instead of 29 identical wrappers (#454)"
```

### Task 2: `clamp`, `approxTextWidth` en de hoeknormalisatie

Drie families die byte-identiek zijn overgeschreven.

**Files:**
- Modify: `open-pdf-studio/js/utils/math.js` — voeg `clamp`, `normDeg` en `kwartslag` toe
- Create: `open-pdf-studio/js/annotations/tekstmaat.js`
- Test: `open-pdf-studio/js/utils/math.test.mjs`
- Test: `open-pdf-studio/js/annotations/tekstmaat.test.mjs`
- Modify: `js/annotations/betonbalk.js` (verwijder `clamp` op 94 en `approxTextWidth` op 166), `js/annotations/stavenreeks.js` (150, 415), `js/annotations/systeemraster.js` (292, 440)
- Modify: de 32 plekken met `((x % 360) + 360) % 360` — zie Step 6

**Interfaces:**
- Consumes: niets.
- Produces:
  - `js/utils/math.js` exporteert daarnaast `clamp(v: number, lo: number, hi: number): number`, `normDeg(graden: number): number` (0 ≤ resultaat < 360, niet-getallen worden 0) en `kwartslag(graden: number): 0|90|180|270` (afgerond op het dichtstbijzijnde veelvoud van 90, daarna genormaliseerd).
  - `js/annotations/tekstmaat.js` exporteert `approxTextWidth(text: unknown, fontSize: number): number`.

- [ ] **Step 1: Schrijf de falende tests**

Maak `open-pdf-studio/js/utils/math.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, normDeg, kwartslag } from './math.js';

test('clamp houdt een waarde binnen de grenzen', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

test('normDeg brengt elke hoek naar 0 tot en met 359', () => {
  assert.equal(normDeg(0), 0);
  assert.equal(normDeg(90), 90);
  assert.equal(normDeg(360), 0);
  assert.equal(normDeg(450), 90);
  assert.equal(normDeg(-90), 270);
  assert.equal(normDeg(-450), 270);
});

test('normDeg maakt van rommel een nul', () => {
  assert.equal(normDeg(undefined), 0);
  assert.equal(normDeg(null), 0);
  assert.equal(normDeg(NaN), 0);
  assert.equal(normDeg('90'), 90);
});

test('kwartslag rondt af op het dichtstbijzijnde kwart', () => {
  assert.equal(kwartslag(0), 0);
  assert.equal(kwartslag(44), 0);
  assert.equal(kwartslag(46), 90);
  assert.equal(kwartslag(91), 90);
  assert.equal(kwartslag(-90), 270);
  assert.equal(kwartslag(359), 0);
});
```

Maak `open-pdf-studio/js/annotations/tekstmaat.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxTextWidth } from './tekstmaat.js';

test('approxTextWidth schaalt met de tekstlengte en de lettergrootte', () => {
  assert.equal(approxTextWidth('abcd', 10), 4 * 10 * 0.55);
  assert.equal(approxTextWidth('', 10), 0);
});

test('approxTextWidth zet niet-tekst eerst om', () => {
  assert.equal(approxTextWidth(1234, 10), 4 * 10 * 0.55);
});
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

```bash
cd open-pdf-studio && node --test js/utils/math.test.mjs js/annotations/tekstmaat.test.mjs
```

Verwacht: FAIL — `clamp`, `normDeg`, `kwartslag` bestaan niet en `tekstmaat.js` bestaat niet.

- [ ] **Step 3: Vul `js/utils/math.js` aan**

Voeg onderaan `open-pdf-studio/js/utils/math.js` toe:

```js
/** Houdt `v` binnen [lo, hi]. Verving drie byte-identieke lokale kopieën. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** Hoek in graden naar het bereik [0, 360). Niet-getallen worden 0. */
export function normDeg(graden) {
  const n = Number(graden);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/** Hoek naar de dichtstbijzijnde kwartslag: 0, 90, 180 of 270. */
export function kwartslag(graden) {
  return normDeg(Math.round(normDeg(graden) / 90) * 90);
}
```

- [ ] **Step 4: Maak `js/annotations/tekstmaat.js`**

```js
// Ruwe breedteschatting voor tekst op canvas en in een verschijningsvorm.
// Stond tot issue #454 drie keer byte-identiek in betonbalk.js,
// stavenreeks.js en systeemraster.js.

/** Geschatte breedte in dezelfde eenheid als `fontSize`. */
export function approxTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.55;
}
```

- [ ] **Step 5: Draai de tests en controleer dat ze slagen**

```bash
cd open-pdf-studio && node --test js/utils/math.test.mjs js/annotations/tekstmaat.test.mjs
```

Verwacht: PASS, 6 tests.

- [ ] **Step 6: Vervang de kopieën**

`clamp`: verwijder de definitie in `js/annotations/betonbalk.js:94`, `js/annotations/stavenreeks.js:150` en `js/annotations/systeemraster.js:292`, en zet in elk bestand bovenaan:

```js
import { clamp } from '../utils/math.js';
```

`approxTextWidth`: verwijder de definitie in `js/annotations/betonbalk.js:166`, `js/annotations/stavenreeks.js:415` en `js/annotations/systeemraster.js:440`, en importeer uit `./tekstmaat.js`. Let op: alle drie waren `export`; controleer wie ze importeerde:

```bash
cd open-pdf-studio && grep -rn "approxTextWidth" js --include=*.js --include=*.jsx --include=*.mjs
```

Wie hem importeerde uit een van die drie modules, importeert hem voortaan uit `js/annotations/tekstmaat.js`.

`normDeg`: vervang op elk van deze plekken de uitdrukking `((… % 360) + 360) % 360` door `normDeg(…)`:

`js/annotations/systeemraster.js:649`, `js/annotations/transforms.js:203` en `:1145`, `js/annotations/handles.js:833`, `js/core/state.ts:343`, `js/pdf/cad-export-logica.js:78`, `js/pdf/loader/gedraaide-vorm-maat.js:60`, `js/pdf/loader/tekstvak-rotatie.js` 50/65/103/105, `js/pdf/loader/annotation-converter.js:1456`, `js/pdf/pdf-viewports.js:65` en `:331`, `js/pdf/progressive-render.js:283` (twee keer in één uitdrukking), `js/pdf/renderer.js:2202` en `:2456`, `js/pdf/resize-pages.js:83`, `js/pdf/saver.js:117`.

`kwartslag`: vervang `((Math.round(… / 90) * 90) % 360 + 360) % 360` op `js/pdf/print-vector.js:34`, `js/pdf/saver/vector-snippet.js:40`, `js/pdf/vector-embed.js:54`, `:62` en `:131`.

**Laat `js/text/text-edit-appearance.js:1` `normalizePageRotation` met rust.** Die doet iets anders: hij geeft 0 terug voor alles wat geen exact veelvoud van 90 is, in plaats van af te ronden. Dat is een bewuste strengere regel op het pad van de tekstrotatie; zie de rotatie-regressiegeschiedenis. Laat hem staan en laat hem intern `normDeg` gebruiken:

```js
export function normalizePageRotation(rotation) {
  const normalized = normDeg(rotation);
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}
```

- [ ] **Step 7: Draai de rotatie-regressie**

Dit raakt `saver.js`, `renderer.js` en het laadpad. Volgens het vastgelegde protocol is een volledige sweep hier verplicht:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-tekstrotatie.mjs
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-mupdf-compare.mjs
```

Alle vier moeten groen. Een gevlagde pagina in de sweep wordt handmatig beoordeeld en het oordeel genoteerd.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/utils/math.js open-pdf-studio/js/utils/math.test.mjs \
        open-pdf-studio/js/annotations/tekstmaat.js open-pdf-studio/js/annotations/tekstmaat.test.mjs \
        open-pdf-studio/js
git commit -m "refactor(math): one clamp, one degree normaliser, one text width estimate (#454)"
```

### Task 3: id-generatie

Dertien benoemde generators en nog eens 25 inline-kopieën, met vier verschillende suffixlengtes. `js/solid/stores/stylePresetsStore.js:159` en `js/pdf/saver/style-presets.js:69` maken id's in dezelfde naamruimte (`sp_`) met verschillende lengtes — dat is een latente botsing, geen stijlkwestie.

**Files:**
- Modify: `open-pdf-studio/js/utils/helpers.js` — voeg `newId` toe
- Test: `open-pdf-studio/js/utils/helpers.test.mjs`
- Modify: `js/tools/edit-ops.js:51`, `js/annotations/segment-ops.js:38`, `js/tools/tools/split-tool.js:23`, `js/annotations/paste-in-place.js:18`, `js/solid/stores/stylePresetsStore.js:159`, `js/pdf/saver/style-presets.js:69`, `js/solid/stores/schedulesStore.js:66`, `js/solid/components/dialogs/WatermarkDialog.jsx:10`, `js/solid/components/dialogs/HeaderFooterDialog.jsx:10`, `js/ui/panels/bookmarks.js:179`, `js/annotations/systeem-typen.js:35` en `:56`, `js/drafting/tekeningtype.js:218`

**Interfaces:**
- Consumes: niets.
- Produces: `js/utils/helpers.js` exporteert daarnaast `newId(prefix = '', lengte = 9): string` — `prefix` + basis-36-tijdstempel + `lengte` willekeurige basis-36-tekens.

- [ ] **Step 1: Schrijf de falende test**

Maak `open-pdf-studio/js/utils/helpers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from './helpers.js';

test('newId geeft een unieke waarde', () => {
  const gezien = new Set();
  for (let i = 0; i < 2000; i++) gezien.add(newId());
  assert.equal(gezien.size, 2000);
});

test('newId zet het voorvoegsel vooraan', () => {
  assert.match(newId('sp_'), /^sp_/);
  assert.match(newId('wm-'), /^wm-/);
});

test('newId houdt de gevraagde lengte aan', () => {
  const zonder = newId('', 9);
  const kort = newId('', 5);
  assert.ok(zonder.length > kort.length);
  assert.equal(zonder.length - kort.length, 4);
});

test('newId bevat alleen tekens die veilig zijn in een PDF-naam', () => {
  for (let i = 0; i < 200; i++) assert.match(newId('x_'), /^x_[0-9a-z]+$/);
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/utils/helpers.test.mjs
```

Verwacht: FAIL, `newId` bestaat niet.

- [ ] **Step 3: Voeg `newId` toe**

In `open-pdf-studio/js/utils/helpers.js`:

```js
/**
 * Eén id-conventie voor de hele app: basis-36-tijdstempel plus willekeur.
 * Verving dertien generators met vier verschillende suffixlengtes; twee
 * daarvan deelden een naamruimte met ongelijke lengtes. Zie issue #454.
 */
export function newId(prefix = '', lengte = 9) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 2 + lengte);
}
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/utils/helpers.test.mjs
```

Verwacht: PASS, 4 tests.

- [ ] **Step 5: Vervang de generators**

| Bestand:regel | Was | Wordt |
|---|---|---|
| `js/tools/edit-ops.js:51` | `newAnnotationId()` | `export const newAnnotationId = () => newId('', 9);` — de naam blijft, want 12 bestanden importeren hem |
| `js/annotations/segment-ops.js:38` | `_newId()` | verwijderen, `newId` importeren |
| `js/tools/tools/split-tool.js:23` | `_newId()` | verwijderen, `newId` importeren |
| `js/annotations/paste-in-place.js:18` | `defaultIdGenerator()` | `() => newId('', 9)` — **let op**: gebruikte `substr(2, 9)`, dus 9 tekens; gelijk |
| `js/solid/stores/stylePresetsStore.js:159` | `_newId()` met `slice(2,7)` | `newId('sp_', 8)` — **langer dan voorheen** |
| `js/pdf/saver/style-presets.js:69` | inline met `slice(2,10)` | `newId('sp_', 8)` — **korter dan voorheen** |
| `js/solid/stores/schedulesStore.js:66` | `newId()` met `'s'` | `newId('s', 9)` |
| `js/solid/components/dialogs/WatermarkDialog.jsx:10` | `generateId()` | `newId('wm-', 5)` |
| `js/solid/components/dialogs/HeaderFooterDialog.jsx:10` | `generateId()` | `newId('wm-', 5)` |
| `js/ui/panels/bookmarks.js:179` | `generateId()` met `'bm_'` | `newId('bm_', 9)` |
| `js/annotations/systeem-typen.js:35` | inline `'st-'` | `newId('st-', 9)` |
| `js/annotations/systeem-typen.js:56` | inline `'pt-'` | `newId('pt-', 9)` |
| `js/drafting/tekeningtype.js:218` | inline `'tt-'` | `newId('tt-', 9)` |

De twee `sp_`-regels krijgen dezelfde lengte 8; dat is de hele reden om ze samen te voegen. Controleer daarna of er geen opgeslagen voorinstelling stukgaat:

```bash
cd open-pdf-studio && node --test js/solid/stores/print-instellingen.test.mjs
```

En handmatig in de rig: maak een stijlvoorinstelling aan, sla het document op, heropen het, en controleer dat de voorinstelling er nog is.

**Niet aanraken:** `js/bcf/bcf-mapping.js:55` `genGuid` — dat is een echte RFC-4122-v4 met `crypto.randomUUID` als voorkeur. BCF eist een GUID; die hoort niet in deze familie.

**Niet aanraken:** `js/utils/helpers.js:12` `generateImageId` — die gebruikt een decimale tijdstempel en staat in opgeslagen documenten. Wijzigen breekt bestaande verwijzingen naar ingebedde afbeeldingen.

- [ ] **Step 6: Vervang de inline-kopieën waar de vorm exact hetzelfde is**

```bash
cd open-pdf-studio && grep -rn "Math.random().toString(36)" js --include=*.js --include=*.jsx --include=*.ts
```

Vervang alleen de regels die `Date.now().toString(36) + Math.random().toString(36).slice|substr(2, N)` zijn. **Sla over**: `js/core/stores/document-helpers.ts:8`, `js/text/text-edit-appearance.js:701` en `js/tools/text-edit-tool.js:1328` — die gebruiken een decimale `Date.now()` en hebben dus een andere id-vorm. Noteer die drie in de PR-tekst als openstaand.

- [ ] **Step 7: Draai tests, build en de opslag-rondgang**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-opslag-duplicaten.mjs
```

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(ids): one id generator instead of thirteen with four different lengths (#454)"
```

### Task 4: kleur — vier hex-lezers naar één

`js/pdf/saver.js` importeert vandaag `hexToColorArray` uit `js/utils/colors.js` (41 aanroepen) én `hexToRgb` uit `js/pdf/saver/utils.js` (9 aanroepen). Twee namen, dezelfde regex, hetzelfde resultaat, één bestand.

**Files:**
- Modify: `open-pdf-studio/js/utils/colors.js` — voeg `rgbTripleToHex` en `darken` toe
- Test: `open-pdf-studio/js/utils/colors.test.mjs`
- Modify: `js/pdf/saver/utils.js:7` (`hexToRgb` wordt een doorexport), `js/pdf/saver/bookmarks.js:71` (`hexToRgbArr`), `js/pdf/saver/watermarks.js:58` (`hexToRgbObj`), `js/annotations/rendering/comment-icons.js:4` (`darken`), `js/solid/components/StickyNotePopup.jsx:26` (`darken`), `js/pdf/loader/pdf-helpers.js:132` (`pdfColorToHex`), `js/annotations/xfdf.js:411` (`xfdfColorToHex`)

**Interfaces:**
- Consumes: niets.
- Produces: `js/utils/colors.js` exporteert daarnaast:
  - `rgbTripleToHex(r: number, g: number, b: number): string` — drie waarden 0-1 naar `#rrggbb`.
  - `darken(hex: string, amount = 0.3): string` — `#rrggbb` naar `rgb(r,g,b)`, elk kanaal vermenigvuldigd met `1 - amount`.
  `hexToColorArray` behoudt zijn bestaande gedrag: `[0, 0, 0]` bij een ongeldige invoer.

- [ ] **Step 1: Schrijf de falende test**

Maak `open-pdf-studio/js/utils/colors.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToColorArray, colorArrayToHex, rgbTripleToHex, darken } from './colors.js';

test('hexToColorArray leest met en zonder hekje', () => {
  assert.deepEqual(hexToColorArray('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexToColorArray('ff0000'), [1, 0, 0]);
});

test('hexToColorArray geeft zwart bij rommel', () => {
  assert.deepEqual(hexToColorArray('geen kleur'), [0, 0, 0]);
  assert.deepEqual(hexToColorArray(''), [0, 0, 0]);
  assert.deepEqual(hexToColorArray(null), [0, 0, 0]);
});

test('rgbTripleToHex is de omgekeerde van hexToColorArray', () => {
  assert.equal(rgbTripleToHex(1, 0, 0), '#ff0000');
  assert.equal(rgbTripleToHex(0, 0, 0), '#000000');
  assert.equal(rgbTripleToHex(1, 1, 1), '#ffffff');
  const [r, g, b] = hexToColorArray('#3c7a1e');
  assert.equal(rgbTripleToHex(r, g, b), '#3c7a1e');
});

test('colorArrayToHex herkent zowel 0-1 als 0-255', () => {
  assert.equal(colorArrayToHex([1, 0, 0]), '#ff0000');
  assert.equal(colorArrayToHex([255, 0, 0]), '#ff0000');
});

test('darken maakt elk kanaal donkerder met de gevraagde factor', () => {
  assert.equal(darken('#646464', 0.5), 'rgb(50,50,50)');
  assert.equal(darken('#000000', 0.3), 'rgb(0,0,0)');
});

test('darken gebruikt 0,3 als standaard', () => {
  assert.equal(darken('#646464'), darken('#646464', 0.3));
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/utils/colors.test.mjs
```

Verwacht: FAIL, `rgbTripleToHex` en `darken` bestaan niet.

- [ ] **Step 3: Vul `js/utils/colors.js` aan**

```js
/** Drie kanalen 0-1 naar #rrggbb. De omgekeerde van hexToColorArray. */
export function rgbTripleToHex(r, g, b) {
  const kanaal = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${kanaal(r)}${kanaal(g)}${kanaal(b)}`;
}

/** #rrggbb donkerder maken, als rgb()-tekenreeks voor canvas. */
export function darken(hex, amount = 0.3) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - amount;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/utils/colors.test.mjs
```

Verwacht: PASS, 6 tests.

- [ ] **Step 5: Vervang de vier hex-lezers**

`js/pdf/saver/utils.js:7`: vervang de functie door een doorexport onder de bestaande naam, zodat de 43 aanroepen ongewijzigd blijven:

```js
export { hexToColorArray as hexToRgb } from '../../utils/colors.js';
```

`js/pdf/saver/bookmarks.js:71` `hexToRgbArr`: **gedraagt zich anders** — hij geeft `null` bij een ongeldige hex, waar de canonieke `[0, 0, 0]` geeft. De aanroeper gebruikt dat verschil om "geen kleur" van "zwart" te onderscheiden. Laat de functie staan, maar laat hem de canonieke gebruiken voor het rekenwerk:

```js
import { hexToColorArray } from '../../utils/colors.js';

function hexToRgbArr(hex) {
  if (!/^#?([a-f\d]{2}){3}$/i.test(hex)) return null;
  return hexToColorArray(hex);
}
```

`js/pdf/saver/watermarks.js:58` `hexToRgbObj`:

```js
import { hexToColorArray } from '../../utils/colors.js';

function hexToRgbObj(hex) {
  const [r, g, b] = hexToColorArray(hex);
  return rgb(r, g, b);
}
```

Let op: de oude versie gaf `rgb(0,0,0)` bij rommel; de nieuwe ook, want `hexToColorArray` geeft dan `[0,0,0]`. Gedrag gelijk.

`js/annotations/rendering/comment-icons.js:4` en `js/solid/components/StickyNotePopup.jsx:26`: verwijder de lokale `darken` en importeer hem. StickyNotePopup roept hem aan met `0.15`; die aanroep blijft `darken(kleur, 0.15)`.

- [ ] **Step 6: Laat de twee hex-schrijvers de nieuwe primitief gebruiken**

`js/pdf/loader/pdf-helpers.js:132` `pdfColorToHex` en `js/annotations/xfdf.js:411` `xfdfColorToHex` houden hun eigen invoervorm (een pdf-lib `PDFArray`, respectievelijk een `"r,g,b"`-tekenreeks) maar gebruiken voortaan `rgbTripleToHex` voor het laatste stuk. Beide behouden hun eigen terugvalwaarde bij een ongeldige invoer — `pdfColorToHex` geeft `null`, dat blijft zo.

- [ ] **Step 7: Draai tests, build en de opslag-rondgang**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-mupdf-compare.mjs
```

De sweep is hier verplicht: dit raakt de kleurschrijfkant van de saver.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(color): one hex reader and one hex writer for the whole app (#454)"
```

### Task 5: meetkunde — afstand, snijpunt, punt-in-veelhoek, punt roteren

Vier families met elk 4 tot 5 kopieën die equivalent zijn maar verschillende aanroepvormen hebben.

**Files:**
- Modify: `open-pdf-studio/js/utils/math.js` — voeg `projectPointOnSegment`, `distanceToSegment` en `rotatePoint` toe
- Modify: `open-pdf-studio/js/annotations/geometry.js` — exporteer `pointInPolygon`
- Test: uitbreiding van `open-pdf-studio/js/utils/math.test.mjs`
- Test: `open-pdf-studio/js/annotations/punt-in-veelhoek.test.mjs`
- Modify: `js/annotations/betonbalk.js:188` en `:180`, `js/annotations/systeemraster.js:689` en `:513`, `js/annotations/vlak-ringen.js:74`, `js/annotations/wand-geometrie.js:99`, `js/annotations/handles.js:42`, `js/annotations/z-order.js:108`, `js/annotations/geometry.js:65`, `js/pdf/pdf-viewports.js:145`, `js/tools/snap-engine.js:468` en `:1050`

**Interfaces:**
- Consumes: `clamp` uit Task 2.
- Produces:
  - `js/utils/math.js` exporteert `projectPointOnSegment(px, py, x1, y1, x2, y2): {x: number, y: number, t: number, dist: number}` — het dichtstbijzijnde punt op het lijnstuk, `t` geklemd op [0, 1]. En `distanceToSegment(px, py, x1, y1, x2, y2): number`, een dunne laag erboven. En `rotatePoint(x, y, centerX, centerY, rotationDegrees): {x: number, y: number}` — bij `rotationDegrees === 0` wordt `{x, y}` ongewijzigd teruggegeven.
  - `js/annotations/geometry.js` exporteert voortaan `pointInPolygon(x: number, y: number, points: Array<{x: number, y: number}>): boolean`.

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan `open-pdf-studio/js/utils/math.test.mjs`:

```js
import { projectPointOnSegment, distanceToSegment, rotatePoint } from './math.js';

test('projectPointOnSegment valt loodrecht binnen het lijnstuk', () => {
  const r = projectPointOnSegment(5, 3, 0, 0, 10, 0);
  assert.equal(r.x, 5);
  assert.equal(r.y, 0);
  assert.equal(r.t, 0.5);
  assert.equal(r.dist, 3);
});

test('projectPointOnSegment klemt op de uiteinden', () => {
  assert.deepEqual(
    { ...projectPointOnSegment(-4, 0, 0, 0, 10, 0) },
    { x: 0, y: 0, t: 0, dist: 4 }
  );
  assert.deepEqual(
    { ...projectPointOnSegment(14, 0, 0, 0, 10, 0) },
    { x: 10, y: 0, t: 1, dist: 4 }
  );
});

test('projectPointOnSegment overleeft een lijnstuk van lengte nul', () => {
  const r = projectPointOnSegment(3, 4, 0, 0, 0, 0);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert.equal(r.dist, 5);
});

test('distanceToSegment geeft dezelfde afstand', () => {
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3);
});

test('rotatePoint laat een punt met rotatie nul ongemoeid', () => {
  assert.deepEqual(rotatePoint(3, 4, 0, 0, 0), { x: 3, y: 4 });
});

test('rotatePoint draait een kwartslag om de oorsprong', () => {
  const r = rotatePoint(1, 0, 0, 0, 90);
  assert.ok(Math.abs(r.x - 0) < 1e-12);
  assert.ok(Math.abs(r.y - 1) < 1e-12);
});

test('rotatePoint draait om een ander middelpunt', () => {
  const r = rotatePoint(2, 1, 1, 1, 180);
  assert.ok(Math.abs(r.x - 0) < 1e-12);
  assert.ok(Math.abs(r.y - 1) < 1e-12);
});
```

Maak `open-pdf-studio/js/annotations/punt-in-veelhoek.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon } from './geometry.js';

const vierkant = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

test('een punt binnen het vierkant ligt erin', () => {
  assert.equal(pointInPolygon(5, 5, vierkant), true);
});

test('een punt buiten het vierkant ligt er niet in', () => {
  assert.equal(pointInPolygon(15, 5, vierkant), false);
  assert.equal(pointInPolygon(-1, 5, vierkant), false);
});

test('een holle vorm telt het gat niet mee', () => {
  const l = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygon(2, 2, l), true);
  assert.equal(pointInPolygon(8, 8, l), false);
});
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

```bash
cd open-pdf-studio && node --test js/utils/math.test.mjs js/annotations/punt-in-veelhoek.test.mjs
```

Verwacht: FAIL op de nieuwe namen, en `does not provide an export named 'pointInPolygon'`.

- [ ] **Step 3: Voeg de meetkunde toe aan `js/utils/math.js`**

```js
/**
 * Het dichtstbijzijnde punt op het lijnstuk (x1,y1)-(x2,y2), met de parameter
 * t geklemd op [0, 1] en de afstand. Verving vijf lokale varianten.
 */
export function projectPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

/** Afstand van een punt tot een lijnstuk. */
export function distanceToSegment(px, py, x1, y1, x2, y2) {
  return projectPointOnSegment(px, py, x1, y1, x2, y2).dist;
}

/** Punt (x, y) `rotationDegrees` graden om (centerX, centerY) draaien. */
export function rotatePoint(x, y, centerX, centerY, rotationDegrees) {
  if (!rotationDegrees) return { x, y };
  const radians = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - centerX;
  const dy = y - centerY;
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}
```

De bestaande `distanceToLine` in hetzelfde bestand blijft staan tot alle aanroepers over zijn; hij wordt dan een doorverwijzing:

```js
/** @deprecated gebruik distanceToSegment */
export function distanceToLine(px, py, x1, y1, x2, y2) {
  return distanceToSegment(px, py, x1, y1, x2, y2);
}
```

- [ ] **Step 4: Exporteer `pointInPolygon`**

In `open-pdf-studio/js/annotations/geometry.js:51`, zet `export` voor `function pointInPolygon`. Niets anders aan die functie veranderen.

- [ ] **Step 5: Draai de tests en controleer dat ze slagen**

```bash
cd open-pdf-studio && node --test js/utils/math.test.mjs js/annotations/punt-in-veelhoek.test.mjs
```

Verwacht: PASS.

- [ ] **Step 6: Vervang de kopieën, met de verschillen expliciet**

**Afstand tot lijnstuk.** Verwijder `_distToSegment` (`betonbalk.js:188`), `_distToSeg` (`systeemraster.js:689`) en `afstandTotLijn` (`vlak-ringen.js:74`); importeer `distanceToSegment`. Laat `projectPointOnSegment` in `snap-engine.js:468` staan en laat hem doorverwijzen naar de canonieke — zijn aanroepers verwachten `{x, y, dist}` en dat is precies de vorm die de canonieke geeft.

**Punt roteren.** Verwijder `rotatePoint` uit `handles.js:42` en `z-order.js:108`; importeer uit `js/utils/math.js`. `geometry.js:65` `transformPointByInverseRotation` is hetzelfde met een omgekeerd teken:

```js
function transformPointByInverseRotation(x, y, centerX, centerY, rotationDegrees) {
  return rotatePoint(x, y, centerX, centerY, -rotationDegrees);
}
```

**Naamsverwarring oplossen.** `js/pdf/renderer.js:2302` heet óók `rotatePoint` maar doet iets heel anders: hij herbeeldt een punt af voor een paginarotatie van 0/90/180/270. Hernoem hem naar `remapPointForPageRotation`, en `rotateRect` op regel 2311 naar `remapRectForPageRotation`. Beide zijn lokaal aan `renderer.js`; controleer met een grep dat er geen externe aanroeper is.

**Punt in veelhoek.** Verwijder `_pointInPoly` (`systeemraster.js:513`) en gebruik `pointInPolygon(x, y, pts)` — let op de omgekeerde argumentvolgorde. Verwijder `puntInVeelhoek` (`pdf-viewports.js:145`) en zet er een adapter voor tuples voor in de plaats:

```js
import { pointInPolygon } from '../annotations/geometry.js';

/** Veelhoek als [[x, y], …] in plaats van [{x, y}, …]. */
function puntInVeelhoek(veelhoek, x, y) {
  return pointInPolygon(x, y, veelhoek.map(([vx, vy]) => ({ x: vx, y: vy })));
}
```

**Laat `puntInRing` (`vlak-ringen.js:60`) staan.** Die is een superset: hij telt een punt op de rand mee binnen een marge en heeft een deel-door-nul-beveiliging. Die marge is wat een dunne ring aanklikbaar maakt. Laat hem `pointInPolygon` gebruiken voor het binnen-geval en zijn eigen randtest daarbovenop.

**Lijnsnijpunt.** Verwijder `lijnSnijpunt` (`wand-geometrie.js:99`) en laat hem `lineIntersection` uit `betonbalk.js` gebruiken; verplaats `lineIntersection` daarvoor naar `js/annotations/geometry.js` naast `lineLineIntersection`, met de punt-plus-richting-aanroepvorm intact. `segmentIntersection` (`snap-engine.js:1050`) houdt zijn eigen `0 ≤ t ≤ 1 && 0 ≤ u ≤ 1`-klem, maar rekent het snijpunt uit met de canonieke. **Laat `segmentsIntersect` (`tools/tools/eraser-hit.js:18`) met rust** — dat is een ander algoritme (oriëntatiepredicaat, alleen een booleaan) en heeft een eigen test.

- [ ] **Step 7: Draai alles**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-mupdf-compare.mjs
node scripts/verify-plaatsing-cursor.mjs
```

`verify-plaatsing-cursor.mjs` is hier belangrijk: het raakvlak en de greepafstanden hangen aan `distanceToSegment`.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(geometry): one segment projection, one point rotation, one point-in-polygon (#454)"
```

### Task 6: omhullende uit punten

Dertig plekken schrijven de `minX = Infinity`-lus of de `Math.min(...xs)`-vorm opnieuw. Drie daarvan schrijven het resultaat bovendien identiek terug op `ann.x/y/width/height`.

**Files:**
- Modify: `open-pdf-studio/js/annotations/spatial-index.js` — `boundsFromPoints` krijgt een `pad`-optie, plus een nieuwe `schrijfBoundsTerug`
- Test: `open-pdf-studio/js/annotations/annotatie-omhullende.test.mjs` (bestaat al; breid uit)
- Modify: `js/annotations/size-matching.js:12`, `js/annotations/z-order.js:127`, `js/pdf/renderer.js:2321`, en de 18 lus-plekken uit de meting

**Interfaces:**
- Consumes: niets.
- Produces:
  - `boundsFromPoints(points, lineWidth)` blijft **exact** wat hij is, inclusief de bodempadding van `Math.max(lineWidth / 2, 2)`. Er komt een tweede functie naast: `bareBounds(points): {x, y, width, height} | null` — dezelfde lus, **zonder** padding.
  - `schrijfBoundsTerug(annotation, points): void` — zet `x`, `y`, `width` en `height` op de annotatie uit `bareBounds(points)`; doet niets als `bareBounds` `null` geeft.

- [ ] **Step 1: Schrijf de falende test**

Voeg toe aan `open-pdf-studio/js/annotations/annotatie-omhullende.test.mjs`:

```js
import { bareBounds, schrijfBoundsTerug } from './spatial-index.js';

test('bareBounds geeft de omhullende zonder padding', () => {
  const b = bareBounds([{ x: 1, y: 2 }, { x: 5, y: 8 }]);
  assert.deepEqual(b, { x: 1, y: 2, width: 4, height: 6 });
});

test('bareBounds slaat onbruikbare punten over', () => {
  const b = bareBounds([null, { x: 1, y: 2 }, { x: undefined, y: 3 }, { x: 5, y: 8 }]);
  assert.deepEqual(b, { x: 1, y: 2, width: 4, height: 6 });
});

test('bareBounds geeft null als er geen bruikbaar punt is', () => {
  assert.equal(bareBounds([]), null);
  assert.equal(bareBounds([null, {}]), null);
});

test('schrijfBoundsTerug zet de omhullende op de annotatie', () => {
  const ann = { x: 0, y: 0, width: 0, height: 0 };
  schrijfBoundsTerug(ann, [{ x: 1, y: 2 }, { x: 5, y: 8 }]);
  assert.deepEqual(ann, { x: 1, y: 2, width: 4, height: 6 });
});

test('schrijfBoundsTerug laat de annotatie met rust bij nul punten', () => {
  const ann = { x: 3, y: 4, width: 5, height: 6 };
  schrijfBoundsTerug(ann, []);
  assert.deepEqual(ann, { x: 3, y: 4, width: 5, height: 6 });
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/annotations/annotatie-omhullende.test.mjs
```

Verwacht: FAIL op `bareBounds` en `schrijfBoundsTerug`.

- [ ] **Step 3: Voeg de twee functies toe**

In `open-pdf-studio/js/annotations/spatial-index.js`, naast `boundsFromPoints`:

```js
/** Omhullende van een puntenreeks, zonder padding. null bij nul bruikbare punten. */
export function bareBounds(points) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const pt of points || []) {
    if (pt == null || pt.x == null || pt.y == null) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Zet de omhullende van `points` op de annotatie. Geen punten: niets doen. */
export function schrijfBoundsTerug(annotation, points) {
  const b = bareBounds(points);
  if (!b || !annotation) return;
  annotation.x = b.x;
  annotation.y = b.y;
  annotation.width = b.width;
  annotation.height = b.height;
}
```

Laat `boundsFromPoints` zelf hier gebruik van maken, zodat er één lus overblijft:

```js
export function boundsFromPoints(points, lineWidth) {
  const b = bareBounds(points);
  if (!b) return null;
  const pad = Math.max((lineWidth || 0) / 2, 2);
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/annotations/annotatie-omhullende.test.mjs
```

- [ ] **Step 5: Vervang de drie terugschrijvers**

`js/annotations/size-matching.js:12` `updateBoundsFromPoints`, `js/annotations/z-order.js:127` `updatePolylineBounds` en `js/pdf/renderer.js:2321` `recalcBoundsFromPoints` doen alle drie hetzelfde. Vervang elk lichaam door `schrijfBoundsTerug(ann, punten);` en laat de naam staan (de aanroepers blijven ongemoeid), óf verwijder de functie en importeer `schrijfBoundsTerug` rechtstreeks als de functie maar één aanroeper heeft. Controleer per functie:

```bash
cd open-pdf-studio && grep -rn "updateBoundsFromPoints\|updatePolylineBounds\|recalcBoundsFromPoints" js --include=*.js --include=*.jsx
```

- [ ] **Step 6: Vervang de losse lussen**

De 18 plekken met de `minX = Infinity`-lus: `js/annotations/betonbalk.js:684`, `js/annotations/polygon-transform.js:29`, `js/annotations/rendering/shapes.js:53`, `js/annotations/stavenreeks.js:647`, `js/annotations/systeemraster.js:812`, `js/annotations/vlak-ringen.js:84` en `:190`, `js/core/stores/selection-helpers.ts:186`, `js/pdf/loader/annotation-converter.js:803`, `js/pdf/renderer.js:2399`, `js/pdf/saver.js:817` en `:1014`, `js/tools/embedded-image-parser.js:255`, `js/tools/g-rotate-mode.js:255`, `js/tools/snap-engine.js:239`, `js/tools/tool-dispatcher.js:878`.

Vervang per plek door `bareBounds(punten)` — maar **alleen als de lus precies dit doet**. Doet hij er iets bij (een marge, een uitzondering voor een puntsoort, een tweede accumulator), laat hem dan staan en noteer hem in de PR-tekst. Ga niet forceren: dit is de taak waar een te enthousiaste vervanging het snelst een subtiele fout oplevert.

`js/pdf/saver.js:817` en `:1014` zitten in de opslagweg; die twee komen in fase 6 sowieso in een eigen bestand terecht. Sla ze in deze taak over en laat ze in fase 6 meteen de canonieke gebruiken.

- [ ] **Step 7: Draai alles**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-mupdf-compare.mjs
```

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(bounds): one bounding box from points (#454)"
```

### Task 7: de kleine bestands- en UI-helpers

**Files:**
- Modify: `open-pdf-studio/js/utils/helpers.js` — voeg `formatFileSize` en `getPdfBaseName` toe
- Test: uitbreiding van `open-pdf-studio/js/utils/helpers.test.mjs`
- Create: `open-pdf-studio/js/solid/components/palet-dok.js`
- Modify: `js/ui/chrome/dialogs.js:103`, `js/ui/panels/attachments.js:22` en `:29`, `js/pdf/compress.js:59`, `js/pdf/exporter.js:169`, `js/solid/components/app-menu/OpenPanel.jsx:209` en `:213`, `js/solid/components/ToolPalette.jsx:140`, `js/solid/components/ExtensionToolPalette.jsx:129`, `js/solid/components/SymbolPalette.jsx:59`, `js/solid/components/PdfTextEditOverlay.jsx:15`, `js/solid/components/TextEditOverlay.jsx:19`, `js/annotations/xfdf.js:402`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `js/utils/helpers.js` exporteert daarnaast `formatFileSize(bytes: number): string` en `getPdfBaseName(pad: string): string`.
  - `js/solid/components/palet-dok.js` exporteert `getSnapSide(x: number, y: number, breedte: number, hoogte: number): 'left'|'right'|'top'|'bottom'|null`.

- [ ] **Step 1: Kies eerst, dan pas samenvoegen**

Drie van deze families hebben **verschillende uitvoer**, niet alleen verschillende code. Noteer in de PR-tekst welke variant wint en waarom:

- `formatFileSize`: `js/ui/chrome/dialogs.js:103` geeft `Bytes/KB/MB/GB` via een logaritme; `js/ui/panels/attachments.js:22` geeft `B/KB/MB` via een if-ladder. **Beide zijn zichtbaar in de UI.** Kies de dialogs-variant (die dekt GB) en controleer in de rig dat de bijlagenlijst er nog goed uitziet.
- `formatDate`: vier varianten met verschillende `Intl`-opties. `js/utils/helpers.js:5` is de kanonieke. Controleer per aanroepplek of de getoonde datum verandert; verandert hij, geef de aanroeper dan een expliciete optieparameter mee in plaats van de opmaak te wijzigen.
- `extractFileName`: `js/core/platform.js:14` behandelt Android-`content://`-URI's; `js/solid/components/app-menu/OpenPanel.jsx:209` splitst naïef op een schuine streep. **De lokale is kapot op Android.** Vervang hem door de kanonieke; dat is een bugfix, geen opruiming, en hoort als zodanig in de PR-tekst.

- [ ] **Step 2: Schrijf de falende tests**

Voeg toe aan `open-pdf-studio/js/utils/helpers.test.mjs`:

```js
import { formatFileSize, getPdfBaseName } from './helpers.js';

test('formatFileSize gebruikt de juiste eenheid', () => {
  assert.equal(formatFileSize(0), '0 Bytes');
  assert.equal(formatFileSize(512), '512 Bytes');
  assert.equal(formatFileSize(1024), '1 KB');
  assert.equal(formatFileSize(1024 * 1024), '1 MB');
  assert.equal(formatFileSize(1024 * 1024 * 1024), '1 GB');
});

test('getPdfBaseName haalt map en extensie weg', () => {
  assert.equal(getPdfBaseName('map/onder/blad.pdf'), 'blad');
  assert.equal(getPdfBaseName('map\\onder\\blad.PDF'), 'blad');
  assert.equal(getPdfBaseName('blad.pdf'), 'blad');
  assert.equal(getPdfBaseName('blad'), 'blad');
});
```

- [ ] **Step 3: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/utils/helpers.test.mjs
```

- [ ] **Step 4: Voeg de twee helpers toe**

Neem de implementatie van `formatFileSize` letterlijk over uit `js/ui/chrome/dialogs.js:103` en die van `getPdfBaseName` uit `js/pdf/compress.js:59`. Pas alleen aan wat de test eist.

- [ ] **Step 5: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/utils/helpers.test.mjs
```

- [ ] **Step 6: Trek de paletdok uit elkaar**

`getSnapSide` staat drie keer (`ToolPalette.jsx:140`, `ExtensionToolPalette.jsx:129`, `SymbolPalette.jsx:59`), en de omliggende sleep-, dok- en klemlogica (`clampFloatPosition:76`, `clampAllExtFloatPositions:87`) staat er twee keer omheen. Maak `js/solid/components/palet-dok.js` met `getSnapSide` erin, neem de ruimste van de drie versies over, en laat de drie paletten hem importeren. Laat de sleeplogica zelf voorlopig staan — die uit elkaar trekken is een eigen taak en hoort niet in een opruimfase.

- [ ] **Step 7: Voeg de ontsnappers samen**

`escapeHtml` staat byte-identiek in `js/solid/components/PdfTextEditOverlay.jsx:15` en `js/solid/components/TextEditOverlay.jsx:19`. Zet hem in `js/utils/helpers.js` en importeer op beide plekken.

`escapeXml`: `js/bcf/bcf-xml.js:10` is nul-veilig en geëxporteerd; `js/annotations/xfdf.js:402` is een eenregelige `String(str)`-variant die van `null` de tekst `"null"` maakt. **Dat is een verschil dat in een XFDF-bestand terechtkomt.** Vervang de xfdf-versie door de bcf-versie en controleer met een export-import-rondgang dat een annotatie zonder opmerking nog steeds leeg blijft in plaats van `null` te bevatten.

- [ ] **Step 8: Draai alles en controleer in de app**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

Handmatig in de rig: open de bijlagenlijst (bestandsgroottes), open het menu Openen (datums en bestandsnamen), dok en ontdok alle drie de paletten, en doe een XFDF-export gevolgd door een import.

- [ ] **Step 9: Commit**

```bash
git add open-pdf-studio/js
git commit -m "refactor(utils): one file size formatter, one base name, one escape, one snap side (#454)"
```

### Task 8: de twee aanwijzerpaden samenvoegen

`js/tools/tool-context.js:49` `resolvePointerCoords` en `js/tools/g-move-mode.js:139` `pointerToAppCoords` claimen allebei in hun eigen comment "de enige aanwijzer→app-afbeelding" te zijn. Ze zijn het geen van beide. Daaronder ligt de echte primitief: `js/pdf/pdf-viewport.js:1285` `screenToWorld`.

**Files:**
- Modify: `open-pdf-studio/js/tools/g-move-mode.js:139` — `pointerToAppCoords` wordt een dunne laag over `resolvePointerCoords`
- Modify: `open-pdf-studio/js/tools/tool-context.js` — laat `resolvePointerCoords` `screenToWorld` gebruiken
- Modify: `open-pdf-studio/js/pdf/pdf-viewport.js` — haal het comment uit fase 2 Task 3 Step 1 weg

**Interfaces:**
- Consumes: `screenToWorld(screenX, screenY)` en `worldToScreen(worldX, worldY)` uit `js/pdf/pdf-viewport.js` (die zijn in fase 2 bewust blijven staan).
- Produces: `resolvePointerCoords` houdt zijn bestaande vorm `{x, y, pageNum, canvas, canvasCtx}`. `pointerToAppCoords` houdt zijn vorm `{x, y} | null`.

- [ ] **Step 1: Schrijf de verschillen op**

```bash
cd open-pdf-studio && sed -n '45,110p' js/tools/tool-context.js
cd open-pdf-studio && sed -n '135,165p' js/tools/g-move-mode.js
cd open-pdf-studio && sed -n '1283,1300p' js/pdf/pdf-viewport.js
```

De gemeten verschillen: `pointerToAppCoords` geeft geen `pageNum`, `canvas` of `canvasCtx`; hij leest `window.__pdfViewport` rechtstreeks in plaats van via de viewport-module; en hij geeft `null` terug als er geen canvas is, waar `resolvePointerCoords` een object met `{x: 0, y: 0, …}` teruggeeft. Controleer per aanroeper van `pointerToAppCoords` of die op `null` rekent.

- [ ] **Step 2: Maak `pointerToAppCoords` een laag**

```js
import { resolvePointerCoords } from './tool-context.js';

/**
 * Aanwijzer naar app-ruimte voor de verplaats- en draaimodi. Dunne laag over
 * resolvePointerCoords, met de null-terugval die de aanroepers hier
 * verwachten. Zie issue #454, fase 4.
 */
function pointerToAppCoords(e) {
  const c = resolvePointerCoords(e);
  if (!c || !c.canvas) return null;
  return { x: c.x, y: c.y };
}
```

- [ ] **Step 3: Laat `resolvePointerCoords` de primitief gebruiken**

Waar `tool-context.js` nu `(screenX - vp.offsetX) / vp.zoom` uitrekent, gebruikt hij voortaan `screenToWorld`. Verander het rekenwerk niet: kopieer de uitdrukking uit `screenToWorld` en controleer dat hij gelijk is aan wat er stond. Is hij níét gelijk, stop dan en noteer het verschil — dan is er een echte afwijking tussen twee paden en dat is een bug, geen opruiming.

- [ ] **Step 4: Verwijder het uitstel-comment uit fase 2**

Haal in `js/pdf/pdf-viewport.js` het comment boven `screenToWorld` weg dat in fase 2 Task 3 Step 1 is toegevoegd; de functie is nu in gebruik.

- [ ] **Step 5: Test handmatig — hier is geen unittest voor**

Dit raakt elke muisinteractie. In de rig, in beide weergavemodi en op zoom 50 %, 100 % en 175 %:

1. een annotatie selecteren door erop te klikken;
2. `g` indrukken en de annotatie verplaatsen, daarna bevestigen en daarna annuleren;
3. `r` indrukken en draaien;
4. een maatlijn tekenen en de eindpunten verslepen;
5. rechtsklikken op een annotatie (het contextmenu gebruikt hetzelfde pad).

Draai daarna:

```bash
node scripts/verify-plaatsing-cursor.mjs
```

Dat script meet of een maatlijn onder de cursor landt op zoom 1, 2 en 3,52 met een afwijking van ten hoogste 1,5 pt. Het is de enige geautomatiseerde bewaking op dit pad.

- [ ] **Step 6: Draai tests en build**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
```

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js/tools/g-move-mode.js open-pdf-studio/js/tools/tool-context.js \
        open-pdf-studio/js/pdf/pdf-viewport.js
git commit -m "refactor(input): one pointer to app space mapping (#454)"
```

### PR van fase 4

Titel: `refactor: one place per rule for twenty duplicated helper families (#454)`

De PR-tekst noemt per familie: hoeveel kopieën er waren, welke variant heeft gewonnen, en bij welke families een variant bewust is blijven staan omdat hij méér doet (`puntInRing`, `segmentsIntersect`, `genGuid`, `generateImageId`, `normalizePageRotation`, de wrapper in `tool-dispatcher.js`).

---

## Fase 5 — Tekenen per type

**Doel:** `js/annotations/rendering.js` van 3 223 naar ongeveer 600 regels. De `switch` van 2 023 regels met 42 takken (regel 489-2512) wordt een tabel met 42 ingangen, en elke tak verhuist letterlijk naar een eigen bestand in `js/annotations/rendering/typen/`.

**Wat verandert er voor de gebruiker:** niets. Dit is een verplaatsing. Geen enkele regel binnen een tak wordt aangepast.

**Branch:** `refactor/454-fase-5-tekenen-per-type`

**Netto regelwinst: nul tot licht negatief.** Er komen 42 bestandskoppen bij. De winst zit in reviewbaarheid en testbaarheid: na deze fase is "hoe tekent een wolkpolylijn" een bestand van 19 regels in plaats van tak 14 van een functie van 2 098.

**Het onmisbare hulpmiddel bij deze fase.** De preambule van `drawAnnotation` (regel 419-488) rekent acht waarden uit die elke tak gebruikt: `baseOpacity`, `strokeColor`, `fillColor`, `rawStrokeColor`, `annHasStroke`, `annHasFill`, `annFill` en `lw`. Die acht gaan als één object mee naar elke tekenfunctie. Verandert er iets aan de preambule, dan verandert het op één plek.

### Task 1: de tekenstaat en de lege tabel

**Files:**
- Create: `open-pdf-studio/js/annotations/rendering/tekenstaat.js`
- Create: `open-pdf-studio/js/annotations/rendering/tekenen-per-type.js`
- Test: `open-pdf-studio/js/annotations/rendering/tekenstaat.test.mjs`
- Modify: `open-pdf-studio/js/annotations/rendering.js:419-488`

**Interfaces:**
- Consumes: `hasFill` en `hasStroke` uit `js/annotations/fill-utils.js`, `withFillAlpha` en `thinLw` uit `js/annotations/rendering.js`, `evHalftoneTypes` uit `js/solid/stores/elementVisibilityStore.js`.
- Produces:
  - `js/annotations/rendering/tekenstaat.js` exporteert `bouwTekenstaat(annotation, halftone): {baseOpacity: number, strokeColor: string, fillColor: string, rawStrokeColor: string|null, annHasStroke: boolean, annHasFill: boolean, annFill: string, lw: number}`.
  - `js/annotations/rendering/tekenen-per-type.js` exporteert `TEKENAARS: Record<string, (ctx: CanvasRenderingContext2D, annotation: object, staat: Tekenstaat) => void>` en `tekenaarVoor(type: string): function | null`.

- [ ] **Step 1: Schrijf de falende test voor de tekenstaat**

Maak `open-pdf-studio/js/annotations/rendering/tekenstaat.test.mjs`. De staat is pure rekenkunde en laadt geen canvas:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bouwTekenstaat } from './tekenstaat.js';

test('een markering krijgt standaard 0,3 dekking', () => {
  const s = bouwTekenstaat({ type: 'highlight', color: '#ffff00' }, null);
  assert.equal(s.baseOpacity, 0.3);
});

test('elke andere soort krijgt standaard volle dekking', () => {
  assert.equal(bouwTekenstaat({ type: 'box', color: '#000000' }, null).baseOpacity, 1);
});

test('een eigen dekking wint van de standaard', () => {
  assert.equal(bouwTekenstaat({ type: 'highlight', opacity: 0.8 }, null).baseOpacity, 0.8);
});

test('zonder rand blijft strokeColor een echte kleur', () => {
  const s = bouwTekenstaat({ type: 'box', color: '#123456', strokeColor: 'none' }, null);
  assert.equal(s.annHasStroke, false);
  assert.equal(s.strokeColor, '#123456');
  assert.equal(s.rawStrokeColor, null);
});

test('zonder rand en zonder kleur valt strokeColor terug op zwart', () => {
  const s = bouwTekenstaat({ type: 'box', strokeColor: 'none' }, null);
  assert.equal(s.strokeColor, '#000000');
});

test('lijndikte nul zonder vulling wordt 0,5 zodat de vorm zichtbaar blijft', () => {
  const s = bouwTekenstaat({ type: 'box', color: '#000', lineWidth: 0 }, null);
  assert.ok(s.lw >= 0.5);
});

test('halftone vermenigvuldigt de dekking en overschrijft de kleuren', () => {
  const s = bouwTekenstaat({ type: 'box', color: '#ff0000', opacity: 0.5 }, { opacity: 0.4, color: '#888888' });
  assert.ok(Math.abs(s.baseOpacity - 0.2) < 1e-12);
  assert.equal(s.strokeColor, '#888888');
});

test('halftone zonder eigen kleur laat de kleuren staan', () => {
  const s = bouwTekenstaat({ type: 'box', color: '#ff0000' }, { opacity: 0.35 });
  assert.equal(s.strokeColor, '#ff0000');
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/annotations/rendering/tekenstaat.test.mjs
```

Verwacht: FAIL, module niet gevonden.

- [ ] **Step 3: Maak `tekenstaat.js` met de preambule er letterlijk in**

Neem `js/annotations/rendering.js:431-488` over, met alle comments, en geef er een object mee terug. `withFillAlpha` en `thinLw` staan nu nog in `rendering.js`; verplaats die twee mee naar `tekenstaat.js` (ze zijn 17 en 46 regels en worden alleen door de preambule gebruikt — controleer dat met een grep).

```js
import { hasFill, hasStroke } from '../fill-utils.js';

/**
 * De acht waarden die de preambule van drawAnnotation uitrekent en die elke
 * tekenfunctie nodig heeft. Stond tot issue #454 inline aan het begin van een
 * functie van 2 098 regels.
 *
 * @param {object} annotation
 * @param {{opacity?: number, color?: string}|null} halftone
 */
export function bouwTekenstaat(annotation, halftone) {
  // … de regels 431-488 uit rendering.js, ongewijzigd …
  return { baseOpacity, strokeColor, fillColor, rawStrokeColor, annHasStroke, annHasFill, annFill, lw };
}
```

De regels die de canvas-context zetten (`ctx.strokeStyle = …` t/m `ctx.globalCompositeOperation = …`, regel 481-488) blijven in `rendering.js`; die horen bij het tekenen, niet bij het uitrekenen.

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/annotations/rendering/tekenstaat.test.mjs
```

Verwacht: PASS, 8 tests.

- [ ] **Step 5: Laat `drawAnnotation` de staat gebruiken**

Vervang in `js/annotations/rendering.js` de regels 431-480 door:

```js
  const staat = bouwTekenstaat(annotation, _evHalftone);
  const { baseOpacity, strokeColor, fillColor, rawStrokeColor, annHasStroke, annHasFill, annFill, lw } = staat;
```

De `switch` eronder blijft in deze stap ongewijzigd en gebruikt dezelfde lokale namen. Dit is het moment om te bewijzen dat de verplaatsing niets verandert, **vóór** er ook maar één tak verhuist.

- [ ] **Step 6: Bewijs dat het beeld niet verandert**

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-mupdf-compare.mjs
node scripts/verify-doorlopend-inkt.mjs
```

De vergelijkings-sweep moet exact dezelfde pagina's vlaggen als vóór de wijziging. Wijkt er één pagina af, dan is de preambule niet letterlijk overgenomen: stop en zoek het verschil.

- [ ] **Step 7: Maak de lege tabel**

Maak `open-pdf-studio/js/annotations/rendering/tekenen-per-type.js`:

```js
// De tabel die de switch van 42 takken in drawAnnotation vervangt.
// Eén bestand per annotatiesoort in ./typen/. Zie issue #454, fase 5.
//
// Elke tekenaar heeft dezelfde vorm:
//   (ctx, annotation, staat) => void
// waarbij `staat` het resultaat van bouwTekenstaat() is. De tekenaar mag de
// context aanpassen; drawAnnotation zet hem na afloop terug.

export const TEKENAARS = {};

/** De tekenfunctie voor een soort, of null als de soort onbekend is. */
export function tekenaarVoor(type) {
  return TEKENAARS[type] || null;
}
```

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/annotations/rendering/tekenstaat.js \
        open-pdf-studio/js/annotations/rendering/tekenstaat.test.mjs \
        open-pdf-studio/js/annotations/rendering/tekenen-per-type.js \
        open-pdf-studio/js/annotations/rendering.js
git commit -m "refactor(render): extract the drawing state from drawAnnotation (#454)"
```

### Task 2: de 42 takken verhuizen

**Files:**
- Create: 42 bestanden onder `open-pdf-studio/js/annotations/rendering/typen/`
- Modify: `open-pdf-studio/js/annotations/rendering/tekenen-per-type.js` — vul de tabel
- Modify: `open-pdf-studio/js/annotations/rendering.js` — de `switch` wordt drie regels

**Interfaces:**
- Consumes: `bouwTekenstaat` en `TEKENAARS` uit Task 1.
- Produces: 42 modules, elk met één standaardexport `(ctx, annotation, staat) => void`.

De takken met hun gemeten regelbereik en omvang, op volgorde van grootte — verhuis de kleinste eerst zodat het patroon vaststaat voordat de zware aan de beurt zijn:

| Soort | Regels in `rendering.js` | Omvang | Bestandsnaam |
|---|---|---:|---|
| `highlight` | 507-511 | 5 | `typen/highlight.js` |
| `wall` | 1549-1557 | 9 | `typen/wall.js` |
| `line` | 512-522 | 11 | `typen/line.js` |
| `arc` | 614-624 | 11 | `typen/arc.js` |
| `textHighlight` | 1376-1391 | 16 | `typen/text-highlight.js` |
| `draw` | 490-506 | 17 | `typen/draw.js` |
| `spline` | 625-643 | 19 | `typen/spline.js` |
| `polyline` | 644-662 | 19 | `typen/polyline.js` |
| `cloudPolyline` | 899-917 | 19 | `typen/cloud-polyline.js` |
| `textStrikethrough` | 1392-1413 | 22 | `typen/text-strikethrough.js` |
| `textUnderline` | 1414-1435 | 22 | `typen/text-underline.js` |
| `measureArea` | 1945-1969 | 25 | `typen/measure-area.js` |
| `measureDistance` | 1918-1944 | 27 | `typen/measure-distance.js` |
| `cloud` | 871-898 | 28 | `typen/cloud.js` |
| `signature` | 1521-1548 | 28 | `typen/signature.js` |
| `count` | 1001-1029 | 29 | `typen/count.js` |
| `viewport` | 2174-2206 | 33 | `typen/viewport.js` |
| `systeemraster` | 1885-1917 | 33 | `typen/systeemraster.js` |
| `mask` | 752-786 | 35 | `typen/mask.js` |
| `splineArrow` | 663-697 | 35 | `typen/spline-arrow.js` |
| `redaction` | 2010-2044 | 35 | `typen/redaction.js` |
| `measurePerimeter` | 2045-2079 | 35 | `typen/measure-perimeter.js` |
| `betonbalk` | 1849-1884 | 36 | `typen/betonbalk.js` |
| `vectorSnippet` | 1245-1282 | 38 | `typen/vector-snippet.js` |
| `box` | 787-826 | 40 | `typen/box.js` |
| `filledArea` | 1970-2009 | 40 | `typen/filled-area.js` |
| `text` | 1030-1072 | 43 | `typen/text.js` |
| `polygon` | 827-870 | 44 | `typen/polygon.js` |
| `measureAngle` | 2462-2505 | 44 | `typen/measure-angle.js` |
| `circle` | 698-751 | 54 | `typen/circle.js` |
| `textbox` | 1073-1135 | 63 | `typen/textbox.js` |
| `comment` | 918-1000 | 83 | `typen/comment.js` |
| `stamp` | 1436-1520 | 85 | `typen/stamp.js` |
| `scaleBar` | 2207-2296 | 90 | `typen/scale-bar.js` |
| `arrow` | 523-613 | 91 | `typen/arrow.js` |
| `image` | 1283-1375 | 93 | `typen/image.js` |
| `scaleRegion` | 2080-2173 | 94 | `typen/scale-region.js` |
| `stavenreeks` | 1744-1848 | 105 | `typen/stavenreeks.js` |
| `callout` | 1136-1244 | 109 | `typen/callout.js` |
| `scheduleTable` | 2297-2461 | 165 | `typen/schedule-table.js` |
| `parametricSymbol` | 1558-1743 | 186 | `typen/parametric-symbol.js` |
| `default` | 2506-2512 | 7 | blijft in `rendering.js` |

- [ ] **Step 1: Verhuis de eerste tak als sjabloon**

Maak `open-pdf-studio/js/annotations/rendering/typen/highlight.js`:

```js
// Tak 'highlight' uit drawAnnotation, regel 507-511 vóór issue #454.
// De inhoud is ongewijzigd overgenomen.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} annotation
 * @param {import('../tekenstaat.js').Tekenstaat} staat
 */
export default function tekenHighlight(ctx, annotation, staat) {
  const { fillColor } = staat;
  // … de vijf regels uit rendering.js:507-511, ongewijzigd …
}
```

Regels:
- **Neem de inhoud letterlijk over.** Geen herformulering, geen opgeruimde variabelenamen, geen samengevoegde regels. Dit is een verplaatsing.
- Destructureer bovenaan precies die velden uit `staat` die de tak gebruikt. Gebruikt de tak `strokeColor` maar niet `lw`, destructureer dan alleen `strokeColor`.
- Importeer wat de tak uit `rendering.js` gebruikte (`applyBorderStyle`, `laag`, `cloudPuffSize`, `getTintedImage`, …). Is dat iets wat nog in `rendering.js` zelf staat, verplaats dat hulpje dan mee naar `js/annotations/rendering/` — niet dupliceren, en ook geen import terug naar `rendering.js` maken, want dat geeft een cyclus.

Registreer hem:

```js
import tekenHighlight from './typen/highlight.js';

export const TEKENAARS = {
  highlight: tekenHighlight,
};
```

En vervang in `rendering.js` de `case 'highlight':` door niets — de tabel neemt het over zodra Step 3 de brug legt.

- [ ] **Step 2: Leg de brug in `drawAnnotation`**

Zet vóór de `switch`:

```js
  const tekenaar = tekenaarVoor(annotation.type);
  if (tekenaar) {
    tekenaar(ctx, annotation, staat);
    return;
  }

  switch (annotation.type) {
```

Zo werkt elke soort die al verhuisd is via de tabel, en valt de rest nog in de `switch`. Dat maakt van deze taak een reeks kleine, los te reviewen commits in plaats van één grote sprong.

- [ ] **Step 3: Bewijs dat de eerste tak identiek tekent**

```bash
cd open-pdf-studio && npx vite build
node scripts/verify-mupdf-compare.mjs
```

De sweep moet exact dezelfde pagina's vlaggen als in Task 1 Step 6. Klopt dat, dan staat het patroon.

- [ ] **Step 4: Verhuis de rest in groepen van zes**

Werk de tabel van boven naar beneden af. Per groep van zes soorten: verhuizen, registreren, de bijbehorende `case` uit de `switch` halen, `npm run test:unit` en `npx vite build` draaien, en committen met een bericht als `refactor(render): move six annotation types out of the draw switch (#454)`.

Na elke groep één visuele controle in de rig: open een blad met annotaties van die zes soorten en kijk of het beeld klopt. Zijn die soorten niet in een bestaand testbestand aanwezig, maak ze dan in de rig aan met `app_create_annotation` en kijk.

**Twee takken vragen extra aandacht:**

- `parametricSymbol` (186 regels) leunt op `renderParametricSymbolToPng` en de systeemsymbool-cache. Controleer dat de cache-sleutel niet aan de modulenaam hangt.
- `scheduleTable` (165 regels) gebruikt `getScheduleThumb` uit `rendering.js:61`. Verplaats dat hulpje mee naar `js/annotations/rendering/schedule-thumb.js`.

- [ ] **Step 5: Ruim de `switch` op**

Als alle 42 takken weg zijn, resteert alleen de `default` (regel 2506-2512). Vervang de hele `switch` door:

```js
  // Onbekende soort: niets tekenen, wel melden zodat een typefout opvalt.
  console.warn('[render] onbekende annotatiesoort:', annotation.type);
```

Neem de inhoud van de oorspronkelijke `default` letterlijk over als daar meer stond dan een waarschuwing.

- [ ] **Step 6: Meet en draai de volledige poort**

```bash
cd open-pdf-studio && node scripts/meet-js.mjs | head -3
cd open-pdf-studio && wc -l js/annotations/rendering.js
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-mupdf-compare.mjs
node scripts/verify-doorlopend-inkt.mjs
node scripts/verify-tekstrotatie.mjs
node scripts/verify-opslag-rondgang.mjs
```

Verwacht: `rendering.js` rond de 600 regels; de sweep vlagt exact dezelfde pagina's als aan het begin van deze fase.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js/annotations
git commit -m "refactor(render): one file per annotation type instead of a 42-branch switch (#454)"
```

### PR van fase 5

Titel: `refactor(render): split the 2000-line draw switch into one file per annotation type (#454)`

De PR-tekst bevat de regeltelling van `rendering.js` vóór en na, de lijst van 42 nieuwe bestanden, en het bewijs dat de vergelijkings-sweep dezelfde pagina's vlagt als vóór de fase.

---

## Fase 6 — Opslaan per type

**Doel:** `js/pdf/saver.js` van 3 197 naar ongeveer 700 regels. De functie `_savePDFNu` (regel 301-3132, 2 831 regels) houdt zijn lus over de annotaties, maar de `switch` van 2 360 regels met 42 takken (regel 499-2859) wordt een tabel.

**Wat verandert er voor de gebruiker:** niets — mits de uitvoer byte-identiek blijft. Dat is bij deze fase geen wens maar een harde eis: `node scripts/verify-opslag-rondgang.mjs` en de vergelijkings-sweep zijn de poort.

**Branch:** `refactor/454-fase-6-opslaan-per-type`

**Dit is de gevaarlijkste fase van het plan.** De opslagweg draagt de meeste regressies van de afgelopen weken (rotatie bij het laden, opslag-rondgangen, minimummaten). Het verschil met fase 5 is dat de takken hier geen vrijstaande functies zijn: ze lezen uit de afsluiting van `_savePDFNu` (het pdf-lib-document, de pagina, de context, de rotatiemapper). Die afsluiting moet eerst een expliciet object worden.

### Task 1: de opslagcontext expliciet maken

**Files:**
- Create: `open-pdf-studio/js/pdf/saver/opslagcontext.js`
- Test: `open-pdf-studio/js/pdf/saver/opslagcontext.test.mjs`
- Modify: `open-pdf-studio/js/pdf/saver.js:301-498`

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: `js/pdf/saver/opslagcontext.js` exporteert `maakOpslagcontext(velden): OpslagContext` en een JSDoc-typedef `OpslagContext`. De velden worden in Step 1 vastgesteld, niet geraden.

- [ ] **Step 1: Inventariseer wat de takken uit de afsluiting lezen**

Dit is de belangrijkste stap van de hele fase en hij is handwerk. Lees `js/pdf/saver.js:301-498` (alles tussen het begin van `_savePDFNu` en de `switch`) en schrijf elke variabele op die daar wordt gedeclareerd én binnen de `switch` wordt gelezen.

```bash
cd open-pdf-studio && sed -n '301,499p' js/pdf/saver.js > /tmp/preambule.txt
cd open-pdf-studio && sed -n '499,2860p' js/pdf/saver.js > /tmp/takken.txt
grep -oE '\b(const|let|var) [A-Za-z_$][\w$]*' /tmp/preambule.txt | awk '{print $2}' | sort -u > /tmp/gedeclareerd.txt
while read n; do
  if grep -qE "\b$n\b" /tmp/takken.txt; then echo "$n"; fi
done < /tmp/gedeclareerd.txt
```

De uitvoer is de veldenlijst van `OpslagContext`. Schrijf hem letterlijk in de PR-tekst; hij is het contract van deze hele fase. Verwacht in elk geval: het pdf-lib-document, de pagina-array, de huidige pagina-index, de rotatie-mapper uit `_rotVisualMapper` (regel 116), `remapAnnotationForRotatedPage` (regel 134), `pageCompensationForAp` (regel 212), en de verzameling waarin nieuwe annotatie-dicts worden gehangen.

- [ ] **Step 2: Schrijf de falende test**

Maak `open-pdf-studio/js/pdf/saver/opslagcontext.test.mjs`. De test bewaakt dat de context compleet is en dat hij niets stilzwijgend aanvult:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakOpslagcontext, CONTEXT_VELDEN } from './opslagcontext.js';

test('de context draagt alle velden die de takken lezen', () => {
  const velden = {};
  for (const naam of CONTEXT_VELDEN) velden[naam] = `waarde-${naam}`;
  const ctx = maakOpslagcontext(velden);
  for (const naam of CONTEXT_VELDEN) assert.equal(ctx[naam], `waarde-${naam}`);
});

test('een ontbrekend veld is een fout, geen undefined', () => {
  assert.throws(() => maakOpslagcontext({}), /ontbreekt/);
});

test('een onbekend veld is een fout', () => {
  const velden = {};
  for (const naam of CONTEXT_VELDEN) velden[naam] = 1;
  velden.ietsNieuws = 2;
  assert.throws(() => maakOpslagcontext(velden), /onbekend/);
});
```

- [ ] **Step 3: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/pdf/saver/opslagcontext.test.mjs
```

- [ ] **Step 4: Maak de contextmodule**

```js
// De afsluiting van _savePDFNu, expliciet gemaakt. Elke opslagfunctie per
// annotatiesoort krijgt dit object en niets anders. Zie issue #454, fase 6.

/** De velden die de takken uit de afsluiting lazen, uit Task 1 Step 1. */
export const CONTEXT_VELDEN = Object.freeze([
  // … de gemeten lijst, één naam per regel, in dezelfde volgorde als in saver.js …
]);

/**
 * Bouwt de context en bewaakt dat hij compleet en niet te groot is. Een
 * ontbrekend veld is een programmeerfout, geen undefined dat pas drie lagen
 * verderop stuk gaat.
 */
export function maakOpslagcontext(velden) {
  for (const naam of CONTEXT_VELDEN) {
    if (!(naam in velden)) throw new Error(`opslagcontext: veld "${naam}" ontbreekt`);
  }
  for (const naam of Object.keys(velden)) {
    if (!CONTEXT_VELDEN.includes(naam)) throw new Error(`opslagcontext: onbekend veld "${naam}"`);
  }
  return Object.freeze({ ...velden });
}
```

- [ ] **Step 5: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/pdf/saver/opslagcontext.test.mjs
```

Verwacht: PASS, 3 tests.

- [ ] **Step 6: Bouw de context in `_savePDFNu` en bewijs dat er niets verandert**

Zet direct vóór de `switch` in `js/pdf/saver.js`:

```js
  const opslag = maakOpslagcontext({ /* … de velden … */ });
```

De `switch` blijft in deze stap ongewijzigd en gebruikt nog steeds de lokale variabelen. De context wordt gebouwd maar nog niet gebruikt. Dat lijkt nutteloos en is het niet: het bewijst dat elk veld bestaat en niet `undefined` is op het moment dat de `switch` begint.

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-opslag-duplicaten.mjs
node scripts/verify-mupdf-compare.mjs
```

Gooit `maakOpslagcontext` een fout bij het opslaan, dan klopt de veldenlijst niet. Corrigeer hem en herhaal.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js/pdf/saver/opslagcontext.js \
        open-pdf-studio/js/pdf/saver/opslagcontext.test.mjs open-pdf-studio/js/pdf/saver.js
git commit -m "refactor(save): make the save closure an explicit context object (#454)"
```

### Task 2: de nulmeting van de opslaguitvoer

Voordat er één tak verhuist moet er een meting liggen die bewijst dat de uitvoer byte-identiek blijft. De bestaande rondgang controleert of er niets verdwijnt; hij vergelijkt geen bytes.

**Files:**
- Create: `open-pdf-studio/scripts/opslag-vingerafdruk.mjs`
- Test: `open-pdf-studio/scripts/opslag-vingerafdruk.test.mjs`

**Interfaces:**
- Consumes: niets.
- Produces: `vingerafdruk(bytes: Uint8Array): string` — een SHA-256 over de PDF-bytes met de velden die per opslagbeurt variëren (`/ID`, `/CreationDate`, `/ModDate`) genuliseerd, zodat twee opslagbeurten van hetzelfde document dezelfde afdruk geven.

- [ ] **Step 1: Schrijf de falende test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vingerafdruk } from './opslag-vingerafdruk.mjs';

const enc = (s) => new TextEncoder().encode(s);

test('twee gelijke documenten geven dezelfde afdruk', () => {
  assert.equal(vingerafdruk(enc('%PDF-1.7\nabc\n')), vingerafdruk(enc('%PDF-1.7\nabc\n')));
});

test('een verschil in inhoud geeft een andere afdruk', () => {
  assert.notEqual(vingerafdruk(enc('%PDF-1.7\nabc\n')), vingerafdruk(enc('%PDF-1.7\nabd\n')));
});

test('een verschillende /ID geeft dezelfde afdruk', () => {
  const a = enc('%PDF-1.7\n/ID [<AAAA> <BBBB>]\nabc\n');
  const b = enc('%PDF-1.7\n/ID [<CCCC> <DDDD>]\nabc\n');
  assert.equal(vingerafdruk(a), vingerafdruk(b));
});

test('een verschillende /ModDate geeft dezelfde afdruk', () => {
  const a = enc('%PDF-1.7\n/ModDate (D:20260101000000Z)\nabc\n');
  const b = enc('%PDF-1.7\n/ModDate (D:20270202000000Z)\nabc\n');
  assert.equal(vingerafdruk(a), vingerafdruk(b));
});
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test scripts/opslag-vingerafdruk.test.mjs
```

- [ ] **Step 3: Schrijf het script**

```js
import { createHash } from 'node:crypto';

// Velden die per opslagbeurt veranderen zonder dat de inhoud verandert.
const VLUCHTIG = [
  /\/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/g,
  /\/CreationDate\s*\(D:[^)]*\)/g,
  /\/ModDate\s*\(D:[^)]*\)/g,
];

/** SHA-256 over de PDF-bytes, met de vluchtige velden genuliseerd. */
export function vingerafdruk(bytes) {
  let tekst = Buffer.from(bytes).toString('latin1');
  for (const re of VLUCHTIG) tekst = tekst.replace(re, '');
  return createHash('sha256').update(Buffer.from(tekst, 'latin1')).digest('hex');
}
```

- [ ] **Step 4: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test scripts/opslag-vingerafdruk.test.mjs
```

Verwacht: PASS, 4 tests.

- [ ] **Step 5: Leg de nulmeting vast**

Open in de rig elk bestand uit de verificatieverzameling, sla het op naar een eigen tijdelijke map (**nooit over het origineel heen**, zie de vaste regel), en noteer de afdruk per bestand in `$TMPDIR/opslag-nul.tsv`. Die tabel is het bewijsstuk voor Task 3; hij gaat niet de repo in.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/scripts/opslag-vingerafdruk.mjs open-pdf-studio/scripts/opslag-vingerafdruk.test.mjs
git commit -m "test(save): add a byte fingerprint that ignores volatile PDF fields (#454)"
```

### Task 3: de 42 opslagtakken verhuizen

**Files:**
- Create: `open-pdf-studio/js/pdf/saver/opslaan-per-type.js`
- Create: 42 bestanden onder `open-pdf-studio/js/pdf/saver/typen/`
- Modify: `open-pdf-studio/js/pdf/saver.js` — de `switch` wordt drie regels

**Interfaces:**
- Consumes: `maakOpslagcontext` uit Task 1, `vingerafdruk` uit Task 2.
- Produces: `js/pdf/saver/opslaan-per-type.js` exporteert `OPSLAGERS: Record<string, (annotation: object, opslag: OpslagContext) => void>` en `opslagerVoor(type: string): function | null`.

De takken, gemeten, op volgorde van grootte. De eerste twaalf zijn eenregelig (ze vallen door naar een volgende `case`); die moeten als **groep** verhuizen, niet los:

| Soort | Regels | Omvang |
|---|---|---:|
| `highlight`, `textHighlight`, `textStrikethrough`, `textUnderline`, `textSquiggly` | 500-546 | 47 (één blok) |
| `mask`, `redaction` + `box` | 547-626 | 80 (één blok) |
| `line` + `arrow` | 745-805 | 61 (één blok) |
| `polygon`, `cloud` + `cloudPolyline` | 1044-1171 | 128 (één blok) |
| `text`, `textbox` + `callout` | 1172-1552 | 381 (één blok) |
| `image` + `signature` | 1719-1871 | 153 (één blok) |
| `viewport` | 1905-1930 | 26 |
| `scaleBar` | 1931-1957 | 27 |
| `scheduleTable` | 1958-1984 | 27 |
| `comment` | 1553-1582 | 30 |
| `scaleRegion` | 1872-1904 | 33 |
| `polyline` | 1009-1043 | 35 |
| `measureAngle` | 2287-2321 | 35 |
| `draw` | 806-845 | 40 |
| `arc` | 846-888 | 43 |
| `spline` | 889-932 | 44 |
| `circle` | 691-744 | 54 |
| `measurePerimeter` | 2603-2662 | 60 |
| `vectorSnippet` | 627-690 | 64 |
| `measureArea` | 2443-2508 | 66 |
| `splineArrow` | 933-1008 | 76 |
| `wall` | 2663-2741 | 79 |
| `betonbalk` | 2085-2174 | 90 |
| `filledArea` | 2509-2602 | 94 |
| `parametricSymbol` | 2742-2839 | 98 |
| `stavenreeks` | 1985-2084 | 100 |
| `systeemraster` | 2175-2286 | 112 |
| `measureDistance` | 2322-2442 | 121 |
| `stamp` | 1583-1718 | 136 |
| `default` | 2840-2859 | 20, blijft in `saver.js` |

- [ ] **Step 1: Verhuis de kleinste zelfstandige tak als sjabloon**

Begin met `viewport` (1905-1930, 26 regels). Maak `open-pdf-studio/js/pdf/saver/typen/viewport.js`:

```js
// Tak 'viewport' uit _savePDFNu, regel 1905-1930 vóór issue #454.
// De inhoud is ongewijzigd overgenomen; alleen de verwijzingen naar de
// afsluiting lopen nu via de expliciete context.

/**
 * @param {object} ann
 * @param {import('../opslagcontext.js').OpslagContext} opslag
 */
export default function slaViewportOp(ann, opslag) {
  const { /* … precies de velden die deze tak leest … */ } = opslag;
  // … de 26 regels, ongewijzigd …
}
```

Registreer hem in `opslaan-per-type.js` en leg de brug in `_savePDFNu`, net als in fase 5 Task 2 Step 2:

```js
  const opslager = opslagerVoor(ann.type);
  if (opslager) {
    opslager(ann, opslag);
    break;
  }
```

Let op het verschil met fase 5: hier staat de aanroep *binnen* de lus over de annotaties, dus `break` in plaats van `return`. Controleer in de omliggende code of er na de `switch` nog iets gebeurt dat óók voor deze tak moet lopen; zo ja, dan mag er geen vroege uitgang komen en moet de brug ná de `switch` staan, met een vlag.

- [ ] **Step 2: Bewijs dat de eerste tak byte-identiek opslaat**

Open in de rig een bestand met een viewport-annotatie, sla op, en vergelijk de afdruk met de nulmeting uit Task 2 Step 5:

```bash
cd open-pdf-studio && node -e "
import('./scripts/opslag-vingerafdruk.mjs').then(async (m) => {
  const { readFileSync } = await import('node:fs');
  console.log(m.vingerafdruk(readFileSync(process.argv[1])));
});
" "<pad naar de zojuist opgeslagen kopie>"
```

De afdruk moet gelijk zijn. Is hij dat niet, stop: de verplaatsing is niet letterlijk.

- [ ] **Step 3: Verhuis de rest in groepen van vier**

Per groep: verhuizen, registreren, de `case` uit de `switch` halen, en daarna:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-opslag-duplicaten.mjs
```

En per groep de afdrukken van de betrokken bestanden vergelijken met de nulmeting. Commit per groep.

**De doorvaltakken gaan als één blok.** Vijf soorten die naar dezelfde code doorvallen worden vijf ingangen in de tabel die naar dezelfde functie wijzen:

```js
import slaTekstmarkeringOp from './typen/tekstmarkering.js';

export const OPSLAGERS = {
  highlight: slaTekstmarkeringOp,
  textHighlight: slaTekstmarkeringOp,
  textStrikethrough: slaTekstmarkeringOp,
  textUnderline: slaTekstmarkeringOp,
  textSquiggly: slaTekstmarkeringOp,
  // …
};
```

De functie zelf houdt zijn eigen onderscheid op `ann.type` als de oorspronkelijke code dat had. Voeg dat onderscheid niet toe als het er niet stond.

**De zwaarste tak is `callout` (381 regels).** Verhuis die als laatste, in zijn eentje, met een eigen commit en een eigen rondgang. Hij zit in het blok `text` / `textbox` / `callout`; ontwar eerst welk deel bij welke soort hoort, en schrijf dat op vóór je knipt.

- [ ] **Step 4: De volledige poort**

```bash
cd open-pdf-studio && wc -l js/pdf/saver.js
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-opslag-duplicaten.mjs
node scripts/verify-mupdf-compare.mjs
node scripts/verify-tekstrotatie.mjs
```

Plus de afdrukvergelijking over de héle verificatieverzameling tegen de nulmeting uit Task 2. **Elke afwijkende afdruk blokkeert de PR** tot hij is verklaard.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/pdf/saver
git commit -m "refactor(save): one file per annotation type instead of a 42-branch switch (#454)"
```

### PR van fase 6

Titel: `refactor(save): split the 2400-line save switch into one file per annotation type (#454)`

De PR-tekst bevat de veldenlijst van `OpslagContext`, de regeltelling van `saver.js` vóór en na, en de uitslag van de afdrukvergelijking over de hele verificatieverzameling.

---

## Fase 7 — Laden per subtype

**Doel:** `js/pdf/loader/annotation-converter.js` van 1 549 naar ongeveer 200 regels. `converteerPdfAnnotatie` (regel 41-1546) heeft een `switch (annot.subtype)` met zeven takken over 1 426 regels.

**Wat verandert er voor de gebruiker:** niets. Dezelfde eis als fase 6: wat uit een PDF komt moet na de wijziging exact hetzelfde annotatieobject opleveren.

**Branch:** `refactor/454-fase-7-laden-per-subtype`

Zeven takken, één per PDF-subtype: `Highlight`, `Underline`, `StrikeOut`, `Line`, `Ink`, `PolyLine`, `Polygon`. Het zijn er weinig maar ze zijn zwaar; de `Line`-tak alleen al draagt pijlen, maatlijnen en hoekmeting.

De map `js/pdf/loader/` heeft dit patroon al: `geen-rand.js`, `annotatie-opmerking.js`, `ap-fill-alpha.js`, `tekstvak-rotatie.js`, `gedraaide-vorm-maat.js` en `extra-sleutel.js` zijn allemaal pure regelmodules met een eigen test. Deze fase breidt die map uit; ze bedenkt geen nieuwe indeling.

### Task 1: de laadcontext en de tabel

**Files:**
- Create: `open-pdf-studio/js/pdf/loader/laadcontext.js`
- Create: `open-pdf-studio/js/pdf/loader/laden-per-subtype.js`
- Test: `open-pdf-studio/js/pdf/loader/laadcontext.test.mjs`
- Modify: `open-pdf-studio/js/pdf/loader/annotation-converter.js:41-119`

**Interfaces:**
- Consumes: niets uit eerdere fasen.
- Produces:
  - `js/pdf/loader/laadcontext.js` exporteert `maakLaadcontext({annot, pageNum, viewport, stampImageMap, annotColorMap}): LaadContext` plus de afgeleide waarden die de preambule (regel 41-119) uitrekent.
  - `js/pdf/loader/laden-per-subtype.js` exporteert `LADERS: Record<string, (ctx: LaadContext) => object | null>` en `laderVoor(subtype: string): function | null`.

- [ ] **Step 1: Inventariseer de preambule**

```bash
cd open-pdf-studio && sed -n '41,120p' js/pdf/loader/annotation-converter.js
```

Schrijf op welke waarden daar worden uitgerekend en in de takken worden gelezen. De signatuur van `convertPdfAnnotation` is bekend: `(annot, pageNum, viewport, stampImageMap, annotColorMap)`.

- [ ] **Step 2: Schrijf de falende test**

Maak `open-pdf-studio/js/pdf/loader/laadcontext.test.mjs` met, naar het model van de bestaande tests in deze map, een minimale nepannotatie:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakLaadcontext } from './laadcontext.js';

const viewport = { width: 600, height: 800, rotation: 0 };

test('de context draagt de ruwe annotatie en het paginanummer door', () => {
  const annot = { subtype: 'Highlight', rect: [0, 0, 10, 10] };
  const ctx = maakLaadcontext({ annot, pageNum: 3, viewport, stampImageMap: new Map(), annotColorMap: new Map() });
  assert.equal(ctx.annot, annot);
  assert.equal(ctx.pageNum, 3);
  assert.equal(ctx.viewport, viewport);
});

test('de paginarotatie wordt genormaliseerd', () => {
  const ctx = maakLaadcontext({
    annot: { subtype: 'Line' }, pageNum: 1,
    viewport: { ...viewport, rotation: -90 },
    stampImageMap: new Map(), annotColorMap: new Map(),
  });
  assert.equal(ctx.paginaRotatie, 270);
});

test('een ontbrekende kaart wordt een lege kaart, geen undefined', () => {
  const ctx = maakLaadcontext({ annot: { subtype: 'Ink' }, pageNum: 1, viewport });
  assert.equal(ctx.stampImageMap.size, 0);
  assert.equal(ctx.annotColorMap.size, 0);
});
```

- [ ] **Step 3: Draai de test en controleer dat hij faalt**

```bash
cd open-pdf-studio && node --test js/pdf/loader/laadcontext.test.mjs
```

- [ ] **Step 4: Maak de contextmodule en de lege tabel**

`laadcontext.js` neemt de preambule uit Step 1 letterlijk over en geeft er een object mee terug. Gebruik `normDeg` uit `js/utils/math.js` (fase 4) voor de rotatienormalisatie — dat is precies waarom fase 4 vóór deze fase gaat.

`laden-per-subtype.js` krijgt dezelfde vorm als `tekenen-per-type.js` uit fase 5.

- [ ] **Step 5: Draai de test en controleer dat hij slaagt**

```bash
cd open-pdf-studio && node --test js/pdf/loader/laadcontext.test.mjs
```

- [ ] **Step 6: Bouw de context in `converteerPdfAnnotatie` en bewijs dat er niets verandert**

Zoals in fase 6 Task 1 Step 6: bouw de context, laat de `switch` ongewijzigd, en draai:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-mupdf-compare.mjs
```

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js/pdf/loader
git commit -m "refactor(load): make the annotation converter context explicit (#454)"
```

### Task 2: de zeven subtypen verhuizen

**Files:**
- Create: `open-pdf-studio/js/pdf/loader/subtypen/highlight.js`, `underline.js`, `strike-out.js`, `line.js`, `ink.js`, `poly-line.js`, `polygon.js`
- Modify: `open-pdf-studio/js/pdf/loader/laden-per-subtype.js`
- Modify: `open-pdf-studio/js/pdf/loader/annotation-converter.js`

**Interfaces:**
- Consumes: `maakLaadcontext` en `LADERS` uit Task 1.
- Produces: zeven modules, elk met één standaardexport `(ctx: LaadContext) => object | null` die het annotatieobject teruggeeft of `null` als het subtype in dit geval wordt overgeslagen.

- [ ] **Step 1: Verhuis `Highlight`, `Underline` en `StrikeOut`**

Die drie zijn de lichtste. Neem de inhoud letterlijk over; destructureer bovenaan de contextvelden die de tak gebruikt.

Leg dezelfde brug als in fase 5:

```js
  const lader = laderVoor(annot.subtype);
  if (lader) return lader(ctx);

  switch (annot.subtype) {
```

- [ ] **Step 2: Bewijs dat drie subtypen identiek laden**

Open in de rig een bestand met tekstmarkeringen, streep-door en onderstreping. Controleer met `app_list_annotations` dat elk veld hetzelfde is als vóór de wijziging: type, positie, kleur, dekking, opmerking. Sla op en vergelijk de afdruk (fase 6 Task 2) met een opslagbeurt van vóór deze fase.

- [ ] **Step 3: Verhuis `Ink`, `PolyLine` en `Polygon`**

Een voor een, met na elke verhuizing:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-doorlopend-inkt.mjs
```

`verify-doorlopend-inkt.mjs` is hier relevant: `Ink` is de tekenpen.

- [ ] **Step 4: Verhuis `Line` als laatste**

De `Line`-tak draagt de gewone lijn, de pijl, de maatlijn, de omtrekmeting en de hoekmeting. Schrijf vóór het knippen op welk deel van de tak bij welk app-type hoort, en houd dat onderscheid binnen één bestand `subtypen/line.js` — splits het niet verder in deze fase.

`js/pdf/loader/annotation-converter.js:1456` gebruikt daar de paginarotatie; die komt nu uit de context (`ctx.paginaRotatie`) in plaats van uit een eigen `((… % 360) + 360) % 360`.

- [ ] **Step 5: De volledige poort**

```bash
cd open-pdf-studio && wc -l js/pdf/loader/annotation-converter.js
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-opslag-rondgang.mjs
node scripts/verify-tekstrotatie.mjs
node scripts/verify-mupdf-compare.mjs
```

Plus: open elk bestand uit de verificatieverzameling en vergelijk het aantal en de soorten annotaties met de telling van vóór de fase. Een annotatie die niet meer uit de PDF komt is de meest waarschijnlijke fout hier, en geen enkel script merkt dat vanzelf.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/loader
git commit -m "refactor(load): one file per PDF annotation subtype (#454)"
```

### PR van fase 7

Titel: `refactor(load): split the annotation converter into one file per PDF subtype (#454)`

---

## Fase 8 — De overige reuzen

**Doel:** nul bestanden boven 800 regels. Na fase 5, 6 en 7 zijn `rendering.js`, `saver.js` en `annotation-converter.js` onder de grens; er blijven er 24 over.

**Wat verandert er voor de gebruiker:** niets. Elke taak is een verplaatsing.

**Branch:** `refactor/454-fase-8-<bestandsnaam>` — **één branch en één PR per bestand.** Dit is de enige fase die niet in één PR past; 24 bestanden splitsen in één keer is niet te reviewen en niet terug te draaien. De fase is af als de teller uit `node scripts/meet-js.mjs` op nul staat.

De 24 bestanden, met de stand na fase 2 t/m 7:

| Regels | Bestand | Aanpak |
|---:|---|---|
| 2 918 | `js/mcp-bridge.js` | Task 1 |
| 2 637 | `js/pdf/renderer.js` | Task 2 |
| 2 243 | `js/tools/text-edit-tool.js` | Task 3 |
| 1 927 | `js/solid/stores/propertiesStore.js` | per paneelsectie |
| 1 508 | `js/pdf/loader/color-extraction.js` | per kleurruimte |
| 1 278 | `js/annotations/transforms.js` | per type, zoals fase 5 |
| ~1 271 | `js/pdf/pdf-viewport.js` | zoom / pan / anker / omrekening |
| 1 235 | `js/tools/tools/measurement-tool.js` | per meetsoort |
| 1 233 | `js/pdf/loader.js` | openen / cache / structuur |
| ~1 190 | `js/annotations/systeemraster.js` | rooster / paneel / sparing |
| 1 190 | `js/solid/components/compare/CompareView.jsx` | per paneel |
| ~1 164 | `js/pdf/cad-import-logica.js` | per tabblad van het venster |
| 1 113 | `js/tools/tool-dispatcher.js` | per gebeurtenissoort |
| 1 107 | `js/solid/components/ContextMenu.jsx` | per menusectie |
| ~959 | `js/tools/snap-engine.js` | per vangsoort |
| 1 003 | `js/solid/components/dialogs/PrintDialog.jsx` | per tabblad |
| 987 | `js/tools/keyboard-handlers.js` | per toetsgroep |
| 978 | `js/solid/components/dialogs/CadImportDialog.jsx` | per tabblad |
| 973 | `js/pdf/page-manager.js` | invoegen / verwijderen / verplaatsen |
| ~898 | `js/ui/panels/left-panel.js` | per paneeltab |
| 923 | `js/core/undo-manager.js` | per bewerkingssoort |
| 867 | `js/annotations/geometry.js` | raaktest / omhullende / snijpunt |
| 839 | `js/annotations/handles.js` | per type, zoals fase 5 |
| 834 | `js/pdf/saver/appearance-vectors.js` | per vormsoort |

**Het vaste recept per bestand**, in deze volgorde:

1. Lees de functielijst: `grep -nE "^(export )?(async )?function |^const [A-Za-z_$]+ = " <bestand>`.
2. Groepeer de functies in twee tot zes samenhangende blokken en schrijf per blok op wat het doet en welke module-lokale staat het aanraakt. Gedeelde staat tussen twee blokken betekent: die twee blokken gaan sámen.
3. Maak een submap met de naam van het bestand zonder extensie, en verplaats elk blok letterlijk naar een eigen bestand daarin.
4. Het oorspronkelijke bestand houdt zijn naam en zijn exports, en wordt een dunne verzamelstaaf met `export { … } from './<submap>/<blok>.js';`. Zo verandert er voor geen enkele importeur iets.
5. Draai `npm run test:unit` en `npx vite build`, plus de poorten die bij dat bestand horen.

### Task 1: `js/mcp-bridge.js` — 2 918 regels

Na fase 3 Task 2 is dit bestand al lui en staat de console-ring apart. Het is nu een lijst van 78 `handle*`-functies achter één tabel `HANDLERS` (regel 2785-2861) en één `initMcpBridge` (2865).

**Files:**
- Create: `open-pdf-studio/js/mcp/handlers/invoer.js`, `weergave.js`, `annotaties.js`, `document.js`, `cad-print.js`, `assistent.js`
- Create: `open-pdf-studio/js/mcp/respond.js`
- Modify: `open-pdf-studio/js/mcp-bridge.js` — wordt de tabel plus `initMcpBridge`

**Interfaces:**
- Consumes: `CONSOLE_RING` uit `js/core/console-ring.js` (fase 3).
- Produces: elke handlermodule exporteert benoemde `handle*`-functies met de bestaande namen en signatuur `(params: object) => Promise<{ok: true, …} | {ok: false, error: string}>`. `js/mcp/respond.js` exporteert `respond(requestId: number, result: object): Promise<void>` en `tauriInvoke(): Function | null`.

De indeling volgt de bestaande blokcomments in het bestand:

| Module | Functies | Regels in `mcp-bridge.js` |
|---|---|---|
| `respond.js` | `tauriInvoke`, `respond`, `waitForActiveLoad`, `compositeCurrentView` | 27-137 |
| `handlers/invoer.js` | `buttonIndexFor`, `buttonsMaskFor`, `makeMouseInit`, `makePointerInit`, `dispatchPointerAndMouse`, `targetAt`, `describeTarget`, `handleMouseMove`, `handleMouseClick`, `handleMouseDrag`, `handleScroll`, `codeForChar`, `makeKeyInit`, `handleKey`, `handleType` | 245-554 |
| `handlers/weergave.js` | `handleOpenPdf`, `handleSetZoom`, `handleZoomIn`, `handleZoomOut`, `handleScreenshotView`, `handleGetViewportState`, `handleGetRecentConsole`, `_waitForRenderIdle`, `_captureCanvasState`, `handleGoToPage`, `handleClearCaches`, `handleWheelZoom`, `handleZoomAnchorTest`, `handleSetViewMode`, `handleFitPage`, `handleFitWidth` | 140-244, 555-960, 1808-1857 |
| `handlers/annotaties.js` | `_redrawActive`, `_isNum`, `_validPoints`, `_sanitizeAnnotation`, `_summarizeAnnotation`, `_recomputeMeasureFields`, `handleSetTool`, `handleGetCurrentTool`, `_buildCreateProps`, `handleCreateAnnotation`, `handleListAnnotations`, `handleGetAnnotation`, `handleUpdateAnnotation`, `handleDeleteAnnotation`, `handleSelectAnnotation`, `handleClearSelection`, `handleUndo`, `handleRedo`, `handleSetMeasureScale`, `handleGetTakeoff`, `handlePlaceSchedule`, `handleSnippetCut`, `handleSnippetPaste`, `handleSnippetFlatten`, `handleSymbolScale` | 961-1677, 1865-1886, 1948-2046, 2262-2344 |
| `handlers/document.js` | `handleListTabs`, `handleSwitchTab`, `handleCloseTab`, `handleNewBlankPdf`, `handleSavePdf`, `handleGetPageCount`, `handleMergePdf`, `_isElementDisabled`, `_findElementAcrossTabs`, `handleClickElement`, `handleUiState`, `_knopLabel`, `_lintKnoppenPerTab`, `handleListCommands`, `handleRunCommand` | 803-833, 1678-1807, 1858-1864, 2047-2261 |
| `handlers/cad-print.js` | `handleTitleblock`, `handleImportCad`, `handleExportCad`, `bereidPrintVoor`, `handlePrintToPdf`, `handlePrint`, `handleListPrinters` | 2345-2784 |
| `handlers/assistent.js` | `handleAiComplete`, `handleAccountsStatus`, `handleAccountsFetch`, `handleAssistantAsk`, `handleAssistantPending`, `handleAssistantAnswer`, `handleAssistantHistory` | 1887-1947 |

- [ ] **Step 1: Controleer dat `_buildCreateProps` alleen door `handleCreateAnnotation` wordt gebruikt**

```bash
cd open-pdf-studio && grep -n "_buildCreateProps" js/mcp-bridge.js
```

`_buildCreateProps` is 344 regels (1071-1414) met een eigen `switch` over 30 annotatiesoorten. Heeft hij maar één aanroeper, verplaats hem dan naar een eigen `js/mcp/handlers/annotatie-eigenschappen.js`, anders wordt `annotaties.js` zelf te groot.

- [ ] **Step 2: Maak `js/mcp/respond.js`**

Neem regels 27-137 letterlijk over. Dit is de enige module die de andere zes gemeen hebben.

- [ ] **Step 3: Verhuis de zes handlergroepen, één per commit**

Per groep: nieuw bestand, functies letterlijk overnemen, de bijbehorende regels uit `mcp-bridge.js` halen, de import toevoegen bovenaan `mcp-bridge.js`, en de `HANDLERS`-tabel ongewijzigd laten — de namen aan de rechterkant blijven exact hetzelfde.

De handlers gebruiken uitsluitend `await import()` voor app-modules; houd dat zo. Zet geen statische import van `renderer.js` of `state.js` in een handlermodule, want dat is precies wat fase 3 net heeft weggehaald.

- [ ] **Step 4: Controleer dat alle 78 opdrachten nog werken**

```bash
cd open-pdf-studio && node --test ../mcp-stdio/brug.test.mjs
```

En in de rig, met de MCP-server actief: draai `app_list_commands` en controleer dat de lijst even lang is als vóór de wijziging. Draai daarna minstens één opdracht per handlergroep.

- [ ] **Step 5: Meet en commit**

```bash
cd open-pdf-studio && wc -l js/mcp-bridge.js js/mcp/handlers/*.js js/mcp/respond.js
git add open-pdf-studio/js/mcp open-pdf-studio/js/mcp-bridge.js
git commit -m "refactor(mcp): split the bridge into six handler modules (#454)"
```

### Task 2: `js/pdf/renderer.js` — 2 637 regels

Het bestand valt langs zijn eigen blokcomments uiteen in vijf samenhangende delen.

**Files:**
- Create: `open-pdf-studio/js/pdf/renderer/bitmap-cache.js`, `canvas-setup.js`, `enkele-pagina.js`, `doorlopend.js`, `navigatie.js`, `pagina-rotatie.js`
- Modify: `open-pdf-studio/js/pdf/renderer.js` — wordt een verzamelstaaf

**Interfaces:**
- Consumes: niets uit eerdere fasen behalve `rotatePoint` uit `js/utils/math.js` (fase 4) en de hernoeming van `rotatePoint` naar `remapPointForPageRotation` (fase 4 Task 5 Step 6).
- Produces: `js/pdf/renderer.js` houdt **exact** dezelfde exports als nu: `getCanvasDPR`, `_clearJSBitmapCache`, `renderPage`, `renderPageOffscreen`, `reRenderVisibleContinuousPages`, `continuousZoomBy`, `renderContinuous`, `setViewMode`, `goToPage`, `zoomIn`, `zoomOut`, `setZoom`, `fitWidth`, `fitPage`, `actualSize`. (De dode exports zijn in fase 2 al weg.)

| Module | Regels | Inhoud |
|---|---|---|
| `bitmap-cache.js` | 25-86 | de JS-bitmapcache met LRU-grens |
| `canvas-setup.js` | 6-23, 88-227 | canvas-referenties, HiDPI, de knipmaskers voor de doorlopende weergave, de hangdetector |
| `enkele-pagina.js` | 228-1045 | `renderPage`, `_renderPageImpl`, `tekenPaginaMetPdfJs`, `renderPageOffscreen`, de scherpe overlay, de lage-resolutievoorbeelden |
| `doorlopend.js` | 1046-1810 | `renderContinuousPage`, `reRenderVisibleContinuousPages`, de zoom- en schuifsynchronisatie, `renderContinuous`, `setupContinuousPageEvents` |
| `navigatie.js` | 1811-2299 | spreidingspariteit, `setViewMode`, het vooruitlezen, `goToPage`, `zoomIn`/`zoomOut`/`setZoom`, `fitWidth`/`fitPage`/`actualSize` |
| `pagina-rotatie.js` | 2300-2637 | `remapPointForPageRotation`, `remapRectForPageRotation` en de annotatie-omrekening bij een paginarotatie |

- [ ] **Step 1: Verhuis `pagina-rotatie.js` als eerste**

Dat blok (2300-2637, 338 regels) is het meest zelfstandig en het best te testen. Schrijf er meteen een test bij, `open-pdf-studio/js/pdf/pagina-rotatie.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapPointForPageRotation, remapRectForPageRotation } from './renderer/pagina-rotatie.js';

test('zonder rotatie blijft een punt staan', () => {
  assert.deepEqual(remapPointForPageRotation(3, 4, 0, 100, 200), { x: 3, y: 4 });
});

test('een kwartslag wisselt de assen om', () => {
  assert.deepEqual(remapPointForPageRotation(10, 20, 90, 100, 200), { x: 200 - 20, y: 10 });
});

test('een halve slag spiegelt in beide richtingen', () => {
  assert.deepEqual(remapPointForPageRotation(10, 20, 180, 100, 200), { x: 100 - 10, y: 200 - 20 });
});

test('een kwartslag wisselt breedte en hoogte van een rechthoek', () => {
  const r = remapRectForPageRotation(10, 20, 30, 40, 90, 100, 200);
  assert.equal(r.width, 40);
  assert.equal(r.height, 30);
});
```

Controleer de verwachte waarden eerst tegen de bestaande implementatie op regel 2302-2320 — dit is een karakteriseringstest die het huidige gedrag vastlegt, niet een test die nieuw gedrag voorschrijft. Wijkt de implementatie af van wat hierboven staat, pas dan de test aan, niet de implementatie.

- [ ] **Step 2: Draai de karakteriseringstest tegen de nog onverplaatste code**

Importeer tijdelijk uit `./renderer.js` in plaats van `./renderer/pagina-rotatie.js`, draai de test, en zorg dat hij groen is vóór er iets verhuist.

```bash
cd open-pdf-studio && node --test js/pdf/pagina-rotatie.test.mjs
```

- [ ] **Step 3: Verhuis het blok en zet de import terug**

Verplaats regels 2300-2637 naar `js/pdf/renderer/pagina-rotatie.js`, zet in `renderer.js` een `export { … } from './renderer/pagina-rotatie.js';` voor wat daar geëxporteerd werd, en laat de test uit `./renderer/pagina-rotatie.js` importeren.

- [ ] **Step 4: Verhuis de overige vijf blokken, één per commit**

Per blok: verplaatsen, de doorexport in `renderer.js` zetten, en daarna:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-doorlopend-inkt.mjs
node scripts/verify-snelzoom.mjs
node scripts/verify-mupdf-compare.mjs
```

`bitmap-cache.js` en `canvas-setup.js` eerst, dan `navigatie.js`, dan `enkele-pagina.js`, dan `doorlopend.js`. De laatste twee delen staat (de scherpe overlay, de knipmaskers); als die staat niet schoon te scheiden is, laat ze dan in één module en accepteer dat die module rond de 900 regels uitkomt — noteer dat in de PR-tekst met de reden.

- [ ] **Step 5: Controleer de prestaties**

Dit bestand is het hart van de weergave. Draai de prestatievergelijking uit het testprotocol tegen de vorige release:

```bash
node scripts/verify-prestaties.mjs "<exe-vorige-release>" "vX.Y" "<exe-nieuwe-build>" "vX.Z"
```

Een meting die meer dan tweemaal zo traag is als de vorige release blokkeert de PR.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer open-pdf-studio/js/pdf/renderer.js \
        open-pdf-studio/js/pdf/pagina-rotatie.test.mjs
git commit -m "refactor(render): split the renderer into six focused modules (#454)"
```

### Task 3: `js/tools/text-edit-tool.js` — 2 243 regels

Na fase 2 is `createReplaceTextEdit` (83 regels) al weg.

**Files:**
- Create: `open-pdf-studio/js/tools/text-edit/invoer.js`, `selectie.js`, `bewerking.js`, `weergave.js`
- Modify: `open-pdf-studio/js/tools/text-edit-tool.js`

**Interfaces:**
- Consumes: niets.
- Produces: `js/tools/text-edit-tool.js` houdt dezelfde exports.

- [ ] **Step 1: Lees de functielijst en groepeer**

```bash
cd open-pdf-studio && grep -nE "^(export )?(async )?function |^const [A-Za-z_$]+ = " js/tools/text-edit-tool.js
```

Groepeer in vier blokken: toetsenbord- en muisinvoer, tekstselectie en cursor, de bewerking zelf (invoegen, verwijderen, vervangen), en de weergave (de overlay en de meting). Schrijf per blok op welke module-lokale staat het aanraakt; is er gedeelde staat, trek die dan eerst in een eigen `text-edit/staat.js`.

- [ ] **Step 2 t/m 5: het vaste recept**

Volg de vijf stappen van het recept boven aan deze fase. De poort voor dit bestand:

```bash
cd open-pdf-studio && npm run test:unit
cd open-pdf-studio && npx vite build
node scripts/verify-tekstrotatie.mjs
node scripts/verify-opslag-rondgang.mjs
```

Plus handmatig in de rig: een tekstvak maken, tekst typen, een deel selecteren, vet en cursief zetten, de lettergrootte wijzigen, het vak draaien, opslaan en heropenen.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/tools/text-edit open-pdf-studio/js/tools/text-edit-tool.js
git commit -m "refactor(text): split the text edit tool into four modules (#454)"
```

### Task 4 t/m 24: de overige bestanden

Elk bestand uit de tabel bovenaan deze fase krijgt een eigen taak met het vaste recept en een eigen PR. Twee bestanden verdienen een aantekening vooraf:

- **`js/annotations/transforms.js` en `js/annotations/handles.js`** hebben dezelfde 42-typen-`switch` als fase 5 en 6. Gebruik dezelfde tabelaanpak en, waar mogelijk, dezelfde bestandsnamen onder `js/annotations/transforms/typen/` en `js/annotations/handles/typen/`. Doe ze ná fase 5, zodat de typenamen al vastliggen.
- **`js/pdf/loader/color-extraction.js`** (1 508 regels) valt uiteen per kleurruimte (DeviceRGB, DeviceCMYK, ICCBased, Indexed, Separation). Dat is een gebied met veel randgevallen en weinig tests; schrijf per kleurruimte eerst een karakteriseringstest op echte PDF-bytes uit de verificatieverzameling, en verhuis daarna pas.

### PR's van fase 8

Eén per bestand. Titel: `refactor(<gebied>): split <bestand> into focused modules (#454)`.

De laatste PR van de fase voegt een bewaking toe zodat het niet opnieuw scheefgroeit — een regel in `scripts/meet-js.test.mjs` die faalt zodra een bestand boven de 800 uitkomt:

```js
test('geen enkel bronbestand komt boven 800 regels', () => {
  const r = telRegels(new URL('../js', import.meta.url).pathname);
  assert.deepEqual(r.groot.map((g) => g.pad), []);
});
```

Zet die test pas aan als de teller werkelijk op nul staat; eerder maakt hij de suite rood.

---

## Risico's en wat we NIET doen

### Wat we bewust laten staan

**De legacy-laag `js/ui/**` opheffen.** 24 bestanden, 5 021 regels. Een deel is pure doorgeefluik (`menus.js` is 6 regels), maar `attachments.js` (407), `links.js` (381), `bookmarks.js` (400) en `left-panel.js` (928) bevatten echte logica die PDF-structuren uitleest en het resultaat via `js/bridge.ts` in de Solid-stores duwt. Die laag opheffen betekent dat logica naar Solid-componenten verhuist, en dat is een herontwerp met gedragsrisico, geen opruiming. Alleen de lege stubs gaan weg (fase 2 Task 2) en `left-panel.js` wordt gesplitst (fase 8), zodat de laag beter te lezen wordt zonder hem aan te tasten.

**`js/bridge.ts` opheffen.** De brug doorexporteert Solid-stores onder aliassen naar 54 bestanden. Hem weghalen levert 285 regels op en kost 54 bestandswijzigingen — een slechte verhouding. Bovendien is de ontkoppeling die hij biedt echt: de storeimplementaties kunnen veranderen zonder dat 54 bestanden meebewegen. Alleen de 21 ongebruikte doorexports gaan weg (fase 2 Task 4 Step 4).

**Werk naar Rust verplaatsen.** Issue #421 noemt dit als richting: PDF-lezen en -schrijven, meetkunde en paginaherschrijving zitten half in Rust. Dat is een verplaatsing van 30 000 regels JavaScript naar een taal waar minder mensen aan meelezen, met een nieuw IPC-oppervlak en nieuwe serialisatie per aanroep. Dat is een architectuurbeslissing, geen opruiming, en het hoort in een eigen ontwerp met een eigen afweging. **Niet in dit plan.**

**`pdf-lib` of `pdfjs-dist` vervangen of lui maken.** `pdf-lib` heeft 29 statische importeurs, waaronder `js/pdf/loader.js:9` — het documentopen-pad. `pdfjs-dist` heeft er zeven, ook op dat pad. Lui maken vraagt een asynchrone laag rond elke aanroep en levert niets op, want de gebruiker opent altijd een PDF. Vervangen is een project op zich. De twee statische randen die wél weg kunnen (`NewDocDialog.jsx:2` en `compare-viewport.js:13`) verdwijnen vanzelf zodra de vensters en de vergelijker lui zijn (fase 3).

**De dialoogschil samenvoegen.** Die is al samengevoegd: `js/solid/components/Dialog.jsx` draagt de Windows-schil, en de 47 vensters gebruiken hem. Wat overblijft is per venster een handvol regels voetknoppen en `useTranslation`-aanroepen. Slechts twee van de 47 vensters hebben nog eigen sleeplogica. Hier is geen 2 000 regels te halen, wel drie uur werk en het risico op 47 kleine stijlverschillen.

**DOM-bouw-boilerplate wegautomatiseren.** Gemeten: 75 `document.createElement`-aanroepen in de hele `js/**`-boom, met als hoogste 8 in één bestand. Er is geen boilerplate-probleem. De UI is SolidJS; de resterende `createElement`-aanroepen zitten in de tekstlaag, de schermafdruk en het beeldextractiepad, waar een echt DOM-element nodig is.

**i18n-helpers samenvoegen.** Ook al gedaan, en goed: `js/i18n/config.js:9` gebruikt een niet-gretige `import.meta.glob` over 39 talen en 4,7 MB; alleen Engels en de actieve taal worden opgehaald. `useTranslation.js` is 55 regels en wordt door 126 modules gebruikt. Hier valt niets te winnen en er is veel te breken.

**`manualChunks` in `vite.config.js` instellen.** Een dynamische import levert al een eigen chunk op. Handmatige chunkgroepen zetten daar een tweede, deels tegenstrijdige indeling naast, en bij een verkeerde groepering laden er méér bytes dan nodig. Fase 3 lost de splitsing bij de bron op — bij de importregel — en niet in de bundlerconfiguratie.

**De 621 `await import()`-plekken opruimen.** Veruit de meeste zijn cyclusbrekers, geen splitsingen: de doelen (`state.js` 38×, `manager.js` 38×, `renderer.js` 35×) zijn ook statisch bereikbaar, dus ze leveren geen chunk op. Ze omzetten naar statische imports zou de cycli terugbrengen die ze juist oplossen. Laat ze staan.

**`generateImageId`, `genGuid` en `normalizePageRotation` samenvoegen met hun familie.** `generateImageId` staat in opgeslagen documenten; wijzigen breekt verwijzingen naar ingebedde afbeeldingen. `genGuid` moet een echte RFC-4122-v4 zijn omdat BCF dat eist. `normalizePageRotation` is strenger dan `normDeg` — hij geeft 0 voor alles wat geen exact veelvoud van 90 is — en die strengheid zit op het tekstrotatiepad waar de regressies vandaan kwamen. Alle drie blijven zoals ze zijn.

### Risico's van wat we wél doen

| Risico | Waar | Wat het afvangt |
|---|---|---|
| Een "dode" export blijkt via een tekenreeks aangeroepen (MCP-opdrachtnaam, i18n-sleutel, DOM-id) | fase 2 | De verplichte drievoudige grep vóór elke verwijdering, en de expliciete lijst van wat is blijven staan in de PR-tekst |
| Een lui geladen venster komt te laat voor een `showMessage()` uit een foutpad | fase 3 Task 3 | Het handmatig openen van alle 47 vensters, met `message` en `confirm` expliciet genoemd |
| De console-ring mist de eerste regels omdat hij nu vanuit `main.js` start | fase 3 Task 2 | `startConsoleCapture()` staat vóór alle andere imports; de MiniLog wordt in de rig gecontroleerd |
| Twee id-generators in de naamruimte `sp_` krijgen een andere lengte dan voorheen | fase 4 Task 3 | De opslag-rondgang plus een handmatige controle op een opgeslagen stijlvoorinstelling |
| `escapeXml` gaat van `"null"` naar leeg in een XFDF-bestand | fase 4 Task 7 | Een XFDF-export gevolgd door een import, handmatig |
| Een omhullende-lus deed stilletjes iets extra's | fase 4 Task 6 | De regel "vervang alleen als de lus precies dit doet"; twijfelgevallen blijven staan en komen in de PR-tekst |
| Een verplaatste teken- of opslagtak gedraagt zich net anders | fase 5, 6, 7 | Verhuizen is letterlijk; de vergelijkings-sweep moet exact dezelfde pagina's vlaggen, en fase 6 heeft daarbovenop de byte-afdruk |
| De opslagcontext mist een veld dat een tak uit de afsluiting las | fase 6 Task 1 | `maakOpslagcontext` gooit bij een ontbrekend én bij een onbekend veld; de context wordt eerst gebouwd zonder gebruikt te worden |
| Het splitsen van `renderer.js` kost prestaties | fase 8 Task 2 | De prestatievergelijking uit het testprotocol; meer dan tweemaal zo traag blokkeert |
| Een annotatie komt na fase 7 niet meer uit de PDF | fase 7 Task 2 Step 5 | Per verificatiebestand het aantal en de soorten annotaties tellen vóór en na — geen enkel script doet dat vanzelf |

### Wat er niet gemeten kon worden

- **Chunkgroottes in bytes.** `node_modules` was niet geïnstalleerd, dus `npx vite build` kon niet draaien. Alle kB-getallen in dit plan zijn afgeleid uit de statische modulegraaf en uit de regelaantallen per gebied. De eerste taak van wie fase 3 uitvoert is `npm ci` en dan `npx vite build`, om de werkelijke nullijn vast te leggen.
- **`npm run test:unit` is niet gedraaid.** Dezelfde reden: de 113 testbestanden importeren app-modules die `solid-js` en `pdf-lib` nodig hebben.
- **Aanroepen via een tekenreeks.** De dode-code-analyse is een identifier-scan. Een functie die alleen via `window[naam]()`, een MCP-opdrachtnaam of een i18n-sleutel wordt bereikt, telt als dood terwijl hij dat niet is. Daarom staat in fase 2 vóór elke verwijdering een verplichte grep over `js/`, `index.html`, `src-tauri/`, `mcp-server/`, `mcp-stdio/` en `scripts/`.
- **Of twee "equivalente" helpers echt hetzelfde doen op elke invoer.** De vergelijking is met de hand gedaan op de code, niet met een generator over willekeurige invoer. Waar een verschil is gevonden, staat het in dit plan; waar er een is gemist, vangt de poort van de betreffende fase het op.

---

## Zelfcontrole

Het plan is na het schrijven tegen issue #454 gelegd. De richtingen uit het issue, en waar ze landen:

| Richting uit #454 | Fase |
|---|---|
| 1. Dode en dubbele code | fase 2 (dood) en fase 4 (dubbel) |
| 2. Eén regel, één plek | fase 4, met `js/utils/math.js`, `js/utils/colors.js`, `js/utils/helpers.js` en `js/annotations/tekstmaat.js` als canonieke plekken, elk met een test onder `node --test` |
| 3. Elk bestand boven ~800 regels krijgt een plan, `rendering.js`, `saver.js`, `renderer.js` en `mcp-bridge.js` eerst | fase 5 (`rendering.js`), 6 (`saver.js`), 8 Task 1 (`mcp-bridge.js`), 8 Task 2 (`renderer.js`), en 8 Task 4 e.v. voor de andere 21 |
| 4. Per-type tabellen in plaats van `switch`-ketens | fase 5 (tekenen), 6 (opslaan), 7 (laden), 8 (transforms en handles) |
| 5. Lui laden van vensters, symbolencatalogus, CAD, OCR, handtekeningen en afdrukken | fase 3 — met de aantekening dat OCR en BCF al lui waren, en dat de symbolencatalogus via `js/symbols/registry.js` dertien statische importeurs heeft en daarom in fase 8 hoort, niet in fase 3 |
| 6. Afhankelijkheden nalopen | gemeten en verantwoord onder "Bundel" en "wat we NIET doen": fontkit en mupdf zijn al lui met elk één importplek, de taalbestanden zijn al gesplitst, en `pdf-lib` en `pdfjs-dist` staan op het documentopen-pad |
| "Done" = geen bestand boven ~800 regels | fase 8, met een bewakingstest in `scripts/meet-js.test.mjs` |
| "Done" = elke regel op één plek met een test | fase 4, plus de pure modules uit fase 5, 6 en 7 |
| "Done" = meetbaar kleinere eerste lading | fase 3, gemeten met `node scripts/meet-js.mjs` en `npx vite build` |
| Veilig werken: één gebied tegelijk, karakteriseringstests eerst, de release-poort daarna | elke fase is één PR; fase 5, 6, 7 en 8 Task 2 beginnen met een karakteriseringstest vóór de eerste verplaatsing |
| Relatie met #451 (de lichte web-eenheid) | fase 3 en fase 5-7 maken de gedeelde kern kleiner: `js/annotations/rendering/typen/` en `js/pdf/saver/typen/` zijn precies de brokken die de web-eenheid selectief kan meenemen |

**Verwachte totale winst**, als alle acht fasen af zijn:

| | Regels | Bestanden >800 | Ingangschunk |
|---|---:|---:|---|
| Nu | 136 482 | 27 | ~3,5 MB (opgave uit #454; niet zelf gemeten) |
| Na fase 2 | ~135 430 | 27 | gelijk |
| Na fase 3 | ~135 430 | 27 | −35 à −45 % |
| Na fase 4 | ~134 600 | 27 | gelijk |
| Na fase 5, 6, 7 | ~134 600 (plus ~90 bestandskoppen) | 24 | gelijk |
| Na fase 8 | ~134 600 | 0 | gelijk |

Dat is ongeveer **−1 900 regels**, 1,4 %. Dat is eerlijk gezegd weinig, en het is belangrijk dat het vooraf zo staat: **de winst van dit plan zit niet in het regelaantal.** De codebase is niet opgeblazen met kopieer-plakwerk — de kloondetectie vond 66 groepen boven twaalf regels en drie dode bestanden. Wat er wél is: drie functies van samen 6 434 regels, 27 bestanden die samen 29 % van de bron dragen, en 19 % van de hoofdchunk achter functies die de meeste gebruikers nooit openen. Dat zijn de drie dingen die dit plan aanpakt: **wat de app bij het opstarten laadt, hoe groot de grootste eenheid is die iemand moet begrijpen, en hoeveel plekken je moet aanpassen om één regel te veranderen.**

Wie meer regels wil zien verdwijnen, komt uit bij het verplaatsen van werk naar Rust (issue #421) — en dat is een architectuurbeslissing, geen opruiming.
