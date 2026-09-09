# AI-takeoff: gevels, kozijnen en dakvlakken

Ontwerp, 9 september 2026.

## Aanleiding

Op een vergunningsset staan de aanzichten al netjes getekend, maar wie er
hoeveelheden uit wil halen, moet alles met de hand overtrekken: per aanzicht
een schaalgebied, per gevel een meet-vlak, elk kozijn eruit knippen, het dak
apart, en dan nog een staat inrichten. Voor een set van zeven bladen is dat een
half uur precisiewerk dat bovendien makkelijk misgaat.

De app heeft alle onderdelen al: schaalgebieden, meet-vlakken met gaten,
dakhoek-correctie, staten die je op de tekening kunt plaatsen, en een
assistent-skillset die een AI via de MCP-tools op het document laat werken. Wat
ontbreekt is de schakel die dat aaneenrijgt — en een MCP-weg naar de staat.

Doel: één assistent-skill die op een aanzichtenblad de schaalgebieden plaatst,
netto gevelvlakken met de kozijnen als gaten aanmaakt, de kozijnen en
dakvlakken apart meet, en daar een staat van op de tekening zet. Bruikbaar met
elke AI-provider, niet alleen met de ingebouwde koppeling.

## Uitgangspunten

- **Provider-onafhankelijk.** De skill mag niets veronderstellen over welk
  model erachter hangt. Alles wat tussen twee modellen kan verschillen —
  eenheden, naamgeving, nummering, rekenwerk — hoort in app-code.
- **De gebruiker bevestigt de schaal.** Een verkeerd gelezen schaal maakt élke
  hoeveelheid fout zonder dat je het aan de staat ziet. Daarom een expliciete
  tussenstap.
- **Netto gevel, kozijnen apart.** De gevel is één meet-vlak met de openingen
  als gaten; elk kozijn krijgt daarnaast zijn eigen vlak.
- **Alles-of-niets.** Mislukt de validatie, dan wordt er niets geplaatst.

## Architectuur

Drie lagen, elk apart te begrijpen en te testen.

### 1. Perceptie — de AI

De skill-prompt laat het model per blad `app_fit_page` en `app_screenshot_view`
doen en één JSON-document teruggeven. Het model meet niet en rekent niet om: het
levert schermpixel-coördinaten plus de schaal-tekst die het letterlijk gelezen
heeft.

```json
{ "page": 4,
  "screenshot": { "width": 1500, "height": 971 },
  "views": [
    { "id": "v1", "titel": "FRONT ELEVATION", "schaalTekst": "1/4\" = 1'-0\"",
      "kader": { "x": 96, "y": 210, "w": 430, "h": 300 } }
  ],
  "vlakken": [
    { "view": "v1", "soort": "gevel", "orientatie": "voor",
      "punten": [{ "x": 120, "y": 250 }] },
    { "view": "v1", "soort": "kozijn",
      "punten": [{ "x": 150, "y": 300 }] },
    { "view": "v1", "soort": "dak", "hellingTekst": "8:12",
      "punten": [{ "x": 118, "y": 240 }] }
  ] }
```

`soort` is `gevel`, `kozijn` of `dak`. `orientatie` alleen bij een gevel.
`hellingTekst` alleen bij een dakvlak.

### 2. Contract en validatie — `js/quantities/ai-takeoff.js` (puur)

Valideert de JSON, rekent schermpixels om naar paginapunten via de
viewport-gegevens, en zet de schaal-tekst om naar een verhouding plus eenheid.
Levert óf een lijst fouten, óf een genormaliseerd plan.

Gecontroleerd wordt wat een model fout kan doen zonder dat het opvalt:

- elke opening ligt binnen de omhullende van de gevel waar hij bij hoort;
- elk vlak heeft minstens 3 punten en een oppervlak groter dan nul;
- elke `view`-verwijzing bestaat;
- elk vlak ligt binnen het kader van zijn aanzicht;
- de oriëntatie komt uit een vaste lijst;
- de helling is plausibel (0–75°);
- aanzichtkaders overlappen elkaar niet.

#### De schaal-omzetting

`parseScaleString` in `js/annotations/scale-region.js` begrijpt alleen `1:N`.
Zijn regex matcht ook op een breuk: geef je `1/4" = 1'-0"` rechtstreeks door,
dan leest de app **1:4** in plaats van 1:48 — een factor 12 fout die nergens
zichtbaar is behalve in de uitkomst. Rauwe schaal-tekst mag daarom nooit
ongezien als `scaleString` doorgegeven worden.

De omzetting hier:

| Gelezen tekst | Verhouding | `units` |
|---|---|---|
| `1/4" = 1'-0"` | 1:48 | `ft` |
| `3/16" = 1'-0"` | 1:64 | `ft` |
| `1" = 20'` | 1:240 | `ft` |
| `1:100`, `1:50` | ongewijzigd | `mm` |

Algemene regel: verhouding = werkelijke lengte gedeeld door papierlengte, beide
in duim. Bij `1/4" = 1'-0"` is dat 12 / 0,25 = 48; bij `1" = 20'` is het
240 / 1 = 240. Alles wat niet eenduidig herkend wordt, is een validatiefout —
geen gok.

### 3. Toepassing

Zet het plan om in annotaties via de bestaande fabrieken:

