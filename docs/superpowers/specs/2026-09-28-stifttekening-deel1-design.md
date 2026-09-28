# Stifttekening, deel 1: stiften en legenda

Ontwerp, 28 september 2026. Goedgekeurd in de ontwerpfase; dit document legt
het vast voor het implementatieplan. Verwant: #312 (structural drawing tools).

## Aanleiding

Een constructeur zet op de plattegronden van de architect met gekleurde
"stiften" de draagconstructie uit: bestaande en nieuwe wanden, liggers,
balklagen met hun overspanningsrichting, kolommen, fundering en sparingen. Bij
3BM heet dat blad het constructieoverzicht (CP-21). Het voorbeeld
`3052-CP-21 Constructieoverzicht.pdf` laat zien hoe het eruitziet: drie
plattegronden op een A2, dikke gestreepte lijnen in de wanden, doorgetrokken
lijnen voor liggers, dubbele pijlen met een letter voor balklagen, rode kruisen
over sparingen, en per verdieping een legenda.

Twee dingen maken zo'n blad meer dan losse lijnen:

- **De betekenis zit in de legenda.** Rood is op de ene verdieping een
  HSB-wand en op het dak een balklaag. Kleur en lijnsoort samen, vastgelegd in
  de legenda, bepalen wat een lijn is.
- **Een stift is een element.** Een HSB-wand is een wand, een HEA120 een
  ligger. Dat bepaalt de IFC-categorie en wat de hoeveelhedenmodule telt.

Nu tekent de constructeur dit in een ander programma en slaat het plat, of met
losse lijnen en tekstvakken die niets van elkaar weten. Wijzigt een omschrijving,
dan moeten de lijnen en de legenda met de hand mee.

## Indeling in drie delen

1. **Stiften en legenda** (dit document): de kern.
2. **Blad en ondergrond:** het CP-21-sjabloon onder Nieuw document, een
   plattegrond uit een PDF lichtgrijs maken, de schaal van de architect laten
   meereizen, snappen op de lijnen van de ondergrond.
3. **Assistent:** stelt stiften voor op de tekening van de architect.

Deel 1 is zelfstandig bruikbaar: op een blad dat je al hebt, teken je stiften
en plaats je legenda's.

## Beslispunten in het kort

| Onderwerp | Besluit |
|---|---|
| Wat is een stift | Een getekend element dat verwijst naar een **stiftdefinitie**: soort, omschrijving, kleur, lijnsoort, dikte |
| Waar staan de definities | In het document zelf, in de PDF-catalogus; elke stift draagt een kopie van zijn definitie mee |
| Doorwerken | Definitie wijzigen verandert alle stiften en legenda's in het document |
| Startset | De lijst uit dit document; "Maak standaard" bewaart een eigen set voor volgende projecten |
| Tekenwijzen | Vier: lijn, pijl met letter, punt, kruis |
| Legenda | Eigen annotatie per plattegrond, met optioneel kader; de regels worden bij elke weergave opnieuw bepaald |
| Opslaan | Vectorweergave (appearance stream) per stift en legenda: andere PDF-programma's tonen hetzelfde |
| IFC | Vast per soort; IfcColumn, IfcFooting en IfcOpeningElement komen erbij |
| Hoeveelheden | Lengte per definitie voor lijnen, aantallen voor pijlen, punten en kruisen |

## Begrippen

- **Soort:** wat een stift constructief is, zoals "Nieuwe wand" of "Ligger
  staal". Een vaste lijst in de app (zie de tabel hieronder). De soort bepaalt
  de tekenwijze en de IFC-categorie.
- **Stiftdefinitie:** een benoemde uitvoering van een soort in één document,
  zoals "HSB-wand 38x184, hoh 610, C24" (soort Nieuwe wand, rood gestreept,
  1,4 mm). Van één soort kunnen meerdere definities bestaan: "Raveelbalk
  96x221, C24" en "Gording 2x 71x245" zijn allebei Ligger hout.
