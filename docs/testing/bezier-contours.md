# Gemengde rechte en Bézier-contouren (#1169)

## Status: geometrische basis, nog geen bedienbare functie

`js/annotations/bezier-contour.js` bevat gedeelde, zuivere geometrie voor de
uitbreiding. De module is nog niet aangesloten op annotaties, de selectie-UI
of PDF-opslag. Deze concept-PR sluit #1169 daarom **niet**. Bestaande polylijnen
en polygonen gedragen zich ongewijzigd; er wordt geen release gepubliceerd.

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

1. Polygonen met impliciete regelmatige hoekpunten materialiseren;
   renderen en hit-testing van polylijnen/polygonen op deze geometrie zetten.
2. Knopen/handvatten tonen en slepen; segmenten recht/krom maken; handvatten
   meenemen in alle bestaande verplaats-, schaal-, spiegel-, rotatie-,
   kopieer- en groeppaden. Undo/redo, locks en leesmodus respecteren.
3. Exacte kubische PDF-appearance, standaard terugvalvertices en gevalideerde
   private metadata toevoegen. Ruwe sleutels/vingerafdrukken, CropBox,
   paginarotatie, incrementeel opslaan en laden moeten dezelfde curve bewaren.
4. Browser- en PDF-rondgangtests toevoegen: gemengde contour tekenen,
   handvat bewerken, undo/redo, transformeren, opslaan/heropenen en opnieuw
   bewerken. Installerworkflow en geïnstalleerde Tauri-app kwalificeren.

De bestaande `filledArea`/meetcontouren en Catmull-Rom-splines zijn apart;
hun semantiek mag niet onbedoeld door dit contract worden vervangen.

Belangrijke aansluitpunten zijn `annotations/rendering.js`,
`rendering/shapes.js`, `annotations/geometry.js`, `annotations/handles.js`,
`tools/tools/select-tool.js`, `annotations/transforms.js`,
`annotations/veelhoek-punten.js` en `annotations/size-matching.js`.
`copyPointKeepArc` bewaart momenteel alleen boogvelden: nieuwe handvatten
mogen daar niet verdwijnen. Voor opslag zijn `pdf/saver.js`,
`pdf/saver/appearance-vectors.js`, `pdf/saver/bron-vingerafdruk.js`,
`pdf/saver/ruwe-sleutels.js`, `pdf/loader/color-extraction.js` en
`pdf/loader/annotation-converter.js` relevant. De polygon-route schaalt
punten naar het annotatievak en verwerkt rotatie apart; rechtstreeks
wereldpunten inzetten zonder deze conversies aan te passen is onjuist.
