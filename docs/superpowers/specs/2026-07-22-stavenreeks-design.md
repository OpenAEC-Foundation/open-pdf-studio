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

## Persistentie

Round-trip zoals `parametricSymbol`: opslaan via de app-specifieke
annotatie-serialisatie (zie hoe `saver.js`/`xfdf.js` parametricSymbol/scaleBar
wegschrijven en teruglezen — alle parameters mee). Rotatie-veilig: geen
gebakken /Rotate nodig; het is een vector-getekend overlay-object.

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