- **Stift:** één getekend element op een pagina, met een verwijzing naar zijn
  definitie en eigen geometrie.
- **Legenda:** een blok op de pagina dat de gebruikte definities toont, met
  een kop.

## Soorten en standaardset

Elke soort valt in één van vier tekenwijzen. De standaardwaarden zijn afgeleid
uit 3052-CP-21: wanden en liggers zijn daar 4,03 pt (1,4 mm) dik, de
gestreepte wanden hebben het streeppatroon `[8,1 4,0]` pt, de vloerpijlen zijn
1,0 pt en de sparingkruisen 2,0 pt.

| Soort | Tekenwijze | Standaard | IFC |
|---|---|---|---|
| Bestaande wand | lijn | zwart `#000000`, gestreept, 1,4 mm | IfcWall |
| Nieuwe wand | lijn | rood `#FF0000`, gestreept, 1,4 mm | IfcWall |
| Stabiliteitswand | lijn | oranje `#FF8C00`, gestreept, 1,4 mm | IfcWall |
| Ligger staal | lijn | blauw `#7D9EBF`, doorgetrokken, 1,4 mm | IfcBeam |
| Ligger hout | lijn | geel `#FFFF00`, doorgetrokken, 1,4 mm | IfcBeam |
| Latei | lijn | groen `#3BB370`, doorgetrokken, 1,4 mm | IfcBeam |
| Balklaag of vloer | pijl met letter | rood `#FF0000`, 0,35 mm, letter A | IfcSlab |
| Kolom | punt | blauw `#0000FF`, vierkant, 4 mm | IfcColumn |
| Funderingsbalk of strook | lijn | blauw `#0000FF`, doorgetrokken, 1,0 mm | IfcFooting |
| Paal | punt | zwart `#000000`, cirkel, 4 mm | IfcPile |
| Sparing | kruis | rood `#FF0000`, 0,7 mm | IfcOpeningElement |

De standaardset bevat één definitie per soort, met de soortnaam als
omschrijving. De volgorde van deze tabel is ook de volgorde in het paneel en in
de legenda.

## Datamodel

### Stiftdefinitie

```js
{
  id: 'sd-…',            // stabiel, willekeurig; verwijzingen gaan op id, nooit op naam
  soort: 'nieuweWand',   // een van de elf soorten
  omschrijving: 'HSB-wand 38x184, hoh 610, C24',
  kleur: '#FF0000',
  lijnsoort: 'gestreept', // 'doorgetrokken' | 'gestreept'; alleen tekenwijze lijn
  dikteMm: 1.4,          // lijndikte op papier
  letter: 'A',           // alleen soort Balklaag of vloer; 1 of 2 tekens
  puntvorm: 'vierkant',  // alleen tekenwijze punt: 'vierkant' | 'i-profiel' | 'cirkel'
  maatMm: 4,             // alleen tekenwijze punt: grootte van het symbool op papier
}
```

- Een nieuwe definitie van soort Balklaag of vloer krijgt de eerste letter die
  in het document nog niet gebruikt is: A, B, C, enzovoort.
- De soort ligt vast na het aanmaken; de tekenwijze en de IFC-categorie volgen
  uit de soort en worden niet opgeslagen. `ifcVoorSoort(soort)` en
  `tekenwijzeVoorSoort(soort)` staan in de pure module.
- De lijst per document heeft een versienummer, met een migratieketen zoals bij
  de systeemtypen (`js/annotations/systeem-typen.js`).
- Validatie bij inlezen: onbekende soort, ongeldige kleur of een dikte van nul
  of minder maakt de definitie ongeldig. Een ongeldige definitie wordt niet
  weggegooid maar met standaardwaarden voor haar soort aangevuld; een onbekende
  soort valt terug op "Nieuwe wand".

### Stift (annotatie)

Een nieuwe annotatiesoort `stift`, met naast de gebruikelijke velden (`id`,
`page`, `author`, datums, laag):

