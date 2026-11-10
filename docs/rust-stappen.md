# Stappen naar Rust

Per stap: wat er naar Rust ging, hoe de uitkomst gelijk blijft aan de
JavaScript-weg, wat het oplevert (inclusief IPC) en welke standaard gekozen is.
De JavaScript-implementatie blijft steeds bestaan als terugval (webversie,
Android, oudere worker, fouten).

## Vergelijken: pixelwerk in de PDFium-worker

**Wat:** het pixelwerk van Vergelijken (`open-pdf-studio/js/compare/`):
beide revisies rasteren op de vergelijkingsresolutie (0,2 mm per pixel),
achtergrond schatten, inktmaskers, automatische uitlijning (grove zoektocht
met fasecorrelatie, patch-verfijning, betrouwbaarheid), verschil per pixel
met tolerantie, clusters (runs + union-find), samenvoegen en filteren.

**Waar:** in het PDFium-workerproces (`pdfium-worker/src/compare/`), nieuwe
aanvraag `compare`. De worker rendert zelf beide pagina's in tegels en houdt
de maskers in een eigen cache (128 MB per worker, leeg bij Trim). Over IPC
gaan alleen een JSON-kop (uitlijning, statistieken) en de clusters als f64's
via het gedeelde geheugen: 80 bytes per cluster, bijvoorbeeld 560 bytes voor
een A0-paar, tegen 2 × 100 MB RGBA als de bitmaps over IPC zouden gaan.
De app roept hem aan met het Tauri-commando `compare_pixel_pair`
(`tauri::ipc::Response`, rauwe bytes) vanuit `js/compare/rust-compare.js`.

**Profiel van de JS-weg** (gegenereerde tekeningparen met bekende
verplaatste, toegevoegde en verwijderde elementen, `scripts/bench-rust/09-compare-pixels.mjs`;
node 24, pdf.js met @napi-rs/canvas, i9-14900HX; mediaan, ms):

| paar | masker | voorbeeld | renderen | inkt | uitlijnen | detectie | totaal |
|---|---|---:|---:|---:|---:|---:|---:|
| A3 | 2100×1485 | 50 | 78 | 27 | – | 14 | 168 |
| A3 + plotverschuiving | 2100×1485 | 79 | 109 | 39 | 641 | 43 | 905 |
| A0 | 5945×4205 | 276 | 1207 | 630 | – | 87 | 2160 |
| A0 + plotverschuiving | 5945×4205 | 218 | 1062 | 576 | 627 | 209 | 2681 |

De tijd zit in het renderen plus `getImageData` en de inktomzetting (in de app
op de hoofdthread, met een pauze per tegel) en, met automatische uitlijning,
in de uitlijning (in een Web Worker). De detectie zelf is klein.

**Rust, dezelfde paren** (stadia volgens de worker zelf, ms):

| paar | voorbeeld | renderen | inkt | uitlijnen | detectie | totaal |
|---|---:|---:|---:|---:|---:|---:|
| A3 | 14 | 40 | 3 | – | 4 | 63 |
| A3 + plotverschuiving | 22 | 50 | 3 | 155 | 23 | 253 |
| A0 | 67 | 221 | 33 | – | 31 | 351 |
| A0 + plotverschuiving | 55 | 214 | 32 | 169 | 122 | 598 |

**Eind tot eind** (JS met verse maskers tegen de worker inclusief stdin/stdout,
SHM lezen en decoderen in JS; de extra Tauri-stap draagt dezelfde paar honderd
bytes en is niet meegeteld):

| paar | JS | Rust | versnelling | Rust, maskers in cache |
|---|---:|---:|---:|---:|
| A3 | 168 | 64 | 2,6× | 5 |
| A3 + plotverschuiving | 905 | 255 | 3,6× | 156 |
| A0 | 2160 | 354 | 6,1× | 27 |
| A0 + plotverschuiving | 2681 | 603 | 4,4× | 283 |

Daarnaast verdwijnt al het pixelwerk van de hoofdthread (in de app is dat het
grootste deel van de JS-tijd: renderen + inkt). De JS-rendertijden zijn onder
node gemeten; in de WebView zijn ze vergelijkbaar of trager.

In de Rust-poort zijn twee dingen sneller gemaakt zonder de uitkomst te
veranderen: de kolom-FFT werkt op een aaneengesloten kopie (dezelfde
rekenstappen, minder cache-missers) en onafhankelijke stappen (kandidaten van
de grove zoektocht, patches van de verfijning, rijbanden van de inktomzetting)
draaien op een paar threads, met de keuze daarna in de oorspronkelijke
volgorde.

