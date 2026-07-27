# Betonbalk — tweepunts balkobject in plattegrond (ontwerp, herzien)

**Doel:** een constructieve betonbalk voor plattegronden. Eén balk = één
LIJNSTUK (zoals lijn en wand), met een instelbare doorsnede (b×h in mm).
Hoek- en T-aansluitingen tussen losse balken worden automatisch opgeschoond.

> Herziening t.o.v. het eerste ontwerp: geen polyline-hartlijn meer maar
> losse lijnstukken (gebruikerswens), volledige maatvoering/ortho zoals de
> lijn/wand, profielkeuzelijst, optionele tag en optionele hartlijn.

## Interactie

1. Gereedschap `betonbalk` activeren vanuit het toolpalette (NL IFC Bouw).
2. Klik-klik zoals de lijn/wand (gedeelde line-tool): eerste klik = start,
   tweede klik = eind. De tool blijft actief en KETENT: het eindpunt wordt
   meteen het startpunt van de volgende balk (doortekenen). Rechtsklik/Escape
   beëindigt de reeks.
3. Volledige maatvoering van de line-tool: type-length-invoer (lengte,
   `dx,dy`, `lengte<hoek`, `=x,y`; Enter commit via `state._typeLengthCommit`)
   en Shift = hoek-snap (prefs `enableAngleSnap`/`angleSnapDegrees`).
   Object-snap/polair doen mee zoals bij elk tekengereedschap.
4. Eindpunt-grips (LINE_START/LINE_END) + midden-grip; verplaatsen zoals elk
   object. Trim-, extend- en split-gereedschap werken op de balk zoals op een
   lijn; split levert TWEE betonbalken op (type blijft behouden).

## Datamodel

Eigen annotatietype `betonbalk` (lijnstuk-vorm, zoals `wall`):

| Veld | Betekenis | Default |
|---|---|---|
| `startX/startY/endX/endY` | hartlijn-lijnstuk (app-ruimte) | — |
| `breedteMm` | balkbreedte in mm (plan-breedte, schaalgebied-bewust) | 300 |
| `hoogteMm` | balkhoogte in mm (administratief; paneel + tag) | 400 |
| `lijnstijl` | `'doorgetrokken'` \| `'gestippeld'` | doorgetrokken |
| `toonHartlijn` | hartlijn tekenen | false |
| `tagTonen` | tag tekenen | false |
| `tagTekst` | tagtekst (leeg = profielnaam "b×h") | '' |
| `tagOffsetX/Y` | vrije tag-verplaatsing (paginaruimte, via grippunt) | 0 |
| `strokeColor`, `lineWidth`, `opacity` | zoals elders | |

Profielkeuze: keuzelijst met gangbare doorsneden (200x300, 250x350, 300x400,
350x400, 350x500, 400x400, 400x500, 400x600, 500x500, 500x600) plus
"Aangepast…" (vrije breedte + hoogte). De laatst gekozen doorsnede geldt als
voorinstelling voor de volgende geplaatste balk (betonbalkStore, zoals
pendingParams bij parametrische symbolen).

`realSizeMm`-gedrag: `breedteMm` wordt via de plaatselijke schaal
(schaalgebied → schaalbalk/doc-schaal) omgerekend naar papierpunten; buiten
elke kalibratie geldt een vaste 1:100-omrekening.

## Geometrie (kern, testbaar in Node)

Module `js/annotations/betonbalk.js` — één bron voor canvas én PDF-AP:

- `beamOutline(points, halfWidthPt)` → de twee randlijnen; op knikken (alleen
  van belang voor hulpberekeningen/legacy) verstek-join met miter-limiet
  (~4× halve breedte) → bevel.
- `trimAgainstBeams(edges, center, halfWidth, andereBalken)` → inter-balk-join
  per uiteinde:
  - **Hoek** (uiteinde op uiteinde, tolerantie 1,5 pt): beide randen worden in
    VERSTEK gesneden met de overeenkomstige rand van de aansluitende balk
    (randparing zoals de wand-joins); geen eindkap.
  - **T** (uiteinde op het lijf, tolerantie: halve breedte van de dunste
    balk): de eigen randen én de teken-hartlijn worden doorgetrokken/afgekort
    tot de NABIJE rand van de doelbalk (de eerste rand die de eigen lijn in
    uitgaande richting kruist — expliciet NIET de rand die het dichtst bij
    het uiteinde ligt, anders schiet een voorbij de doel-hartlijn geklikt
    uiteinde door naar de verre rand); geen eindkap op het aansluitvlak.
  De doelbalk blijft ongewijzigd in data; het opschonen is puur render-/AP-
  tijd, dus altijd omkeerbaar en zonder verborgen mutaties.
