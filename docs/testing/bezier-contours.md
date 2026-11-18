# Gemengde rechte en Bézier-contouren (#1169)

## Status: tekenen, transformaties, PDF-opslag en segmentbediening aangesloten

`js/annotations/bezier-contour.js` wordt nu gebruikt door de echte renderer,
raaktest en polygoongeometrie. Expliciete `incoming`/`outgoing`-handvatten
activeren de kubische route. Gewone punten zonder handvatten houden hun
bestaande tekenroute. Rechtsklik op een segment van één geselecteerde polylijn of polygoon biedt
**Segment krom maken** en **Segment recht maken**. Krom maken plaatst twee
controlehandvatten op de rechte lijn; sleep de ronde grepen afzonderlijk om de
kromming te bepalen. Hulplijnen verbinden ze met hun knopen. Deze concept-PR
blijft open tot de volledige kwalificatie is afgerond. PDF-opslag bewaart nu de exacte curve en de bewerkbare handvatten.

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

## Nog te kwalificeren vóór oplevering

1. Geïnstalleerde Tauri-app en installerworkflow kwalificeren; fork Actions
   zijn momenteel uitgeschakeld. CI-bouwresultaten vervangen deze stap niet.
2. Native rooktest van tekenen, grepen, undo/redo, transformeren en
   opslaan/heropenen. Chromium dekt enkelpagina- en doorlopende weergave,
   inclusief een gedraaide/gespiegelde regelmatige polygoon. Dit vervangt
   geen test in de geïnstalleerde Tauri-webview.

## Segmentbediening

Een rechtsklik op een zijde biedt krom/recht en invoegen. Invoegen splitst de
kubische curve exact met de Casteljau. Een knoop verwijderen verbindt zijn
buren met een rechte lijn en behoudt de controlehandvatten van hun overige
segmenten; het minimum is twee knopen voor een polylijn, drie voor een polygoon.
Een regelmatige polygoon krijgt expliciete knopen bij de eerste bewerking.
Controlehandvatten bewegen in paginaruimte, ook bij spiegeling/draaiing.

Midden-snaps liggen op de curve (parameter 0,5); rand-, snijpunt- en loodrechte
snaps gebruiken een adaptieve benadering met maximaal 0,1 paginapunt afwijking.
Offset weigert een contour met kubische handvatten, zoals de bestaande weigering
voor boogsegmenten. Fillet/chamfer accepteren alleen losse lijnobjecten.
Klembordverplaatsing gebruikt de eerder geteste `applyMoveRigid`-route.

`node scripts/test-bezier-edit-browser.mjs` controleert echte contextmenu's en
muisbewegingen in enkelpagina- en doorlopende weergave, beide onafhankelijke
handvatten, regelmatige/gedraaide/gespiegelde polygonen, undo/redo, invoegen,
opslaan/heropenen/opnieuw bewerken, recht maken en locked/read-only acties.

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
nog ontbrekende handvatbediening**. Hij slaat de fixtures ook op, heropent ze via de echte lader en toetst de pixels van de PDF-appearances met PDF.js. De test draait ook in Linux CI.

De bestaande `filledArea`/meetcontouren en Catmull-Rom-splines zijn apart;
hun semantiek mag niet onbedoeld door dit contract worden vervangen.

Belangrijke resterende aansluitpunten zijn `annotations/handles.js`,
`tools/tools/select-tool.js`, contextmenuacties en `annotations/veelhoek-punten.js`.
Voor opslag zijn `pdf/saver.js`, `pdf/saver/appearance-vectors.js`,
`pdf/saver/bron-vingerafdruk.js`, `pdf/saver/ruwe-sleutels.js`,
`pdf/loader/color-extraction.js` en `pdf/loader/annotation-converter.js` relevant.
De polygon-route verwerkt eerst het vormvak en daarna rotatie/flip;
`veelhoekPuntenOpScherm` levert nu ook de correcte handvatten.

## PDF-opslag en teruglezen

`pdf/bezier-pdf.js` schrijft exacte kubische padoperatoren in de appearance,
een adaptieve benadering met tolerantie 0,1 PDF-punt in standaard `/Vertices`,
en versie 1 van `/OPS_BezierContour` met absolute PDF-knopen/grepen. De standaard
vertices blijven bruikbaar in editors zonder kennis van onze metadata. Een
bewerkte curve krijgt een nieuw appearance; alleen een greep veranderen telt
mee voor de bronvingerafdruk. De omhullende gebruikt echte extrema en ruimte
voor verstekken. Arcering wordt op het kubische contour geknipt.

Metadata wordt begrensd op 2 MB, 4096 knopen en 131072 vertexcoördinaten.
Niet-eindige/onbruikbare coördinaten, onbekende versies, foutieve geslotenheid,
of standaardvertices die intussen extern veranderd zijn, vallen terug op de
standaardgeometrie. Afvlakken heeft een vaste diepte en uitvoerlimiet; overschrijden
breekt opslag af in plaats van een te grove benadering stilzwijgend te bewaren.

`js/pdf/bezier-rondgang.test.mjs` test twee rondgangen met CropBox en 0/90/180/270°,
open en gesloten contouren, knoop/handvatidentiteit, een wijziging van alleen
een handvat, spiegeling en arcering, ongeldige metadata en incrementele opslag
met behoud van oorspronkelijke bytes en onbekende bronvelden. De acht initiële
rondganggevallen faalden vóór deze opslagintegratie. De echte browsertest toetst
ook de opgeslagen curve, het rechte vervolg en de vulling als PDF-pixels.

De browserroute voor meegegeven sjabloonbytes gebruikt bij het uitlezen van
metadata nu dezelfde `__memory__<doc.id>`-sleutel als de saver. De desktoproute
blijft zijn bestandspad gebruiken.
