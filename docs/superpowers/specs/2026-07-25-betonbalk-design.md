# Betonbalk — doortekenbaar balkobject in plattegrond (ontwerp)

**Doel:** een constructieve betonbalk voor plattegronden die je als hartlijn
doortekent (klik-klik-klik, zoals de polylijn), met een instelbare breedte.
De twee randlijnen worden op elke knik in verstek gejoined, en aansluitingen
tussen áparte balken worden automatisch opgeschoond (T- en hoekaansluiting).

## Interactie

1. Gereedschap `betonbalk` activeren vanuit het toolpalette (NL IFC Bouw).
2. Elke klik voegt een hartlijnpunt toe; het segment-in-wording toont een
   live voorbeeld met randen op de huidige breedte. Snap-engine doet mee
   (eindpunten, haaks, polair) zoals bij de bestaande tekengereedschappen.
3. Enter of dubbelklik sluit de balk af; Escape annuleert het laatste punt,
   nogmaals Escape annuleert de balk.
4. Grippunten op de hartlijnpunten; verslepen van een punt hertekent de
   verstekken. Verplaatsen van de hele balk zoals elk object.

## Datamodel

Eigen annotatietype `betonbalk` (precedent: stavenreeks — eigen type, geen
sjabloon, want sjablonen kennen geen klik-voor-klik-invoer):

| Veld | Betekenis | Default |
|---|---|---|
| `points` | hartlijnpunten (app-ruimte) | — |
| `breedteMm` | balkbreedte in mm, schaalgebied-bewust | 300 |
| `lijnstijl` | `'doorgetrokken'` \| `'gestippeld'` | doorgetrokken |
| `strokeColor`, `lineWidth`, `opacity` | zoals elders | |

`realSizeMm`-gedrag: bij plaatsing in een schaalgebied wordt `breedteMm`
omgerekend naar papierpunten via de plaatselijke schaal; buiten een
schaalgebied geldt een vaste omrekening (1:100) zoals bij de staalprofielen.
De hartlijn zelf volgt de klikpunten (die zijn al in papierruimte).

## Geometrie (kern, testbaar in Node)

Nieuw module `js/annotations/betonbalk.js` — één bron voor canvas én PDF-AP:

- `beamOutline(points, halfWidthPt)` → de twee randpolylijnen, met
  **verstek-join** per knik: randsegmenten van aangrenzende segmenten
  worden gesneden; bij bijna-parallelle of zeer scherpe hoeken (miter-limiet
  ~4× halve breedte) terugvallen op afgeschuinde (bevel) join zodat geen
  extreme uitschieters ontstaan.
- `trimAgainstBeams(outline, andereBalken)` → **inter-balk-join**: eindigt of
  begint een hartlijn op (het lijf of een uiteinde van) een andere betonbalk
  op dezelfde pagina (tolerantie: halve breedte van de dunste balk), dan:
  - worden de eigen randlijnen doorgetrokken/afgekort tot de randlijn van de
    doelbalk (T-aansluiting), en
  - wordt op het aansluitvlak géén eindkap getekend, zodat de balken visueel
    één geheel vormen.
  De doelbalk zelf blijft ongewijzigd in data; het opschonen is puur
  render-tijd (en AP-tijd), zodat verplaatsen/verwijderen altijd
  omkeerbaar blijft en er geen verborgen mutaties in andere annotaties
  ontstaan.
- Eindkappen: haaks dichtgezet op vrije uiteinden.

## Weergave

- Twee randlijnen (kleur/lijndikte uit het object), hartlijn optioneel als
  dunne streep-punt-lijn (stijl `'gestippeld'`: randen onderbroken — balk
  boven het aanzichtvlak, NL-conventie; hartlijn dan doorgetrokken dun).
- Geen vulling/arcering in v1.
- Selectie: bestaande selectiehandvatten; hit-test op het balklijf
  (polygon-contains op de outline).

## Persistentie

Opslaan als `/Polygon`-annotatie met `/Vertices` = outline (zodat externe
programma's iets redelijks tonen en het object verplaatsbaar is), eigen
appearance-stream met de exacte lijnvoering (incl. verstek en inter-balk-trim
op het moment van opslaan), en privésleutels `OPS_Subtype: 'betonbalk'`,
`OPS_Hartlijn` (punten), `OPS_BreedteMm`, `OPS_Lijnstijl` zodat de app hem
bij heropenen weer als bewerkbare betonbalk laadt. Canonieke conventie:
Matrix identiteit, BBox = Rect-maat, geen top-level rotatie.

## Verificatie

1. Node-unittest `scripts/test-betonbalk.mjs`: verstek op 90°- en 45°-knik
   (exacte snijpunten), miter-limiet → bevel bij scherpe hoek, T-aansluiting
   (rand eindigt op doelrand, geen eindkap), vrije einden wel kap,
   round-trip hartlijn → outline → zelfde bij herberekening.
2. Rig: balk met 3 knikken tekenen, breedte wijzigen in het paneel,
   lijnstijl wisselen, tweede balk T-vormig laten aansluiten — screenshots.
3. Opslaan naar kopie → heropenen: nog steeds bewerkbaar; pypdfium2-render
   van de kopie toont dezelfde lijnvoering.
4. Rooktest `a-drawing` groen; `npm run build` groen.