| Tekenwijze | Geometrie |
|---|---|
| lijn | `points: [{x, y}, …]`, minstens twee punten |
| pijl | `startX, startY, endX, endY` |
| punt | `x, y`, en `rotation` (0 of 90) voor een I-profiel |
| kruis | `x, y, width, height`: de rechthoek van de sparing |

Plus `stiftDefId`. De annotatie draagt geen eigen kleur of dikte: die komen bij
het tekenen uit de definitie. Coördinaten staan in weergaveruimte, zoals bij
alle andere annotaties; een paginarotatie draait de geometrie mee
(`rotateAnnotation`).

### Legenda (annotatie)

Een nieuwe annotatiesoort `stiftLegenda`:

| Veld | Betekenis |
|---|---|
| `x, y` | linkerbovenhoek van het blok |
| `kop` | koptekst, bijvoorbeeld "CONSTRUCTIE 1E VERDIEPING"; wordt in hoofdletters getoond |
| `kader` | `{x, y, width, height}` of `null`: het gebied waarvan de legenda de stiften telt |
| `kolommen` | 1 of 2 |

Breedte en hoogte van het blok volgen uit de regels en worden niet opgeslagen
als invoer; bij opslaan komt de actuele omhullende in `/Rect`.

## Tekenen

### Het gereedschap

Eén gereedschap **Stift**, dat tekent met de actieve definitie. De tekenwijze
volgt uit de soort:

- **Lijn:** klik per punt. Dubbelklik of Enter rondt af, Escape breekt af,
  Backspace haalt het laatste punt weg. Shift houdt het segment haaks. De
  bestaande snap-engine werkt zoals bij andere lijnen.
- **Pijl:** twee klikken, begin en eind. Shift houdt hem haaks.
- **Punt:** één klik.
- **Kruis:** een rechthoek slepen over de opening.

Na het tekenen blijft het gereedschap actief met dezelfde definitie, zodat je
een reeks wanden achter elkaar zet.

### Hoe een stift eruitziet

Eén pure bouwer, `stiftTekenopdrachten(stift, definitie)`, levert
tekenopdrachten (lijnen, paden, vlakken, tekst) in paginacoördinaten. Het canvas
en de appearance stream in de PDF gebruiken dezelfde opdrachten, zodat scherm en
opgeslagen PDF gelijk zijn.

- **Dikte** in millimeters op papier, omgerekend naar punten
  (`mm × 72 / 25,4`). Een stift van 1,4 mm is op elk zoomniveau 1,4 mm op
  papier, zoals de lijndikte van andere annotaties.
- **Gestreept:** streep 2 × de dikte, gat 1 × de dikte, zoals in 3052. De
  strepen schalen dus mee met de dikte.
- **Witte onderlaag:** onder een gestreepte stift ligt eerst een witte
  doorgetrokken lijn van dezelfde dikte. De gaten tonen dan wit in plaats van
  de grijze wand eronder, zodat de stift leesbaar blijft.
- **Pijl:** een lijn met aan beide uiteinden een gesloten pijlpunt van
  3 mm. De letter staat in een vakje van 10 × 15 pt (3,5 × 5,3 mm) op het
  midden van de pijl, met groene vulling `#45B5A8` en vetgedrukte tekst
  `#350E35` van 12 pt, zoals de A- en B-labels in 3052.
- **Punt:** een gevuld vierkant, een I-profiel (twee flenzen en een lijf, in de
  kleur van de definitie) of een gevulde cirkel, `maatMm` groot.
- **Kruis:** de twee diagonalen van de rechthoek, zonder rand. De opening zelf
  staat al op de tekening van de architect.

## Het paneel Stiften

Een tabblad **Stiften** in het linkerpaneel, naast Lagen en Metingen:

- Alle definities van het document, gegroepeerd per soort in de volgorde van de
  tabel, elk met een voorbeeld en de omschrijving. Onder elke groep staat het
  aantal stiften dat die definitie gebruikt.
- **Klik** op een definitie: het gereedschap Stift wordt actief met die definitie.
- **Nieuw:** kies een soort; er komt een definitie bij met de standaardwaarden
  van die soort, en het bewerkvenster opent.