- een `scaleRegion` per aanzicht, met de omgerekende `scaleString` en `units`;
- een `measureArea` per gevel, met de kozijnen van die gevel als `holes`;
- een `measureArea` per kozijn;
- een `measureArea` per dakvlak, met `dakhoek` uit de hellingtekst;
- een staat via `addScheduleFromTemplate` + `updateScheduleConfig`, geplaatst
  met het bestaande `placeScheduleAt`.

## Verloop: twee fasen

Eén nieuwe MCP-tool, `app_apply_takeoff`.

**Fase 1 — `phase: "scale"`.** Valideert het hele plan, plaatst alleen de
schaalgebieden en bewaart het plan in app-state onder een `planId`. Geeft per
aanzicht terug: titel, gelezen schaal-tekst, de daaruit volgende verhouding, en
een controlegetal — de breedte van de grootste gevel in dat aanzicht, in de
gevonden eenheid. Op zo'n breedte valt een factor-12-fout meteen op.

**Fase 2 — `phase: "areas"`, met `planId`.** Pas na akkoord van de gebruiker:
de vlakken, de kozijnen, het dak en de staat.

Het plan tussen de fasen in app-state houden betekent dat het model het niet
opnieuw hoeft te sturen en er ook niets stilletjes in kan veranderen tussen wat
de gebruiker goedkeurde en wat er geplaatst wordt.

Beide fasen draaien in één undo-transactie: één Ctrl+Z verwijdert de hele
takeoff.

## Naamgeving en nummering

In app-code, niet door het model — anders levert elk model andere namen op.

- Gevels: `Gevel <oriëntatie>`, oriëntatie uit `voor`, `achter`, `links`,
  `rechts`, `noord`, `oost`, `zuid`, `west`. Iets anders is een fout.
- Kozijnen: per gevel `K1`…`Kn` in leesvolgorde — links naar rechts, bij
  gelijke x van boven naar beneden.
- Dakvlakken: `D1`…`Dn`, zelfde volgorde.

De naam komt in `measureName`, dat sinds deze week ook in de Label-kolom van een
staat terechtkomt.

## De staat

Elk vlak krijgt naast `measureName` ook een `ifcCategory`: `IfcWall` voor een
gevel, `IfcWindow` voor een kozijn, `IfcRoof` voor een dakvlak. Dat
is een bestaand annotatieveld én een bestaande staat-kolom, dus er hoeft niets
nieuws bij om op te kunnen groeperen.

Configuratie: categorie `area`, kolommen `label`, `area`, `realArea`, `dakhoek`,
`count`, gegroepeerd op `ifcCategory` met subtotalen en eindtotaal. Onderaan lees
je dan per groep de netto geveloppervlakte, het totaal aan kozijnen en het
werkelijke dakoppervlak.

Bij een Amerikaanse set komt de staat in ft² te staan: de kolomeenheid volgt de
tekening.

## Randgevallen

- **Gambreldak.** Twee hellingen per dakzijde, dus twee dakvlakken met elk hun
  eigen `dakhoek`. Het contract staat meerdere dakvlakken per aanzicht toe; er
  is geen aanname dat een dak één vlak is.
- **Meerdere aanzichten op één blad.** Elk aanzicht krijgt zijn eigen
  schaalgebied. Overlappende kaders zijn een fout, want dan is niet te bepalen
  welke schaal voor welk vlak geldt.
- **Geen schaal-tekst gevonden.** Validatiefout voor dat aanzicht; de rest van
  het blad wordt evenmin geplaatst (alles-of-niets).
- **Kozijn zonder gevel.** Fout — een kozijn moet binnen precies één gevel van
  hetzelfde aanzicht liggen.

## Testen

`js/quantities/ai-takeoff.test.mjs`, puur en zonder AI:

- schaal-omzetting: imperiaal, metrisch, en de `1/4"`-val expliciet;
- pixel → paginapunt-conversie bij verschillende screenshot-breedtes;
- opening binnen gevel, vlak binnen aanzichtkader, overlappende kaders;
- nummervolgorde van kozijnen en dakvlakken;
- gaten-aftrek: netto gevel = bruto min de kozijnen;
- weigergevallen: onbekende oriëntatie, onleesbare schaal, ontbrekende view,
  ontaard vlak.

Plus een vastgelegd JSON-fixture van het aanzichtenblad van de schuur-set,
zodat de hele toepassings-stap end-to-end getest wordt zonder dat er een model
aan te pas komt.

Handmatige verificatie via de rig: skill draaien op dat blad, de gemelde
schaalbreedtes vergelijken met de maatvoering op de tekening, en de staat-
totalen narekenen tegen een handmatige meting van één gevel.

## Wat er niet in zit

- Geen herkenning zonder AI uit de paginageometrie. Dat is een eigen project en
  breekt op elke afwijkende tekenstijl.
- Geen plattegrond-takeoff (ruimtes, vloeren). Alleen aanzichten.
- Geen onderscheid tussen raam en deur. Het contract kent één soort `kozijn`
  en elk kozijn wordt `IfcWindow`. Voor de hoeveelheden — netto gevelvlak en
  totaal aan openingen — maakt dat niets uit; wie het onderscheid wil, kan het
  achteraf per vlak zetten.
