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
`dist/` en faalt boven 4700 KiB (gzip 1550 KiB) voor de entry-chunk. Zonder
bouwuitvoer, of met een `dist/` die ouder is dan de bronnen in `js/`, slaat de
test zichzelf over.