- **Bewerken** (dubbelklik of knop): een modaal venster met omschrijving,
  kleur, lijnsoort, dikte en de velden van de tekenwijze (letter, puntvorm,
  maat). Het venster is verplaatsbaar, heeft rechte hoeken en sluit niet bij
  een klik ernaast, volgens de huisregels in `CLAUDE.md`.
- **Verwijderen:** kan direct als geen stift de definitie gebruikt. Wordt hij
  gebruikt, dan vraagt de app naar welke definitie van dezelfde soort de
  stiften overgaan; zonder zo'n andere definitie kan verwijderen niet.
- **Maak standaard:** bewaart de definities van dit document als startset
  voor volgende documenten, in de voorkeuren van de app.
- **Standaard herstellen:** zet de startset in de voorkeuren terug naar de
  ingebouwde lijst. Het document zelf verandert daardoor niet.

Een document krijgt definities zodra de eerste stift getekend wordt of het
paneel een definitie toevoegt: dan kopieert de app de startset in het document.
Een document zonder stiften blijft zonder definities en schrijft niets in de PDF.

Wijzigen, toevoegen, verwijderen en overzetten van definities zijn elk één
ongedaan-maakstap. Daarvoor krijgt `undo-manager.js` een opdrachttype voor de
definitielijst (oude en nieuwe lijst, plus bij overzetten de oude en nieuwe
`stiftDefId` per stift).

## De legenda

### Plaatsen

Het gereedschap **Legenda**:

1. Sleep een kader om de plattegrond. Een klik zonder slepen betekent: geen
   kader, de hele pagina telt.
2. Klik waar het legendablok moet komen.

De kop begint als "CONSTRUCTIE" en is in het eigenschappenpaneel aan te passen,
net als het aantal kolommen en het kader (opnieuw slepen). Het kader is alleen
zichtbaar als stippellijn zolang de legenda geselecteerd is; het komt niet in de
PDF-weergave.

### Welke regels

- Een stift telt mee als het midden van zijn omhullende rechthoek binnen het
  kader ligt, op dezelfde pagina. Zonder kader telt elke stift op de pagina.
- Elke gebruikte definitie geeft één regel; een definitie die binnen het kader
  niet voorkomt, staat er niet in.
- Volgorde: de volgorde van de soorten in de tabel, en binnen een soort de
  volgorde van de definities in het paneel.
- De regels worden bij elke weergave opnieuw bepaald. Een nieuwe stift of een
  gewijzigde omschrijving staat dus meteen in de legenda. Dat bepalen is één
  doorgang over de stiften van de pagina, met een cache per documentversie: bij
  duizend stiften mag een hertekening er niet merkbaar trager van worden.

### Opmaak, zoals in 3052-CP-21

- **Kop:** een vak met groene vulling `#45B5A8` en vetgedrukte tekst in
  hoofdletters, `#350E35`, 12 pt.
- **Regel:** links een voorbeeld van de stift (een lijnstuk van 25 mm, een pijl
  met letter, het puntsymbool of een kruis van 8 × 8 mm), rechts een groen vak
  met de omschrijving in `#350E35`, 12 pt. Voor een balklaag staat de letter
  vooraan in de tekst, zoals "A  Balklaag 45x145, C24, hoh 610".
- **Maten:** elk vak is 15 pt hoog (5,3 mm), met 2 mm marge links en rechts van
  de tekst en de tekst verticaal gecentreerd. Tussen de regels zit 2 mm; alle
  tekstvakken van één kolom zijn even breed, zo breed als de langste
  omschrijving.
- **Twee kolommen:** de regels worden verdeeld zodat de eerste kolom er één
  meer heeft bij een oneven aantal.
- **Lettertype:** Helvetica in de weergave. Segoe UI uit het voorbeeld is niet
  overal beschikbaar en mag niet overal ingebed worden; Helvetica is een
  standaardlettertype dat elke PDF-lezer heeft.