**Pariteit, deel 1: de algoritmen zijn bitgelijk.** `cargo test -p pdfium-worker`
voert de Rust-poort uit op dezelfde invoer als de JS-modules
(`pdfium-worker/tests/fixtures/compare/`, gemaakt door
`scripts/bench-rust/compare-golden.mjs`: pdf.js-maskers van de A3-paren,
synthetische paren met schaal, kwartslag en meetschaal, een RGBA-tegel met
getinte achtergrond en transparante pixels) en eist dezelfde uitvoer, ook voor
de kommagetallen bit voor bit (f64-bitpatronen in de fixture): 13
detectiegevallen (drie gevoeligheden, identiteit, afgekapt), 5 uitlijningen,
4 inktmaskers en de achtergrondschatting. Daarvoor rekent de poort zoals V8:
`Math.hypot` en `Math.round` nagebouwd, cos/sin/atan2/exp/log uit de
`libm`-crate (fdlibm-afstamming, MIT/Apache).

**Pariteit, deel 2: PDFium tegen pdf.js.** De worker rendert met PDFium, de
JS-weg met pdf.js; de randen van lijnen en tekst worden anders
geanti-aliast. Gemeten op de gegenereerde paren (zelfde drempels, `--check`
van het benchmarkscript):

| paar | clusters JS / Rust | gekoppeld (gesplitst) | max. randafwijking | max. verschil pixelCount | alle bewerkingen gevonden | uitlijningsverschil |
|---|---|---|---|---:|---|---|
| A3 | 11 / 11 | 11 (0) | 1 px (0,2 mm) | 19 % | ja / ja | – |
| A3 + verschuiving | 12 / 11 | 11 (0) | 1 px (0,2 mm) | 23 % | ja / ja | ≤ 0,001 mm, 0,0012° |
| A0 | 6 / 7 | 6 (1) | 1 px (0,2 mm) | 21 % | ja / ja | – |
| A0 + verschuiving | 6 / 7 | 6 (1) | 1 px (0,2 mm) | 21 % | ja / ja | 0,002 mm, 0,0010° |

De tolerantie (en waarom):
- gekoppelde clusters hebben dezelfde soort en overlappen (IoU ≥ 0,5); hun
  randen mogen 1 mm verschillen (gemeten: 1 pixel = 0,2 mm). Een
  anti-aliasrand is hoogstens een pixel breed;
- een wijziging mag aan één kant één cluster zijn en aan de andere twee, waar
  een lijn van de andere revisie hem kruist: of het gat bij de kruising groter
  is dan de samenvoegafstand hangt af van de anti-aliasrand van die lijn. De
  stukken worden als groep gekoppeld (gezien op het A0-paar: één verwijderde
  wand);
- wat niet te koppelen is mag alleen een spikkel onder 4× de minimale
  oppervlakte zijn (gezien: één spikkel in A3 + verschuiving, alleen in JS);
- pixelCount (gewijzigde pixels) verschilt tot ruim 20 %: bij lijnen van 1 à 2
  pixels breed telt de anti-aliasrand zwaar mee. Het is daarom geen
  koppelvoorwaarde; oppervlakten in het rapport (`areaMm2`) kunnen in die
  orde verschillen tussen desktop en webversie;
- uitlijning: verschil kleiner dan 0,1 mm en 0,02°.
Niet-ingebedde standaardfonts tekent pdf.js met de fonts die de app meegeeft
(Liberation), PDFium met zijn eigen; het benchmarkscript geeft pdf.js daarom
dezelfde fonts als de app, anders verschilt tekst meer dan anti-aliasing.

**Standaard:** desktop gebruikt de worker (duidelijk sneller, en geen
pixelwerk meer op de hoofdthread). JS blijft de terugval: in de webversie en
op Android (geen Tauri), voor een kant die alleen in het geheugen bestaat (de
versie van vóór het laatste opslaan), als de bestandslengte op schijf afwijkt
van wat de app heeft, als geen worker `compare` kent (een oudere sidecar
noemt het niet in `caps` van zijn Ready-regel en krijgt de aanvraag dus
nooit), en bij elke fout (één waarschuwing in de console, dan JS).
`OPDS_RUST_COMPARE=0` in de omgeving van de app dwingt JS af.

**Nog live te controleren:** Vergelijken in de app op echte tekeningen
(overlay en naast elkaar, automatische uitlijning, schaalcorrectie, rapport
over alle pagina's), het terugvallen met een oude sidecar en met
`OPDS_RUST_COMPARE=0`, en pagina's met annotaties of formuliervelden (PDFium
tekent annotatieweergaven zoals pdf.js met intent 'display', formulierdata
niet).
