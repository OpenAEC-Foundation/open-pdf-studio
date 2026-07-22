# Wapeningskorf — parametrische balkdoorsnede (ontwerp)

**Doel:** één parametrisch object dat een complete rechthoekige balk- of
kolomdoorsnede met wapening tekent: betonomtrek, beugel, staven boven/onder/
zijkant, aanhaallijnen met labels, maatlijnen en een naam ("Korf A"). Alle
afmetingen en staafaantallen instelbaar.

## Waarom een sjabloon, geen nieuw annotatietype

Het bestaande sjabloon-systeem (`js/symbols/templates/*.js`, geregistreerd in
`js/symbols/registry.js`) levert gratis: parameters in het eigenschappen-paneel,
persistentie via het parametricSymbol-pad, schaalgebied-bewuste plaatsing via
`realSizeMm`, snap-punten en palet-integratie. De stavenreeks is een eigen type
omdat je die *sleept*; de korf is een *blok* dat je plaatst — precies waar dit
systeem voor is.

**Prior art:** `templates/beugel.js` en `templates/wapening-verdeling.js`
bestaan al maar zijn geparkeerd ("below par, to be reworked"). De korf vervangt
ze functioneel; beoordeel bij oplevering of ze uit het register kunnen.

## Parameters

| Sleutel | Betekenis | Default |
|---|---|---|
| `breedte` | balkbreedte (mm) | 400 |
| `hoogte` | balkhoogte (mm) | 400 |
| `dekking` | betondekking tot beugel (mm) | 30 |
| `bovenAantal` / `bovenDiameter` | staven bovenin | 4 / 12 |
| `onderAantal` / `onderDiameter` | staven onderin | 6 / 16 |
| `zijAantal` / `zijDiameter` | staven op halve hoogte (verdeeld over links/rechts) | 2 / 10 |
| `beugelDiameter` / `beugelAfstand` | beugel ⌀ en h.o.h. (mm) | 8 / 150 |
| `naam` | onderschrift | "Korf A" |
| `toonMaatlijnen` | maatlijnen breedte/hoogte | true |
| `toonLabels` | aanhaallijnen + labels | true |

## Tekening (render)

1. **Betonomtrek**: rechthoek `breedte × hoogte`.
2. **Beugel**: rechthoek ingesprongen met `dekking`, getekend als dubbele lijn
   met de haak rechtsboven — neem de beugel-detaillering over uit
   `templates/beugel.js` (die is al goed).
3. **Staven** (gevulde punten, straal = werkelijke ⌀/2 op de plaatselijke
   schaal, zie hieronder):
   - boven: `bovenAantal` gelijkmatig over de binnen-bovenrand;
   - onder: `onderAantal` gelijkmatig over de binnen-onderrand;
   - zijkant: `zijAantal` verdeeld over links/rechts op halve hoogte
     (bij 2 → één links, één rechts).
4. **Aanhaallijnen + labels**: schuine aanhaallijnen vanaf elke staafgroep naar
   labels rechts, in de vorm `N ⌀ D`; plus een los label
   `bgls ⌀ {beugelDiameter} - {beugelAfstand}`.
5. **Maatlijnen**: breedte boven, hoogte links, met de ronde eindmarkering uit
   de referentie.
6. **Onderschrift**: `naam`, gecentreerd onder de doorsnede.

## Hergebruik — HARDE EIS

Het diameterteken MOET uit `js/annotations/stavenreeks.js` komen
(`diameterSignSegments` / `labelLayout`). Eén bron voor het wapeningsteken in de
hele app, anders lopen stavenreeks en korf uit elkaar. De korf tekent het teken
via dezelfde segmenten, geschaald naar zijn eigen tekstgrootte.

## Schaalgebied

`realSizeMm(params)` → `{ width: breedte, height: hoogte }`, zodat het object bij
plaatsing de werkelijke maat krijgt volgens het schaalgebied — net als de
staalprofielen. De staafdikte volgt automatisch mee omdat de punten in
mm-ruimte worden gerekend en met de rest meeschalen.

## Verificatie

1. Sjabloon-unittest (`scripts/test-wapeningskorf.mjs`): staafposities
   gelijkmatig binnen de dekking, aantallen kloppen, labels vormen `N ⌀ D`,
   `realSizeMm` volgt de parameters, en wijzigen van breedte/hoogte/aantallen
   verplaatst de staven consistent.
2. Rig: plaatsen vanuit het toolpalette, dan in het paneel breedte, hoogte en
   aantallen wijzigen — screenshot per stap, zelf beoordelen tegen de
   referentie (de twee voorbeelden: 350×400 met 3/2/3 en 400×400 met 4/2/6).
3. Opslaan naar kopie → pypdfium2 + PyMuPDF: object zichtbaar en identiek aan
   canvas.
4. Knoppen-rooktest `a-drawing` groen; `npm run build` groen.
