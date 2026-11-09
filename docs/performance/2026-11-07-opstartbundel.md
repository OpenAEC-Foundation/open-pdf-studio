# Opstartbundel: de entry-chunk kleiner (7-11-2026, #454)

Meting met `open-pdf-studio/scripts/meet-bundel.mjs` (bouwt via de Vite-API
en leest per chunk de modules uit de rollup-uitvoer). KiB = 1024 bytes; Vite
zelf meldt kB van 1000. De entry-chunk is alles wat bij het opstarten laadt:
hij importeert geen andere chunks statisch, de rest komt via `import()`.

## Voor en na

| Bouw | Entry-chunk vóór | Entry-chunk na | Verschil |
| --- | --- | --- | --- |
| Desktop (`npx vite build`) | 5393,0 KiB (gzip 1737,7) | 4531,6 KiB (gzip 1485,8) | −861 KiB (−16,0 %), gzip −252 KiB (−14,5 %) |
| Gehost (`--mode hosted`) | 5410,3 KiB (gzip 1743,4) | 4548,8 KiB (gzip 1491,7) | −862 KiB (−15,9 %), gzip −252 KiB (−14,4 %) |

Modules in de entry-chunk (desktop): 1316 → 1160. Het totaal aan JS blijft
gelijk (18 191 → 18 212 KiB, 446 → 540 chunks): de code is niet weg, hij laadt
pas bij het eerste gebruik.

## Wat er in de entry-chunk zat (vóór)

Grootste modules (gerenderde lengte vóór minificatie, als verhouding):

| Module | Grootte |
| --- | ---: |
| pdfjs-dist (legacy build) | 1038 KiB |
| js/pdf/saver.js | 209 KiB |
| js/mcp-bridge.js | 192 KiB |
| js/annotations/rendering.js | 156 KiB |
| js/symbols/data/vbi-vloeren.js | 146 KiB |
| js/pdf/renderer.js | 125 KiB |
| js/solid/stores/propertiesStore.js | 99 KiB |
| js/tools/text-edit-tool.js | 97 KiB |
| js/pdf/loader/color-extraction.js | 92 KiB |
| js/pdf/loader/annotation-converter.js | 87 KiB |
| PrintDialog.jsx | 85 KiB |
| CadImportDialog.jsx | 81 KiB |
| CompareView.jsx | 76 KiB |
| preferences/AnnotationsTab.jsx | 65 KiB |

Per map: `js/solid` 2807, `js/pdf` 2317, `js/annotations` 1364,
pdfjs-dist 1038, `js/tools` 918, pdf-lib 723 KiB. De dialogen in
`components/dialogs` en `components/preferences` samen: ruim 900 KiB.

## Wat er verschoof

- **Dialogen** (`DialogHost.jsx`): alle dialogen die pas op verzoek openen
  laden via `lazy()` bij het eerste openen. Statisch blijven melding,
  bevestiging, wachtwoord (kan bij het openen van een PDF verschijnen),
  herstel (bij het opstarten) en wat altijd gemonteerd is (de overlays en de
  afdruktoast). Mee verhuisd: afdrukken, CAD-import en -export, IFCX-export,
  watermerk, stempels, voorkeuren, nieuw document, schaalcontrole, enzovoort,
  met hun eigen modules (afdruklogica, cad-import, extensiecatalogus).
- **MCP-brug** (`js/mcp-bridge.js`, 192 KiB): laadt in `init()` als eigen chunk,
  alleen in Tauri. De console-ringbuffer die de tool `app_get_recent_console`
  uitleest, staat nu in `js/core/console-ring.js` en wordt op dezelfde plek in
  `main.js` geladen als de brug vroeger, zodat hij vanaf de start meeschrijft.
- **Vergelijkingsweergave**: `CompareViewLazy.jsx` monteert `CompareView.jsx`
  bij de eerste vergelijking en laat hem daarna staan, zodat het gedrag na het
  stoppen (caches opruimen, eigen toetsen) gelijk blijft.
- **Bestand-menu**: de panelen Openen, Importeren en Exporteren laden als het
  menu voor het eerst opengaat.

Geen van de verhuisde modules registreert iets bij het laden (opdrachten,
sneltoetsen, lintknoppen, luisteraars): gecontroleerd op opdrachten op het
hoogste niveau van elk verhuisd bestand.

