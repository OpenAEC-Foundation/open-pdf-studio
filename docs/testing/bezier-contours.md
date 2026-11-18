# Gemengde rechte en Bézier-contouren (#1169)

## Status: tekenen, raken en transformaties aangesloten; bediening/opslag nog open

`js/annotations/bezier-contour.js` wordt nu gebruikt door de echte renderer,
raaktest en polygoongeometrie. Expliciete `incoming`/`outgoing`-handvatten
activeren de kubische route. Gewone punten zonder handvatten houden hun
bestaande tekenroute. De app biedt nog geen actie om deze handvatten aan te
maken: **deze concept-PR sluit #1169 niet** en mag niet als volledige functie
worden uitgebracht. PDF-opslag zou de handvatten op dit moment verliezen.

Polylijnen en polygonen tekenen de exacte kubische curve. Raken gebruikt een
adaptieve benadering; selectie en viewport-culling omvatten de boog. Het
selectiepad van een polylijn volgt de curve. Polygonen schalen handvatten mee
naar hun vak en draaien/spiegelen ze daarna mee. De terugrekening na een
knoopsleep gebruikt het midden van de echte curve-omhullende, zodat de overige
knopen en handvatten op hun schermpositie blijven staan.

Bestaande verplaats-, RO-draai-, schaal-, maatgelijk-, spiegel- en stretchroutes
nemen handvatten mee. De groepsdraaiing van een polygoon vertaalt zijn opgeslagen
punten en handvatten samen met het vak, waarna de rotatie precies één keer
wordt toegepast. Nog niet alle overige bewerkingen zijn gekwalificeerd.

## Gegevenscontract

Een knoop heeft `x` en `y` in paginacoördinaten en optioneel `incoming` en
`outgoing`, beide eveneens absolute punten. Het uitgaande handvat van de
beginknoop en het inkomende handvat van de eindknoop bepalen één kubische
Bézier. Een ontbrekend handvat valt samen met zijn knoop. Ontbreken beide,
dan blijft het segment recht. Een gesloten contour heeft ook het segment
van de laatste naar de eerste knoop; een open contour heeft dat niet.

De bestaande `arc`/`bulge`-boog op de eindknoop wordt exact van een
kwadratische naar een kubische Bézier omgerekend. Expliciete handvatten
hebben voorrang. Bij een affiene transformatie worden oude bogen eerst
omgezet: een enkele bulge kan een niet-uniform geschaalde boog niet bewaren.

De functies wijzigen hun brondata niet. Splitsen gebruikt de Casteljau en
behoudt de oorspronkelijke curve. Verplaatsen neemt de handvatten van die
knoop mee. Recht maken verwijdert alleen de twee handvatten van het
gekozen segment. Verplaatsen, roteren, spiegelen en niet-uniform schalen
gebruiken dezelfde affiene matrix voor knopen en handvatten.

Grenzen worden berekend met de extrema van de kubische curve, niet alleen
met knopen of het omhullende handvattenvak. Picking en terugvalvertices
kunnen adaptief worden afgevlakt met een tolerantie in paginapunten. Bij
bereiken van de begrensde subdivisiediepte meldt `truncated` dat die
tolerantie niet bewezen is. De exacte tekenroute gebruikt kubische
padopdrachten; de aanroeper bepaalt lijn, vulling en het begin van het pad.

## Regressietests

```sh
cd open-pdf-studio
node --test js/annotations/bezier-contour.test.mjs
```

De tests vergelijken de Casteljau met een onafhankelijke Bernstein-formule,
controleren de bekende booghoogte 75 bij handvatten op 100, en toetsen
splitsen op meerdere parameters, inclusief het sluitsegment. Ze controleren
spiegelen, niet-uniform schalen, legacy-bogen, aangrenzende handvatten,
immutabiliteit (ook met reactieve proxies), lege/ongeldige data, lussen, collineaire overshoot en de
subdivisielimiet. Voor 80 deterministische curves worden exacte grenzen
vergeleken met dichte onafhankelijke monsters. Afvlakken wordt tegen de
gevraagde afstandstolerantie getoetst. De tests staan in de volledige suite.

## Nog te integreren vóór beoordeling als volledige functie

1. Segmentacties recht/krom, afzonderlijke controlehandvatten met hulplijnen,
   slepen, shape-preserving invoegen/verwijderen, undo/redo en alle locks/read-only
   routes. Impliciete regelmatige polygonen materialiseren bij de eerste bewerking.
2. Contextmenu `veelhoekDeelBij` en toevoegen werken nog met rechte zijden;
   snappen, offset, fillet/chamfer, plakken/groepsbewerkingen verder auditen.
   Huidige testen kwalificeren geen willekeurige combinatie van alle gereedschappen.
3. Exacte kubische PDF-appearance, standaard terugvalvertices en gevalideerde
   private metadata. De saver/lader zijn nog niet aangepast: **niet opslaan als
   bewijs van een bruikbare feature**. Ruwe sleutels/vingerafdrukken, CropBox,
   paginarotatie en incrementeel opslaan moeten dezelfde curve bewaren.
4. Browser- en PDF-rondgangtests voor de volledige bediening toevoegen:
   tekenen, controlehandvat bewerken, undo/redo, transformeren, opslaan/heropenen
   en opnieuw bewerken. Installerworkflow en geïnstalleerde Tauri-app kwalificeren.

## Integratiecontrole

`js/annotations/bezier-integration.test.mjs` oefent de echte annotatiehelpers,
raaktest, selectiegrenzen, spatial index, padopbouw, knoopsleep en transformaties.
De negen scenario's vergelijken absolute knopen en handvatten en bevatten
rotatie, reflectie, niet-uniforme schaal, snapshots en vergrendeling.
Dezelfde tests falen op de voorafgaande basiscommit zonder deze integratie.

`node scripts/test-bezier-render-browser.mjs` start de app in Chromium en
controleert echte canvaspixels voor een boog, het rechte vervolgsegment en
vulling. Ook de echte raaktest en het selectiepad worden aangeroepen. De
geometrie wordt als fixture geïnjecteerd: dit is nadrukkelijk **geen test van
nog ontbrekende handvatbediening of PDF-opslag**. De test draait ook in Linux CI.

De bestaande `filledArea`/meetcontouren en Catmull-Rom-splines zijn apart;
hun semantiek mag niet onbedoeld door dit contract worden vervangen.

Belangrijke resterende aansluitpunten zijn `annotations/handles.js`,
`tools/tools/select-tool.js`, contextmenuacties en `annotations/veelhoek-punten.js`.
Voor opslag zijn `pdf/saver.js`, `pdf/saver/appearance-vectors.js`,
`pdf/saver/bron-vingerafdruk.js`, `pdf/saver/ruwe-sleutels.js`,
`pdf/loader/color-extraction.js` en `pdf/loader/annotation-converter.js` relevant.
De polygon-route verwerkt eerst het vormvak en daarna rotatie/flip;
`veelhoekPuntenOpScherm` levert nu ook de correcte handvatten.
