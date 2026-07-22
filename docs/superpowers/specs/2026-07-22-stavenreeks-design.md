# Stavenreeks — parametrisch constructie-object (ontwerp)

**Doel:** een nieuw parametrisch annotatie-object "stavenreeks" bij de
constructieve tekengereedschappen: een wapeningsstaven-reeks zoals in
constructietekeningen — een reekslijn met schuine poten die elk in een punt
eindigen (staafposities), met een label `N ⌀ D` (aantal × diameter).

## Visuele opbouw (uit de referentie-afbeelding)

```
   •   •   •                         reekslijn ───────────────  N ⌀ D
    \   \   \                                  \   \   \   \
     ───────────────  N ⌀ D                     •   •   •   •
```

- **Reekslijn**: horizontale (of onder een hoek getekende) basislijn.
- **Poten**: N schuine aftakkingen, gelijkmatig verdeeld over de lijn, elk
  eindigend in een gevulde **punt** (•) = één staafpositie. Aantal punten =
  `count`.
- **Label**: `N ⌀ D` aan één uiteinde (N = aantal, ⌀ = diametersymbool,
  D = diameter in mm). Diametersymbool is de doorstreepte-⌀ glyph.
- **Puntgrootte** schaalt mee met de diameter (dikkere staaf → dikkere punt).
- **Pootrichting** spiegelbaar: poten boven/onder de lijn × links/rechts
  hellend (4 combinaties).

## Diameters

Standaard wapeningsstaaf-diameters als dropdown:
**6, 8, 10, 12, 16, 20, 25, 32, 40 mm**. Default 12.

## Datamodel (annotatie)

Nieuw type `'stavenreeks'` in `js/types/annotation.ts`. Velden:

| Veld | Betekenis | Default |
|---|---|---|
| `startX,startY,endX,endY` | uiteinden van de reekslijn (app-coords) | uit sleep |
| `count` | aantal staven (= aantal poten/punten) | 3 |
| `diameter` | staafdiameter in mm (uit vaste lijst) | 12 |
| `barLengthMm` | staaflengte in mm (voor hoeveelheden; 0 = onbekend) | 0 |
| `legDir` | pootrichting: `'down-left'|'down-right'|'up-left'|'up-right'` | 'down-left' |
| `legLength` | pootlengte in px (canvas) | 24 |
| `labelSide` | `'start'|'end'` — aan welk uiteinde het label staat | 'end' |
| `color`, `lineWidth`, `opacity` | opmaak | zwart, 1, 1 |
| `ifcCategory` | 'Wapening' (mapping-laag) | afgeleid |

Puntstraal = `f(diameter)`: `2 + diameter * 0.12` px op scale 1 (⌀12 → ~3.4px,
⌀40 → ~6.8px), begrensd op [2, 9].

## Interactie

- **Gereedschap**: knop **Stavenreeks** in DrawingTab, in een constructieve
  groep (bij de schaal/annotate-blokken). Tool-id `stavenreeks`.
- **Plaatsen (slepen)**: sleep begin→eind = richting + lengte van de
  reekslijn. Bij een niet-sleep (klik) een standaardlengte (120px) horizontaal
  naar rechts. Snap-engine: eindpunt snapt zoals de lijn-tool.
- **Bewerken**: handles op start- en eindpunt (verplaatsen/verlengen), zelfde
  patroon als `measureDistance`. Rotatie volgt uit de lijnrichting; geen aparte
  rotatie-handle nodig (poten staan altijd loodrecht-schuin t.o.v. de lijn).
- **Eigenschappen-paneel**: sectie "Stavenreeks" met aantal (stepper),
  diameter (dropdown 6–40), staaflengte (mm-invoer), pootrichting (4 knoppen /
  segmented), pootlengte, labelzijde, plus de standaard kleur/lijndikte.

## Rendering (`rendering.js`, nieuwe `case 'stavenreeks'`)

1. Teken de reekslijn `start→end` met `color`/`lineWidth`.
2. Verdeel `count` posities gelijkmatig over de lijn (inclusief de uiteinden
   bij count≥2; count=1 → midden).
3. Per positie: teken een poot in de hoek van `legDir` (loodrecht-45° t.o.v.
   de lijn), eindigend in een gevulde cirkel met straal = puntstraal(diameter).
4. Teken het label `N ⌀ D` aan de `labelSide`, uitgelijnd langs de lijnrichting
   (net voorbij het uiteinde), met het doorstreepte-⌀ symbool. Fontgrootte
   schaalt met lijndikte/zoom zoals bij measureDistance-labels.
5. Rotatie-veilig: alle geometrie afgeleid uit de vier coördinaten, geen
   losse `rotation`-transform (voorkomt de rotatie-regressieklasse).