## Wat bewust bleef

- **pdf.js, lader, renderer, saver en pdf-lib**: nodig om een PDF te openen
  en op te slaan.
- **Linttabbladen**: een sneltoets voor een lintknop zet het tabblad heel even
  neer en klikt synchroon (`zetLintUitvoerder` in `Ribbon.jsx`); een lui
  tabblad heeft dan nog geen knop.
- **Contextmenu**: registreert bij het monteren zijn Escape- en
  klik-buiten-luisteraars; later monteren verandert hun volgorde ten opzichte
  van de andere toetsafhandeling.
- **Mobiele weergave** (`MobileApp.jsx`): `main.js` rekent erop dat de DOM er
  direct na `render()` staat.
- **Symboolregister en vloerdata** (`vbi-vloeren.js`, de templates): de
  renderer heeft de templates synchroon nodig om bestaande symbolen te tekenen.

## Volgende kandidaten

- `vbi-vloeren.js` (146 KiB data): de vloertemplates pas opbouwen bij het
  eerste gebruik, met een synchrone terugval voor het tekenen.
- pdf-lib (+ pako, standaardfonts, ruim 1 MB vóór minificatie) wordt door 95
  modules statisch geïmporteerd; alleen het opslaan en een deel van het laden
  heeft het echt nodig.
- Het contextmenu met een vroeg geregistreerde luisteraar en een luie inhoud.

## Bewaking

`scripts/bundel-grootte.test.mjs` (in `scripts/unit-testlijst.txt`) leest
`dist/` en faalt boven 4700 KiB (gzip 1550 KiB) voor de entry-chunk (na de
tweede stap: 4120 KiB, gzip 1340 KiB; zie hieronder). Zonder
bouwuitvoer, of met een `dist/` die ouder is dan de bronnen in `js/`, slaat de
test zichzelf over.

## Tweede stap (9-11-2026)

Zelfde meting (`node scripts/meet-bundel.mjs`, en `--mode hosted`). Het
vertrekpunt is `main` van 9-11: de entry-chunk was sinds de eerste stap met
nieuwe functies weer iets gegroeid (4532 → 4563 KiB).

| Bouw | Entry-chunk vóór | Entry-chunk na | Verschil |
| --- | --- | --- | --- |
| Desktop (`npx vite build`) | 4563,3 KiB (gzip 1496,7) | 4020,0 KiB (gzip 1299,5) | −543 KiB (−11,9 %), gzip −197 KiB (−13,2 %) |
| Gehost (`--mode hosted`) | 4580,5 KiB (gzip 1503,0) | 4037,3 KiB (gzip 1304,7) | −543 KiB (−11,9 %), gzip −198 KiB (−13,2 %) |

Modules in de entry-chunk (desktop): 1173 → 1049. Het totaal aan JS blijft
gelijk (18 603 → 18 620 KiB, 541 → 556 chunks).

### Wat er verschoof (geminificeerde chunk, gzip)

| Chunk | Grootte | Laadt |
| --- | ---: | --- |
| NEN 1414-bibliotheek (`nen1414Library.js`, met de kleine symboolbeelden als data-URL) | 223,9 KiB (137,8) | direct na het tekenen van het venster (`initSymbolPalette`) |
| Vloergeometrie (`symbols/data/vbi-vloeren.js`) | 142,2 KiB (16,2) | bij het eerste tekenen van een vloerdoorsnede, of vóór opslaan/exporteren |
| Inhoud van het contextmenu (`ContextMenu.jsx`) | 39,1 KiB (10,3) | in een rustig moment na de start, of bij het eerste openen |
| Linttabbladen behalve Start (Tekenen, Opmaak, Beeld, Schikken, Annotatie, Organiseren, Afbeelding, Help) | samen 106,1 KiB (27,8) | in een rustig moment na de start, of bij het eerste gebruik |
| Mobiele weergave (`MobileApp.jsx` met touch- en recente-bestandenmodules) | 32,7 KiB (9,6) | alleen als `isMobile()` waar is, vóór `render()` |