## Opslaan en openen

### In de PDF

- **Definities:** `/Root /OPS_StiftDefs` als hexstring met JSON
  `{ versie, definities }`, volgens het patroon van `OPS_StylePresets`
  (`js/pdf/saver/style-presets.js`). Zonder definities wordt de sleutel
  verwijderd.
- **Stift:** een standaard-subtype per tekenwijze, zodat andere lezers er iets
  zinnigs van maken:
  - lijn → `/PolyLine` met `/Vertices`;
  - pijl → `/Line` met `/L` en `/LE [/ClosedArrow /ClosedArrow]`;
  - punt → `/Square` (vierkant, I-profiel) of `/Circle` (cirkel);
  - kruis → `/Square` met de rechthoek.

  Plus de eigen sleutels `OPS_Subtype (stift)`, `OPS_StiftDefId` en
  `OPS_StiftDef` (de definitie als JSON, een momentopname), en een appearance
  stream uit dezelfde bouwer als het canvas. Zo gaat het ook bij de betonbalk
  (`js/annotations/betonbalk.js`, saver en `annotation-converter.js`).
- **Legenda:** `/Stamp` met `OPS_Subtype (stiftLegenda)`, de velden als eigen
  sleutels en een appearance stream met de actuele regels. Een stempel is voor
  elke lezer pure weergave; een `/FreeText` zou een andere lezer kunnen
  hertekenen.

### Bij openen en plakken

- De loader leest `/OPS_StiftDefs` in de definitielijst van het document.
- Een stift waarvan de definitie niet in de lijst staat, brengt haar mee via
  `OPS_StiftDef`: die wordt toegevoegd. Zo komt een PDF die een ander programma
  heeft bewerkt en waarbij de catalogus-sleutel verdwenen is, er toch weer
  helemaal uit.
- **Kopiëren en plakken tussen documenten:** het klembord draagt de definitie
  mee. Kent het doeldocument die `id` nog niet, dan komt de definitie erbij;
  kent het haar wel, dan geldt de definitie van het doeldocument.
- Een stift zonder bruikbare definitie (geen lijst en geen momentopname) wordt
  grijs gestreept getekend met een vraagteken, en behoudt al haar gegevens.

### Andere lezers

Omdat elke stift en legenda een appearance stream heeft, tonen andere
PDF-lezers het blad zoals de app. Controle bij de tests: dezelfde pagina via
PDFium (de eigen renderer) en MuPDF, vergeleken met de weergave in de app.

## IFC en hoeveelheden

- **IFC:** de categorie volgt uit de soort (zie de tabel). IfcColumn, IfcFooting
  en IfcOpeningElement komen erbij in de categorielijst
  (`js/solid/data/ifcCategoryMap.js`) en de IFC-export (`js/pdf/ifc-export.js`),
  voor zover ze daar nog ontbreken.
- **Hoeveelheden:** de hoeveelhedenmodule telt stiften per definitie:
  - lijn: lengte (som van de segmenten), in meters als er een schaal op de
    plek van de stift geldt, anders in punten;
  - pijl, punt en kruis: aantal.

  Het label is de omschrijving van de definitie, de categorie komt uit de soort.
- **Geen trage schaalopvraging per element.** #491 liet zien dat een
  schaalopvraging die per element alle annotaties doorloopt, bij 1000 elementen
  seconden kost. Stiften gebruiken de schaalindex per pagina uit die fix, en
  voegen zelf geen doorgang over alle annotaties per element toe.

## AI-koppeling (MCP)

Stiften zijn te maken met de bestaande opdracht `app_create_annotation`:

```json
{ "type": "stift", "page": 1,
  "props": { "stiftDefId": "sd-…", "points": [{"x": 100, "y": 200}, {"x": 400, "y": 200}] } }
```