- Eindkappen: haaks dichtgezet op vrije uiteinden.
- **Open T-aansluiting** (`edgeCutouts`): de rand van de DOORGAANDE balk
  wordt onderbroken over precies de breedte waar een aansluitende balk hem
  raakt — het interval is de projectie van het aansluitvlak op de rand
  (snijpunten van de twee randlijnen van de aansluitende balk met de eigen
  randlijn; correct bij schuine aansluitingen). Puur render-/AP-tijd, per
  balk uit de siblings berekend; niets wordt gemuteerd. Hoek-aansluitingen
  snijden géén rand weg (die lopen via het wederzijdse verstek).
- Tag: standaard gecentreerd langs de balk, boven de hartlijn, meegeroteerd
  met de balkrichting en nooit ondersteboven (flip bij > 90°); daarna een
  VRIJE paginaruimte-offset (`tagOffsetX/Y`) — versleepbaar via een eigen
  grippunt op de tag (`betonbalk_tag`-handle; verslepen raakt de
  balkgeometrie niet). De offset is bewust paginaruimte (niet balk-lokaal):
  robuust bij draaien/verslepen en identiek in canvas en AP.

## Weergave

- Twee randlijnen (kleur/lijndikte uit het object). Hartlijn optioneel
  (`toonHartlijn`): dun; streep-punt bij 'doorgetrokken', doorgetrokken dun
  bij 'gestippeld' (balk boven het aanzichtvlak — randen dan onderbroken).
  Bij een T-join stopt de hartlijn op de nabije doelrand.
- Geen vulling/arcering in v1.
- Selectie: eindpunt-grips zoals lijn/wand; hit-test op het balklijf
  (hartlijn ± halve breedte).

## Persistentie

Opslaan als `/Polygon` met `/Vertices` = balkomtrek (extern redelijk zichtbaar
en als één object verplaatsbaar), eigen appearance-stream met de exacte
lijnvoering (verstek/T-trims van het opslagmoment, optionele hartlijn en tag)
en privésleutels: `OPS_Subtype: 'betonbalk'`, `OPS_BbGeom` (lijnstuk),
`OPS_BreedteMm`, `OPS_HoogteMm`, `OPS_Lijnstijl`, `OPS_BbHartlijnTonen`,
`OPS_BbTagTonen`, `OPS_BbTagTekst`, `OPS_BbTagDx`/`OPS_BbTagDy`,
`OPS_BbLineWidth`, `OPS_BbRect`
(verplaatsings-compensatie). Canoniek: Matrix (translatie-)identiteit,
BBox = Rect-maat, geen top-level rotatie.

**Legacy:** de eerste release schreef `OPS_Hartlijn` (polyline, mogelijk > 2
punten). De loader leest die vorm nog en splitst meerpunts-exemplaren in
losse tweepunts-balken.

## Verificatie

1. Node-unittest `scripts/test-betonbalk.mjs`: verstek 90°/45° (exact),
   miter-limiet → bevel, L-hoekverstek tussen losse balken (exacte
   verstekpunten, ook bij ongelijke breedtes), T-aansluiting met exacte
   eindcoördinaten op de nabije doelrand + regressietest tegen
   verre-rand-doorschieten, hartlijn-trim en -schakelaar, eindkappen, tag,
   round-trip-determinisme.
2. Rig: twee losse balken haaks (L-verstek), derde balk als T, profiel
   wijzigen via de keuzelijst, tag aan, hartlijn uit/aan, trim-tool op een
   balk — screenshots (ingezoomd op de aansluitingen).
3. Opslaan naar kopie → heropenen: nog steeds bewerkbaar; pypdfium2-render
   toont dezelfde lijnvoering.
4. Rooktest `a-drawing` groen; `npm run build` groen.