- **Linttabbladen** (`Ribbon.jsx`, `ribbon/lint-tab-laden.js`): Start blijft
  statisch, de andere tabbladen zijn `lazy()`. Na de start (1,5 s, dan
  `requestIdleCallback`) laden ze na elkaar. Een sneltoets voor een knop op
  een tabblad (`zetLintUitvoerder`) blijft synchroon zolang dat tabblad
  geladen is; is het dat nog niet (vlak na de start), dan laadt hij eerst de
  chunk en zet daarna het tabblad even neer en klikt, zoals voorheen.
  `voerSneltoetsUit` wachtte al op de uitvoerder. De MCP-brug laadt het
  tabblad vóór het aanklikken (`_laadTab`). Wie vóór het laden een tabblad
  aanklikt, ziet de inhoud een moment later.
- **Mobiele weergave**: `App.jsx` tekent alleen nog het bureaublad;
  `main.js` laadt bij `isMobile()` eerst `MobileApp.jsx` en roept dan
  dezelfde synchrone `render()` aan, dus de DOM staat er nog steeds direct
  na `render()`. Het bureaublad wacht nergens op.
- **Vloerdoorsneden** (`templates/vloer-dxf.js`): bij de start staat alleen
  de index klaar (`data/vbi-vloeren-index.js`, families, labels en maten,
  4 KB), genoeg voor het palet, de eigenschappen en de ware maat. De
  geometrie laadt bij het eerste `render()`; tot dan tekent het symbool de
  omtrek van de doorsnede, en na het laden volgt een hertekening. Opslaan
  (de raster-appearance in `saver.js`) en de uitvoer via `exporter.js`
  (afdrukken, afbeeldingen, rasterpdf) wachten eerst op
  `laadTemplateDataVoor()`. `scripts/dxf-vloeren-convert.mjs` schrijft de
  index mee; een test bewaakt dat index en geometrie overeenkomen.
- **NEN 1414-bibliotheek** (`data/nen1414-laden.js`): de symbolen houden
  precies dezelfde svg-tekst (met de data-URL's). Die tekst is de sleutel van
  bewerkte symbooltypen in de voorkeuren en staat in geplaatste stempels;
  daarom is de lading verplaatst en zijn de beelden niet als losse bestanden
  uitgegeven. Tot de lading klaar is, ontbreken de NEN-groepen in het palet,
  en tekent een systeemraster met een NEN-symbool zijn plaatshouder; de
  cache onthoudt zo'n symbool dan niet als ontbrekend en hertekent na het
  laden.
- **Contextmenu**: de host (`ContextMenuHost.jsx`) blijft bij de start
  gemonteerd en registreert zijn luisteraars op hetzelfde moment als
  voorheen, zodat de volgorde ten opzichte van de andere toetsafhandeling
  gelijk blijft. Alleen de menu's zelf zijn lui; na het laden plaatst de host
  het menu opnieuw, want de maat verandert.

### Wat bewust bleef

- **De beelden van NEN 1414 als losse bestanden** (`assetsInlineLimit`): zou
  de svg-tekst van 68 symbolen veranderen (een URL met hash en oorsprong in
  plaats van de data-URL) en daarmee bewerkte symbooltypen en eigen groepen
  in de voorkeuren losmaken.
- **`text-edit-tool.js`** (97 KiB): `tool-context.js` geeft
  `findTextEditAtPosition`/`startTextEditEditing` synchroon aan de
  gereedschappen en de module houdt de toestand van de open bewerking.
  Splitsen kan, maar vraagt eerst een kleine, statische zoekfunctie los van de
  editor.
- **pdf.js, lader, renderer, saver, pdf-lib**: ongewijzigd (zie boven).

### Wat een live controle nodig heeft

- Een sneltoets voor een knop op een ander tabblad direct na de start (vóór
  het voorladen) en daarna; het lint ingeklapt en uitgeklapt.
- Een tabblad aanklikken binnen de eerste seconde na de start.
- Een document met vloerdoorsneden openen: eerst de omtrek, kort daarna de
  doorsnede; opslaan direct na het openen geeft de volledige appearance.
- Het symbolenpalet bij de start (NEN-groepen verschijnen na het laden) en
  een systeemraster met een NEN-symbool in een net geopend document.
- Het contextmenu direct na de start openen: plaatsing binnen het venster.
- De mobiele weergave (`?mobile` of Android).

### Bewaking

Budget in `scripts/bundel-grootte.test.mjs` verlaagd naar 4120 KiB (gzip
1340 KiB), net boven de gehoste bouw.