In plaats van `stiftDefId` mag `soort` met `omschrijving` staan: bestaat er een
definitie met die soort en omschrijving, dan wordt die gebruikt, anders wordt
ze aangemaakt met de standaardwaarden van de soort. `app_list_annotations`
geeft de `stiftDefId` terug. Dit is nodig voor de tests en later voor de
assistent van deel 3.

## Voorgestelde indeling in bestanden

| Bestand | Rol |
|---|---|
| `js/annotations/stift/definities.js` | puur: soorten, standaardset, validatie, migratie, IFC en tekenwijze per soort |
| `js/annotations/stift/tekenopdrachten.js` | puur: de gedeelde bouwer (streep, onderlaag, pijl, symbolen, kruis) |
| `js/annotations/stift/legenda.js` | puur: welke regels, volgorde, kolomindeling, maten van het blok |
| `js/annotations/rendering/stift-draw.js` | tekent de opdrachten op het canvas |
| `js/pdf/saver/stift-ap.js` | zet de opdrachten om in een appearance stream |
| `js/pdf/saver/stift-meta.js` en een geval in `annotation-converter.js` | opslaan en inlezen van sleutels en definities |
| `js/tools/tools/stift-tool.js`, `js/tools/tools/stift-legenda-tool.js` | de twee gereedschappen |
| `js/solid/components/left-panel/panels/StiftenPanel.jsx` | het paneel |
| `js/solid/components/dialogs/StiftDefinitieDialog.jsx` | het bewerkvenster |

Het implementatieplan kan deze indeling verfijnen. Het uitgangspunt blijft: de
rekenregels in pure modules die onder `node --test` te testen zijn.

## Randgevallen

- **Paginarotatie:** stiften en het kader van een legenda draaien mee. De
  inhoud van de legenda blijft rechtop in de weergave.
- **Vergrendelde annotaties en lagen:** stiften gedragen zich als andere
  annotaties; een verborgen markeringslaag verbergt ook haar stiften en telt
  niet mee in een legenda.
- **Definitie wijzigen terwijl een stift geselecteerd is:** het
  eigenschappenpaneel toont de definitie van de geselecteerde stift, met een knop
  om een andere definitie van dezelfde soort te kiezen.
- **Letter dubbel:** twee vloerdefinities mogen dezelfde letter hebben; het
  bewerkvenster waarschuwt, maar houdt je niet tegen.
- **Heel veel stiften:** bij 1000 stiften op een pagina blijven tekenen,
  wijzigen van één stift en hertekenen elk onder 100 ms. Dat komt in de tests.

## Testen

- **Unit-tests** (`node --test`, in `test:unit`):
  - definities: standaardset, validatie, migratie, IFC en tekenwijze per soort;
  - bouwer: streeppatroon 2:1 van de dikte, witte onderlaag, pijlpunten,
    lettervak, symbolen, kruis;
  - legenda: lidmaatschap via het midden van de omhullende, volgorde, twee
    kolommen, geen kader betekent de hele pagina;
  - opslaan: sleutels, momentopname, en het terugvallen op de momentopname bij
    openen.
- **Opslagrondgang:** stiften en een legenda tekenen, opslaan, heropenen: alles
  gelijk, en de pagina via PDFium en MuPDF vergeleken met de weergave in de app.
- **Verplichte poortprotocollen:** de rotatiesweep en de opslagrondgang, omdat
  de saver en de rotatie geraakt worden.
- **In de app:** een testinstantie met de MCP-server; stiften tekenen via
  `app_create_annotation` en met de muis, schermafdrukken bekijken.
- **Prestaties:** 1000 stiften op een pagina, gemeten zoals bij #500: openen,
  één stift wijzigen, een definitie wijzigen en hertekenen.

## Niet in deel 1

- Het CP-21-sjabloon onder Nieuw document, een plattegrond lichtgrijs maken, de
  schaal van de architect laten meereizen, snappen op de ondergrond: deel 2.
- De assistent die stiften voorstelt: deel 3.
- Losse velden voor materiaal, maat, hart-op-hart en sterkteklasse: de
  omschrijving blijft vrije tekst. Dat blijft later mogelijk.