## Hoeveelheden / IFC

- `js/quantities/categories.js`: `TYPE_TO_CATEGORY.stavenreeks = 'line-based'`
  (nieuwe subklasse 'reinforcement' mag ook, maar line-based hergebruikt de
  lengte-infra). `TYPE_NAMES.stavenreeks = 'Stavenreeks'`. Uitleesbare velden:
  `count`, `diameter`, `barLengthMm`, en afgeleid **totale staaflengte** =
  `count * barLengthMm` (mm→m), zodat de schedule per reeks stuks + strekkende
  meter toont.
- `js/solid/data/ifcCategoryMap.js`: type `stavenreeks` → IFC-categorie
  "Wapening" (IfcReinforcingBar-achtig, generiek label — géén productnamen).
- IFC-report/take-off pikken het via de bestaande veld-mapping op.

## Persistentie — HARDE EIS: zichtbaar én verplaatsbaar in andere PDF-editors

De stavenreeks moet in elke andere PDF-editor (a) **zichtbaar** zijn en (b) als
**één object selecteerbaar en verplaatsbaar** zijn. Dat sluit "in de
pagina-content bakken" uit: het moet een echte PDF-annotatie zijn met een
eigen appearance-stream.

**Vorm:** ÉÉN annotatie per stavenreeks (subtype `/Stamp` — het gangbare
subtype voor samengestelde vectorgrafiek dat editors als één verplaatsbaar
object behandelen), met:

- `/AP` `/N` = Form-XObject dat de HELE reeks tekent (reekslijn + poten +
  punten + label `N ⌀ D`) — daardoor zichtbaar in elke viewer.
- `/Rect` = de assen-uitgelijnde omhullende (AABB) van het volledige element,
  inclusief poten, punten én label. Verplaatsen in een andere editor verschuift
  `/Rect`; de appearance schuift mee.
- `/BBox` = `/Rect`-afmeting, `/Matrix` = **identiteit**, en **géén** top-level
  `/Rotate`. Dit is de canonieke conventie uit
  `docs/superpowers/research-pdf-rotatie-mechanica.md` (§12.5.5): zo wordt de
  appearance-mapping A = identiteit en renderen alle viewers identiek. Een
  schuine reekslijn wordt dus getekend via de coördinaten binnen de stream,
  niet via een matrix-rotatie.
- Parameters voor onze eigen parametrische bewerking in custom keys
  (`OPS_Stavenreeks` o.i.d.: count, diameter, barLengthMm, legDir, legLength,
  labelSide) + `/Contents` met een leesbare tekst (`"5 ⌀ 16"`) zodat andere
  editors iets zinnigs tonen in hun annotatielijst.

**Round-trip-eis:** openen → verplaatsen in een andere editor → heropenen in
onze app moet de reeks op de nieuwe plek tonen met alle parameters intact
(positie volgt uit `/Rect`; de interne geometrie wordt relatief aan `/Rect`
gereconstrueerd). Bij ontbrekende custom keys (bewerkt door een andere editor)
val je terug op tonen-zoals-de-appearance, niet crashen.

**Verificatie (verplicht):** na opslaan de kopie openen in pypdfium2 én
PyMuPDF → element zichtbaar op de juiste plek; annotatie-dict tonen aan dat
subtype/Rect/BBox/Matrix conform bovenstaande zijn; daarna in onze app
heropenen → parameters identiek.

## i18n

Nieuwe sleutels in ALLE 39 talen (en+nl correct, rest en): `drawing.rebarSeries`
(knoplabel/tooltip), `stavenreeks.count`, `.diameter`, `.barLength`,
`.legDirection`, `.legLength`, `.labelSide` in de juiste namespace
(`ribbon` voor de knop, `properties` voor de paneelvelden).

## Verificatie (verplicht vóór commit)

1. Unit-test `scripts/test-stavenreeks.mjs`: geometrie (posities gelijkmatig,
   puntstraal per diameter, label-tekst `N ⌀ D`) + hoeveelheden-afleiding
   (count × barLength).
2. Rig: gereedschap kiezen, slepen op een leeg A4, screenshot — reekslijn +
   N punten + label kloppen; diameter/aantal wijzigen in het paneel werkt;
   pootrichting spiegelen werkt; hoeveelhedenstaat toont stuks + lengte.
3. Fase-A-rooktest DrawingTab groen (de nieuwe knop mag geen gat zijn).
4. **Volledige rotatie-sweep + MuPDF-vergelijkingssweep** (het vaste protocol):
   geen enkele regressie op bestaande bestanden. Save→reload round-trip van een
   getekende stavenreeks: parameters identiek.
5. `npm run build` groen; `node --check`/esbuild op alle gewijzigde bestanden.
