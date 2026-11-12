# Stukken JavaScript naar Rust

Stapsgewijs rekenwerk uit de JavaScript-laag naar Rust verplaatsen binnen de
bestaande Tauri-app. Per stap: dezelfde uitvoer als de JS-route (met een
pariteitstest), de JS-route blijft als terugval (webversie, Android, ontbrekend
of falend commando), en een meting JS tegen Rust inclusief IPC. Is Rust niet
duidelijk sneller of lichter, dan blijft JS de standaard.

## Monochroom-hercompressie per beeld (#902)

**Wat is verplaatst.** Het rekenwerk van `optimizeMonochromeImage()`
(`open-pdf-studio/js/pdf/monochrome-image.js`) en de CCITT G4-encoder
(`js/pdf/ccitt-g4.js`): Flate uitpakken, acht-bit grijs/RGB tot één bit pakken
(alleen zuiver zwart/wit), Flate en CCITT G4 coderen, en de kleinste complete
stream kiezen. Dat staat nu in de crate `open-pdf-monochrome` (pure logica,
`cargo test -p open-pdf-monochrome` draait gewoon). Het Tauri-commando
`monochroom_beeld` (`src-tauri/src/monochroom.rs`) krijgt de ruwe streambytes
als rauwe body en de afgeleide getallen als JSON-kop `x-opds-monochroom`, en
geeft een `ipc::Response` terug (soort, beide kandidaatlengtes, gekozen bytes).

Blijft in JS: het lezen van de PDF-structuur en alle toelatingsregels
(filters, kleurruimte, maskers, geheugengrenzen), de documentlus
(`monochrome-document.js`) en het opbouwen van het vervangende
streamwoordenboek. De keuzeregel vergelijkt complete streamobjecten; JS geeft
daarvoor de grootte van beide kandidaatwoordenboeken bij `/Length 0` mee, Rust
rekent `basis - 1 + cijfers(n) + n`.

**Bedrading.** `compress.js` vraagt via `getMonochromeNative()`
(`js/pdf/monochrome-rust.js`) één keer of de Rust-route er is
(`monochroom_rust_beschikbaar`) en geeft de encoder door aan
`optimizeMonochromeDocument({ native })`. Webversie en Android: geen
Rust-route. Faalt een aanroep, dan één waarschuwing in de console en de
JS-encoder doet dat beeld. `OPDS_RUST_MONOCHROME=0` (omgevingsvariabele van de
app) zet de Rust-route uit om te vergelijken.

**Pariteit.**
- CCITT G4 is byte-gelijk aan de JS-encoder: 34 referentiecodes (alle
  testbitmaps van `ccitt-g4.test.mjs`, beide `/BlackIs1`) in de Rust-tests, en
  40 coderingen van twintig 300 dpi-scanpagina's in
  `scripts/bench-rust/09-monochrome.mjs`.
- Flate: andere bytes (zlib-rs tegen de zlib van de webview), dezelfde inhoud
  na decoderen. Rust-Flate is op deze scans ~1,5 % kleiner; bij een bijna-gelijke
  stand tussen Flate en G4 kan de keuze daardoor in theorie omslaan. Op de
  gemeten pagina's wint G4 met ruim 30 % en is de keuze steeds gelijk.
- Uitpakken is even streng als `DecompressionStream`: afgekapte invoer en
  rommel na het einde geven `invalid-image-data`, te veel uitvoer
  `decoded-or-output-limit`. Volgorde van controles en redenen is gelijk.
- `monochrome-rust.test.mjs` toetst het contract met een JS-referentie van de
  Rust-regels: zelfde filter, reden, `before`/`after`, woordenboek en data als
  de JS-route, plus terugval en annuleren.

**Meting** (Node 24, Windows x64; `node scripts/bench-rust/09-monochrome.mjs`
vanuit `open-pdf-studio/`). A4-scan op 300 dpi: 2480×3509 px, gepakt 1062 KB,
acht bit 8,3 MB; bron Flate (zlib-niveau 6). Rust in-proces gemeten
(release-build); IPC als model: 1 ms per aanroep + 3 kopieën per richting
(~4 GB/s), dat is ~1,2 ms per pagina (157–206 KB heen, 105 KB terug).

| geval | JS met app-pauzes | JS zonder pauzes | Rust + IPC-model |
|---|---:|---:|---:|
| 1 pagina, één-bit bron | 116 ms | 53 ms | 17 ms (Rust 15,5) |
| 1 pagina, acht-bit grijs | 1847 ms | 126 ms | 32 ms (Rust 30,4) |
| document 20 pagina's (3,1 MB → 2,07 MB) | 2069 ms | 900 ms | 645 ms (Rust 311, IPC 24, pdf-lib + lijm 311) |

"App-pauzes" is de standaard-`checkpoint` van de JS-route (`setTimeout(0)` om
de 32 rijen bij het pakken, om de 512 rijen in G4). In Node op Windows kost
elke pauze ~15 ms; in de webview ~4 ms (geneste timers), dus daar ligt de
JS-tijd tussen de twee JS-kolommen. De Rust-route draait buiten de UI-thread en
heeft die pauzes niet nodig.

Rust is per beeld 3–4× sneller dan JS zonder pauzes; voor het hele document
1,4× (pdf-lib laden/opslaan blijft in JS en is dan de helft van de tijd).
Uitsplitsing per één-bit pagina in Rust: uitpakken ~2 ms, Flate (zlib-rs)
~9 ms, G4 ~4 ms. Met flate2/miniz_oxide was Flate 25 ms en Rust per pagina
niet sneller dan JS; daarom zlib-rs (licentie Zlib, stond al in Cargo.lock).

**Standaard.** Rust aan op de desktop: duidelijk sneller ook met een ruime
IPC-marge (zelfs 10 ms per aanroep houdt het document sneller dan JS).

**Live na te kijken.** De echte IPC-kosten in WebView2 (het model hierboven is
een aanname), en een compressierun in de app op een gescand document met
`OPDS_RUST_MONOCHROME=0` en zonder, met gelijke uitkomst per beeld.

**Vervolg (niet gedaan).** De documentlus doet de beelden na elkaar; Rust kan
meerdere beelden tegelijk als JS ze parallel aanbiedt (binnen het
documentbudget). Uitpakken van acht-bit bronnen kan ook via zlib-rs.

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
op Android (Tauri zonder PDFium-worker: `isMobile()` houdt de worker-weg
daar uit, zonder IPC-aanroep), voor een kant die alleen in het geheugen bestaat (de
versie van vóór het laatste opslaan), als de bestandslengte op schijf afwijkt
van wat de app heeft, als geen worker `compare` kent (een oudere sidecar
noemt het niet in `caps` van zijn Ready-regel en krijgt de aanvraag dus
nooit), en bij elke fout (één waarschuwing in de console, dan JS).
`OPDS_RUST_COMPARE=0` in de omgeving van de app dwingt JS af.

**Nog live te controleren:** Vergelijken in de app op echte tekeningen
(overlay en naast elkaar, automatische uitlijning, schaalcorrectie, rapport
over alle pagina's), het terugvallen met een oude sidecar en met
`OPDS_RUST_COMPARE=0`, en pagina's met annotaties.

**Formuliervelden.** pdf.js tekent met intent 'display' ook de weergaven van
formuliervelden; een gewijzigde veldwaarde is dan een wijziging. PDFium tekent
velden niet als annotatie maar alleen in de formulierstap (`FPDF_FFLDraw`), en
die stap kent geen matrix. Op een pagina met velden rendert de worker een
tegel daarom als de hele pagina op schaal met een verschoven oorsprong,
annotaties en velden mee; pagina's zonder velden houden de matrixroute. Live
gezien vóór deze aanpassing: tekening met tekst-, keuze-, keuzerondje- en
lijstveld, tweede versie met andere waarden en één extra lijn: JS 9
wijzigingen (de lijn plus de velden), worker 2 (alleen de lijn), terwijl de
overlay de nieuwe veldwaarden wel toonde.

## Snap-geometrie uit de PDF-tekening

**Wat:** de punten (eindpunten, middens) en randen waarop de snap-engine op
lijnwerk van de PDF snapt, plus de ruimtelijke index daarover. Voorheen liep
`pdf-snap-extractor.js` de hele PDF.js-operatorlijst van de pagina af; nu leest
de PDFium-worker de padobjecten uit de pagina die hij voor het tekenen al
geparst heeft (`pdfium-worker/src/snap_geometry.rs`), met CTM, de /Matrix van
geneste formulieren en de weergavematrix die de app meegeeft (paginarotatie,
gebruikersrotatie, /UserUnit, verschoven MediaBox). Krommen worden zoals in
JavaScript in vier gelijke parameterstappen recht gemaakt; ontdubbelen gaat
op hetzelfde raster van 0,1 px.

**Overdracht:** `extract_snap_geometry` (Tauri) → worker-request
`snap_geometry` → binaire `OSG1`-codering via de SHM-regio (in stukken als het
groter is dan 64 MB) → `tauri::ipc::Response` → `snap-geometrie-binair.js`. De
index komt kant-en-klaar mee: cellen met `Uint32Array`-blikken als vakjes, in
dezelfde volgorde als `buildSpatialIndex`.

**Keuze van de route:** desktop met een bestandspad (dezelfde voorwaarde als het
tekenen met PDFium) gebruikt de worker; anders, of als de worker faalt, de
PDF.js-route. Een worker die `snap_geometry` niet in zijn `caps` meldt (oudere
sidecar) krijgt het request nooit; de app valt dan voor de rest van de sessie
terug op JavaScript, met één waarschuwing in de console. JavaScript afdwingen:
`OPDS_RUST_SNAP=0` bij het starten van de app, of `window.__opdsRustSnap = false`
in de ontwikkelconsole.

**Pariteit** (`node --expose-gc scripts/bench-rust/snap-geometrie.mjs --alleen pariteit`):
lijnen, polylijnen (open en gesloten), krommen (`c`, `v`, `y`), rechthoeken,
geneste formulieren met /Matrix (ook gedraaid en tweemaal gebruikt), CTM met
schaal en scheefstand, /Rotate 90/180/270, /Rotate plus gebruikersrotatie,
verschoven MediaBox met /UserUnit 2: punten (met soort) en randen gelijk binnen
0,01 pt (grootste afwijking 1,5e-5). De index uit de worker is identiek aan
`buildSpatialIndex` op dezelfde punten. Op de zware tekening (435.157 punten,
199.978 randen) zijn alle randen gelijk (grootste afwijking 2,4e-4 px) en
verschillen 6 punten door een grensgeval van het ontdubbelen: een coördinaat
die precies op een celgrens van 0,1 px valt (x,x5), waar het laatste bitje van
de float32-waarde beslist in welke cel hij valt; PDF.js en PDFium lezen getallen
uit de inhoud net anders in float32. Zo'n punt heeft in de andere set altijd een
punt binnen één cel.

**Bewuste verschillen:**

- *Knippaden* (`re W n`): de JavaScript-route nam de knipgrens mee als snaprand,
  de Rust-route niet. Een knippad is geen getekende lijn, en PDFium kent het niet
  als eigen object (alleen als eigenschap van de objecten die het knipt). De
  pariteitstest controleert dat het verschil precies de knip-rechthoek is.
  Geknipte lijnen zelf komen in beide routes heel mee.
- *Weergaven van annotaties*: de PDF.js-operatorlijst bevat ook de weergave van
  annotaties, maar de JavaScript-route negeerde de matrix van de annotatie,
  zodat die lijnen op de verkeerde plek kwamen (in de test 200 pt verschoven).
  De worker tekent zonder annotaties (zoals de weergave in de app) en laat ze
  weg; de app snapt op haar eigen annotaties via de snap-engine.
- Een pad met alleen `n` (geen vulling, geen lijn, geen knip) maakt PDFium niet
  aan; de JavaScript-route nam het mee. Komt in de praktijk nauwelijks voor.

**Meting** (`node --expose-gc scripts/bench-rust/snap-geometrie.mjs`, Windows,
release-worker, mediaan van 5; de machine draaide tegelijk andere builds, dus
de getallen schommelen):

Zware tekening A1, 200.003 segmenten (polylijnen, lijnen, rechthoeken, krommen,
een blok via een formulier), 1,4 MB PDF, 83.599 operatoren:

| route | extractie | overdracht | decoderen | index | totaal |
|---|---:|---:|---:|---:|---:|
| JavaScript (PDF.js-operatorlijst + geometrie + index) | 2696 ms | - | - | in geometrie | 8084 ms |
| Rust koud (bestand laden + parsen + extractie) | 324 ms | 14 ms | 35 ms | 0 (mee uit de worker) | 374 ms |
| Rust warm (document in de workercache) | 362 ms | 13 ms | 31 ms | 0 | 406 ms |

Overdracht: 9,9 MB in één stuk. Piekgeheugen node-heap (+ArrayBuffers):
JavaScript 243 MB, Rust-route 76 MB; het workerproces piekt op 82 MB (los van
de WebView).

2.000.000 segmenten (14 MB PDF, 841.146 operatoren, 4,3 miljoen punten), één
run; de overdracht van 97,8 MB gaat in twee SHM-stukken:

| route | extractie | overdracht | decoderen | index | totaal |
|---|---:|---:|---:|---:|---:|
| JavaScript | 21.387 ms | - | - | in geometrie | 72.200 ms |
| Rust koud | 3493 ms | 236 ms | 1139 ms | 0 | 4869 ms |
| Rust warm | 2104 ms | 205 ms | 1546 ms | 0 | 3855 ms |

Piekgeheugen node-heap: JavaScript 1668 MB, Rust-route 688 MB (vooral de
4,3 miljoen puntobjecten zelf); workerproces 700 MB (vóór het vrijgeven van de
ontdubbel-set vóór het coderen, dat daarna is toegevoegd). Op zo'n blad is ook
de Tauri-IPC van ~100 MB naar de WebView een post om live te meten.

De grootste post in de JavaScript-route bleek de ruimtelijke index (tekst-
sleutels in een Map, en elke 2000 elementen een `setTimeout`): ruim de helft
van de tijd. Die komt nu kant-en-klaar uit de worker.

Niet gemeten: de laatste stap van de Rust-app naar de WebView (Tauri-IPC van
~10 MB per 200.000 segmenten). In de app draait PDF.js bovendien in een eigen
worker en kopieert de operatorlijst naar de hoofdthread; die kosten zitten
niet in de JavaScript-getallen hierboven (die zijn dus eerder te gunstig voor
JavaScript).

**Standaard:** Rust aan op het bureaublad. Ruim tien keer sneller end-to-end en
een derde van het geheugen in de WebView, met dezelfde snapset.

**Live te controleren:** snappen op een grote CAD-tekening (eindpunt, midden,
loodrecht, snijpunt) in het echte venster; de IPC-tijd van de WebView; dat het
ophalen van snap-geometrie tegelrenders op dezelfde worker niet merkbaar
ophoudt (beide lopen via de request-lock van die worker).

## Zoeken: tekst uit de PDFium-worker

**Wat is verplaatst.** Het lezen van de paginatekst voor het zoeken (zoekbalk,
zoeken in open documenten en in een map, MCP `app_search_documents`). Voorheen
haalde `extractPageText` (`js/search/find-controller.js`) per pagina pdf.js
`getTextContent()` op; de pdf.js-worker parste daarvoor de inhoud en laadde de
fonts, en de items gingen als structured clone naar de hoofdthread. Nu leest de
PDFium-worker de pagina's (`pdfium-worker/src/page_text/`, aanvraag
`page_text`) en geeft hij de tekstitems die pdf.js zou maken: dezelfde tekst,
spaties, regeleinden en itemgrenzen, met transform, breedte en hoogte, en per
teken het stuk basislijn dat het beslaat.

Blijft in JavaScript: het zoeken zelf (hoofdletters, hele woorden en de
reguliere expressie volgen precies `RegExp`; over 500 pagina's kost dat 2–9 ms,
zie de meting), de tekst van annotaties en SHX-annotaties, ingevoegde tekst
("Add Text") en de nog niet opgeslagen OCR-woorden (`metOcrWoorden`,
`ocr-laag.js`): die komen er na de worker-tekst bij zoals voorheen.

**Hoe.** PDFium heeft de tekst al gelezen (fonts, ToUnicode, coderingen). De
worker haalt per teken de Unicode-waarde, oorsprong, matrix en lettergrootte
uit de tekstpagina van PDFium (`FPDFText_*`), de voortgang uit de fontbreedte
(`FPDFFont_GetGlyphWidth`; de losse tekenbox neemt uitstekende inkt mee en
draait mee), en de volgorde, de formulier- en beeldgrenzen en de gemarkeerde
inhoud (BDC/EMC) uit de objectboom. Daarover draaien de itemregels van pdf.js
6.4 (`buildTextContentItem`, `compareWithLastPosition`, `addFakeSpaces`,
`normalizeUnicode`, `bidi`), regel voor regel overgenomen (`pdfjs.rs`,
`bidi.rs`). Wat PDFium zelf toevoegt of weglaat wordt rechtgezet: afgeleide
spaties en regeleinden (`IsGenerated`) vallen weg, een afbreekstreepje aan het
regeleinde (PDFium: U+0002) wordt weer '-', en een tekstobject met alleen
spaties en een kopie van een vorig tekstobject (vette tekst door twee keer
tekenen), die PDFium overslaat, komen terug.

**Overdracht:** `extract_search_text` (Tauri) → worker-request `page_text` voor
een reeks pagina's → binaire `OPT1`-codering via de SHM-regio (UTF-16-tekst,
48 bytes per item, 4 bytes per teken voor het tekenvak) →
`tauri::ipc::Response` → `rust-zoektekst.js`. De worker stopt na ~150 ms (na
minstens één pagina) en zegt hoeveel pagina's erin zitten; de app vraagt de
rest daarna, zodat tegelrenders op die worker niet lang wachten. De eerste
gevraagde pagina (de huidige) komt alleen, voor een snelle eerste treffer;
daarna lezen twee workers (banen, elk een eigen worker uit de pool van vier)
het document in stukken van 32 pagina's, hooguit 128 pagina's vóór het zoeken
uit.

**Markeringen.** Het tekenvak komt mee in de items (`vakken`); `find-bar.js`
gebruikt het voor het deel van een item dat een treffer beslaat
(`matchFractionsUitVakken`). Voorheen schatte de app dat met `measureText` in
een generieke letterfamilie; bij kerning, letter- of woordafstand (Tc/Tw) en
ligaturen zat ook een schatting met de echte fontbreedtes tot ~1 pt naast de
tekens (met `measureText` is het verschil groter).

**Keuze van de route:** desktop met een bestandspad, de bytes die de app van
het bestand heeft (`getCachedPdfBytes`; bij zoeken in een map de gelezen bytes)
hebben dezelfde lengte als het bestand op schijf, en de worker telt evenveel
pagina's als pdf.js. Anders, of bij een fout, pdf.js zoals voorheen (één
waarschuwing in de console; een gewijzigd bestand of een pool die nog opstart
zwijgend). Een worker die `page_text` niet in zijn `caps` noemt (oudere
sidecar) krijgt de aanvraag nooit; de app zet de route dan voor de sessie uit.
pdf.js afdwingen: `OPDS_RUST_SEARCH=0` bij het starten van de app, of
`window.__opdsRustZoeken = false` in de ontwikkelconsole. Webversie en
Android/iOS: ongewijzigd (pdf.js).

**Pagina's die pdf.js blijft lezen** (de worker markeert ze en de app leest die
pagina met pdf.js; de rest van het document gaat gewoon via de worker):
- schrift van rechts naar links (Hebreeuws, Arabisch): PDFium ontleedt daar
  presentatievormen naar basisletters (U+FE70–FEFF, bijvoorbeeld een
  lam-alef-ligatuur naar twee letters) en spiegelt haakjes; pdf.js laat de
  vormen staan. Voor zoeken op getypte basisletters is PDFium eigenlijk beter,
  maar dan zouden de treffers tussen desktop en webversie verschillen;
- verticaal schrift (Identity-V): PDFium geeft voor zo'n tekstobject geen
  tekens;
- een glyph zonder Unicode-vertaling (`FPDFText_HasUnicodeMapError`): pdf.js
  vindt er vaak nog een via de glyphnaam (© in een TeX-font, Type3 zonder
  ToUnicode, waar PDFium de tekencodes geeft);
- Type3-tekst op lettergrootte 1 of kleiner: pdf.js schaalt de letterhoogte dan
  met FontBBox × FontMatrix (TeX-bitmapfonts), die PDFium niet naar buiten
  geeft.

**Pariteit** (`node --expose-gc scripts/bench-rust/10-zoektekst.mjs --alleen
pariteit` en `--alleen echt`): de zoekfunctie van de app (`zoekPaginaAlleBronnen`
met `buildPattern`) op de tekst van beide routes, per zoekvraag gewoon,
hoofdlettergevoelig en hele woorden.
- Gemaakte PDF (`zoektekst-pdfs.mjs`, 14 pagina's): Latijn met Tj/TJ, kerning,
  meervoudige spaties, Tc, Tw, Tz, Ts (super- en subscript), lettergrootte- en
  fontwissels op één regel, losse BT-blokken, T*/' en regelafstand, geschaalde
  Tm en CTM, diakrieten, afbreking, gedachtestreep en aanhalingstekens;
  ligaturen via glyphnamen (/fi, /fl), via ToUnicode naar meer tekens ("ffi")
  en naar U+FB01/U+FB02; CJK (Chinees, Japans, Koreaans, gemengd met Latijn,
  TJ-gat); gedraaide tekst (90°, 180°, 270°, 45°, scheef); een pagina met
  /Rotate 90; tekst in formulieren (genest, met /Matrix, tweemaal gebruikt,
  gedraaid, en een formulier zonder tekst tussen tekst op één regel); CropBox
  met verschoven oorsprong en tekst erbuiten; onzichtbare tekst (3 Tr); Type3
  met ToUnicode; een lege pagina en een met alleen spaties. Uitkomst: op elke
  pagina die via de worker gaat dezelfde tekst en dezelfde treffers in dezelfde
  volgorde (538 treffers over de drie opties); het itemvak (transform, breedte,
  hoogte) wijkt 0,000 pt af, het treffervak hoogstens 0,004 pt waar JavaScript
  met de echte fontbreedtes kan rekenen. De pagina's met rechts-naar-links,
  verticaal schrift, Type3 zonder ToUnicode en Type3 op Tf 1 gaan bewust naar
  pdf.js; de zoektocht via de app-route (`extractPageText` met de bron) over
  het hele document is daardoor gelijk aan die via pdf.js. Een afwijkende
  bestandslengte valt terug naar pdf.js.
- Alle PDF's in de repository (41 bestanden, waaronder de verificatieset in
  `test pdf-bestanden` (alleen gelezen), de kaders en fixtures en het
  pdf.js-voorbeeld): op elke pagina gelijke tekst en gelijke treffers voor 11
  zoekvragen; één pagina gaat via pdf.js (© zonder Unicode in een TeX-font).
  Grootste itemvakverschil 0,13 pt (f32 in de codering).
- Onderweg gevonden en rechtgezet (elk zag je eerst als verschil): pdf.js sluit
  een item bij elke BDC/EMC (getagde PDF's uit een tekstverwerker: "€" en
  "1.200,00" als losse items); PDFium slaat een tekstobject met alleen een
  spatie over ("wateraccumulatie en" werd "wateraccumulatieen") en een dubbel
  getekend tekstobject (CAD-tekeningen); de losse tekenbox is breder dan de
  voortgang bij 'f' en 'r' (een spatie viel dan net onder de drempel van pdf.js).
- Nog wel anders, in de testset niet gezien: tekstrijzing (Ts) groter dan de
  letterhoogte (pdf.js corrigeert de regeleinde-toets daarvoor), een leeg
  BMC/EMC-paar tussen twee objecten met dezelfde markering, een inline beeld
  (BI/EI) midden in een regel (pdf.js sluit daar geen item, de worker wel),
  Type3 met een lege FontBBox op een grotere lettergrootte, en meer dan één
  spatie in een los spatie-object (telt als één). Rust-tests:
  `cargo test -p pdfium-worker page_text`; JavaScript:
  `node --test js/search/rust-zoektekst.test.mjs`.

**Meting** (`node --expose-gc scripts/bench-rust/10-zoektekst.mjs --alleen bench
--runs 5`, Windows x64, release-worker, mediaan van 5; de machine draaide
tegelijk andere builds en de JavaScript-tijden schommelden tussen meetrondes
met 30–50 %, dus vergelijk binnen een tabel). Een zoektocht zoals de zoekbalk
hem doet: vers geopend document, huidige pagina eerst, dan de rest, per pagina
`extractPageText` en de treffers. Rust inclusief de overdracht (stdin/stdout van
de worker, SHM lezen) en het decoderen; tijden in ms. "Piek node-heap" staat
voor de WebView (pdf.js draait onder node in dezelfde heap; in de app in een
eigen worker in hetzelfde proces); "tekstcache" is wat de zoekbalk daarna
bewaart.

Gemaakt tekstdocument, 500 pagina's A4 (2,37 miljoen tekens, afwisselend Tj met
spaties en TJ met kerning), zoekvraag "search" (8254 treffers):

| route | eerste treffer | totaal | waarvan zoeken | piek node-heap | tekstcache |
|---|---:|---:|---:|---:|---:|
| JavaScript (pdf.js) | 37 | 1874 | 9 | 91 MB | 11 MB |
| Rust, 1 baan | 36 | 1934 | 12 | 45 MB | 17 MB |
| Rust, 2 banen (standaard) | 39 | 1027 | 7 | 45 MB | 16 MB |
| Rust, 3 banen | 32 | 768 | 8 | 50 MB | 16 MB |

Zelfde document, een woord dat alleen op pagina 499 staat, huidige pagina 250:
tot de treffer JavaScript 1751 ms, Rust 1 baan 1367, 2 banen 726, 3 banen 749.

Tekensets uit de verificatieset, zoekvraag "e":

| tekening | pagina's | JS eerste / totaal | Rust (2 banen) eerste / totaal | piek node-heap JS / Rust |
|---|---:|---:|---:|---:|
| 3131-CLT-Set (1,4 MB) | 5 | 26 / 86 | 6 / 73 | 7 / 9 MB |
| Zware vector PDF (17 MB) | 19 | 74 / 1751 | 28 / 1113 | 109 / 121 MB |
| Barn Relocation (25 MB) | 7 | 136 / 289 | 58 / 152 | 60 / 27 MB |

Overdracht: 14,9 MB voor de 500 pagina's in 17 aanvragen (~30 KB per pagina);
een workerproces piekt op 32 MB. De laatste stap van de app naar de WebView
(Tauri-IPC) is niet gemeten; met het model van de monochroomstap (1 ms per
aanroep plus drie kopieën) is dat ~30 ms op de 500 pagina's.

Uitsplitsing van één baan (500 pagina's, in het workerproces): pagina laden
(`FPDF_LoadPage`) ~170–220 ms, de tekstpagina van PDFium (`FPDFText_LoadPage`)
~700–900 ms, de tekens opvragen ~150 ms, de itemregels van pdf.js en het
coderen de rest. De tekstpagina van PDFium is de bodem: per pagina ongeveer
even snel als pdf.js `getTextContent`. De tijdwinst komt uit het lezen met twee
workers tegelijk (pdf.js heeft in de app één worker) en bij tekeningen uit het
parsen door PDFium. De geheugenwinst komt doordat pdf.js geen fonts en geen
tekstinhoud meer opbouwt: de piek van de JavaScript-heap halveert bij een
tekstdocument. Bij de zware vectortekening domineert het openen van het
document in pdf.js (beide routes) en hangt de piek af van wanneer de garbage
collector draait. De tekstcache is met de Rust-route groter (16 tegen 11 MB op
500 pagina's: de tekenvakken komen mee).

**Standaard:** Rust aan op de desktop, met twee banen. Met één baan is Rust op
een tekstdocument niet sneller dan pdf.js (de tekstpagina van PDFium kost
evenveel als `getTextContent`), wel lichter; met twee banen 1,8–2,4× sneller
over het hele document met de helft van de piek in de JavaScript-heap, en op
tekeningen 1,2–1,9× sneller met de eerste treffer 2–4× eerder. Drie banen helpt
nog wat op lange tekstdocumenten, maar laat dan tijdens het zoeken maar één
worker vrij voor het tekenen.

**Live te controleren:** zoeken in een groot tekstdocument en in een zware
tekenset in het echte venster (tijd tot de eerste treffer, of het tekenen
tijdens het zoeken merkbaar ophoudt, het geheugen van de WebView); de
markeringen op gedraaide tekst, op tekst in formulieren en bij kerning; zoeken
in een document met nog niet opgeslagen OCR-woorden (die komen uit JavaScript
erbij); zoeken in een map en via MCP `app_search_documents`; een document met
Arabische of verticale tekst (die pagina's via pdf.js); en het terugvallen met
`OPDS_RUST_SEARCH=0` en met een oudere sidecar.

## Annotaties laden bij het openen: onderzocht, JS blijft

**Vraag.** Kan het lezen van de annotaties bij het openen (pdf.js
`getAnnotations` per blad, de pdf-lib-lezing van de rauwe woordenboeken in
`extractAnnotationColors`, en het omzetten naar het model) sneller door de
rauwe extractie naar Rust te verplaatsen, met het omzetten in JS?

**Uitkomst.** Nee, niet duidelijk genoeg: JS blijft, er is geen Rust-route
ingebouwd. Het profiel vond wel de grootste post, en die zat in JS: een
kwadratische zoekactie, nu gerepareerd met dezelfde modellen als uitkomst.

**Meetset** (`scripts/bench-rust/annotaties-set.mjs`): 100 bladen A1, met de
echte saver geschreven: per blad 500 annotaties in 22 soorten (vormen, wolk,
lijnen en pijlen, maatlijn, meetvlak, meetomtrek, telling, aanwijzer,
tekstvak, stempel, inkt, notitie, antwoord met status, links naar een URL en
naar een blad, boog, gebogen aanwijzer, arcering, gedraaide vorm met
doorzichtigheid), dus met de OPS_-sleutels, appearances en /Measure, plus per
blad 6 annotaties zoals een ander programma ze schrijft (eigen sleutels,
ExtGState-alfa in de appearance, /PolygonDimension, markering). Samen 57.500
annotatiewoordenboeken, 50.600 modellen, 67 MB.

**Profiel van de JS-lader** (`node --expose-gc --max-old-space-size=8192
scripts/bench-rust/10-annotaties-profiel.mjs`, node 24, Windows, dezelfde
stappen als `loadExistingAnnotations`, twee runs; de machine draaide
tegelijk andere builds, dus de getallen schommelen):

| stap | vóór de reparatie | na de reparatie |
|---|---:|---:|
| pdf.js openen | 0,3 s | 0,1 s |
| pdf.js `getAnnotations`, alle bladen | 4,3–6,6 s | 2,3–3,9 s |
| pdf-lib `PDFDocument.load` (hele bestand) | 15,8–16,0 s | 15,3–15,9 s |
| `extractAnnotationColors`, alle bladen | 5,8–8,3 s | 3,3–7,2 s |
| `zetPaginaAnnotatiesOm` (omzetten) | 36,7–64,7 s | 1,9–3,9 s |
| totaal | 68–91 s | 24–31 s |

De omzetting ging voor 80 % op aan `zoekExtraKleuren`
(`js/pdf/loader/extra-sleutel.js`): bij elke annotatie waarvan de /Rect niet
exact als sleutel in de kaart stond, liep de vage match alle sleutels van het
blad af, met een `split` per sleutel, en dat per aanroep (meerdere per
annotatie). Dat missen gebeurt bij ruim een derde van de annotaties van de app:
de saver schrijft `160.64000000000001`, pdf-lib leest dat met `Number()`,
pdf.js telt cijfer voor cijfer en komt op `160.64`. Nu een index per kaart
(vakken van 8 pt op x0) en een geheugen per gevraagde rechthoek; dezelfde
regel (kleinste afstand onder 8, bij gelijke afstand de eerste in de kaart).
Pariteit: `extra-sleutel.test.mjs` vergelijkt de index met de volle doorloop
op 2000 rechthoeken met gelijke afstanden en sleutels die geen rechthoek
zijn, en `scripts/bench-rust/10-annotaties-model.mjs` (vaste klok en vaste
toevalsreeks, zodat id's en tijdstempels gelijk zijn) gaf voor en na de
reparatie byte-gelijke modellen: 50.600 op de grote set, 2530 op 5 × 500.

**Rust-meetprototype** (`scripts/bench-rust/annotaties-rust/`, een losse
crate met lopdf 0.34 buiten de workspace): bestand laden, van alle bladen
elk annotatiewoordenboek met opgevolgde verwijzingen (pagina's en andere
annotaties als verwijzing, stromen als woordenboek + lengte) als JSON. Dat is
de ondergrens van een Rust-route; de semantiek en het omzetten blijven daarna
in JS.

| stap | 5 × 500 (2875 annotaties) | 100 × 500 (57.500) |
|---|---:|---:|
| lopdf laden | 66 ms | 1,4–1,8 s |
| woordenboeken doorlopen | 46 ms | 1,2 s |
| JSON coderen | 8 ms | 0,2 s |
| IPC (model: 1 ms + 3 kopieën van ~4 GB/s) | 3 ms | 42 ms (52,7 MB) |
| `JSON.parse` in JS | 13 ms | 0,34–0,40 s |
| totaal | 135 ms | 3,1–3,5 s |
| geheugen in JS | 5 MB | 90 MB |

Ter vergelijking het geheugen van de JS-route: het pdf-lib-document van dit
bestand 321 MB, pdf.js met de annotaties van alle bladen 505 MB; het
structured clone van die annotaties naar de hoofdthread (in de app draait
pdf.js in een eigen worker) ~0,7 s.

**Waarom het niet loont.**
- De grootste post die overblijft, `PDFDocument.load` (15 s, 60 % van het
  totaal), verdwijnt er niet mee. De lader start die bij elk openen
  (`getSharedPdfLibDoc` in `loader.js`) en zeven andere lezers wachten erop:
  annotatielagen, 3D, stijlsets, goedkeuringen, kop- en voettekst,
  viewports/UserUnit en schalen. pdf-lib leest het hele bestand in één keer op
  de hoofdthread (`objectsPerTick` staat op oneindig); een blad met een
  rechthoek wacht er bij het openen ook op (`loadAnnotationsForSinglePage`).
- Wat Rust wel kan overnemen is hoogstens `getAnnotations` (in de app al in
  de pdf.js-worker) en het lezende deel van `extractAnnotationColors`: samen
  ~5–10 s op deze set, tegen ~3,5 s voor de Rust-route plus een JS-laag die de
  records nog moet duiden. Eind tot eind dus van ~25 s naar ~20 s, en alleen
  na een volledige nabouw.
- Die nabouw is groot en breekbaar. PDFium geeft per sleutel alleen een
  f32-getal of tekst, en kan de sleutels van een woordenboek niet opsommen
  (geen OPS_- of vreemde sleutels, geen geneste /Measure); lopdf 0.34 bewaart
  reële getallen als f32 (`1586.635294117647` wordt `1586.6353`), dus er moet
  een eigen f64-lezer bovenop. Het model leest bovendien twee bronnen met elk
  hun eigen getallen: velden uit pdf.js (cijfer voor cijfer) en uit pdf-lib
  (`Number()`), en de bronvingerafdruk (`pdfBron`, saver/bron-behoud.js) is
  een hash van pdf-libs `PDFDict.toString()`. Rust moet beide exact nadoen,
  anders herschrijft de saver annotaties die niet veranderden. Daarbij komen
  velden die pdf.js zelf afleidt, zoals de tekst uit de appearance van een
  tekstvak (`textContent`, met fontdecodering).

**Standaard:** JS, op desktop en web. Geen `OPDS_RUST_*`-vlag, want er is
geen Rust-route.

**Wat wel zou helpen (niet gedaan).**
- `objectsPerTick` meegeven aan `PDFDocument.load` in `getSharedPdfLibDoc`:
  dezelfde uitkomst, maar de hoofdthread blijft tussendoor bereikbaar in
  plaats van 15 s vast te zitten. Live te meten hoeveel langer het laden dan
  duurt.
- Een volgende Rust-stap op het gedeelde pdf-lib-document bij het openen: de
  zeven lezers hebben elk maar een klein deel van de catalogus en de bladen
  nodig. Pas als dat document niet meer bij elk openen geladen wordt, loont
  het om ook de annotaties uit Rust te halen.

**Live na te kijken.** De reparatie van de vage match in de app: een zware
markeringsset openen (de `[PERF] page …: convertAnnotations`-regels) en
nagaan dat kleuren, lagen en antwoorden er nog zijn zoals voorheen. De
getallen hierboven zijn onder node gemeten; in de WebView kunnen pdf-lib en
de omzetting trager of sneller zijn.

## Bytes rauw over de grens: afdrukken en tekencommando's

**Wat.** Twee commando's stuurden bytes als JSON-array met één getal per byte
(het eerste punt uit #463, toen gemeten en niet gedaan). Er verhuist geen
rekenwerk; alleen de overdracht verandert.

- `write_temp_pdf` (afdrukken in `js/pdf/print-job.js`, en samengevoegd openen
  vanuit de printwachtrij in `PrintQueueWindow.jsx`): de app riep het aan met
  `Array.from(pdfBytes)`. Nu gaat de PDF als rauwe body en de taaknaam
  procent-gecodeerd in de kop `x-opds-name` (`writeTempPdf` in
  `js/core/platform.js`), net als `write_file_atomic`. Android kan geen rauwe
  body versturen en houdt de JSON-vorm; het commando leest beide.
- `extract_draw_commands` (de tekencommando's van vectorpagina's voor de
  miniaturen en het voorladen, `js/pdf/loader.js` en `js/pdf/renderer.js`) gaf
  `Vec<u8>` terug. Nu een `tauri::ipc::Response`; de aanroepers namen al een
  `ArrayBuffer` aan.

`read_file` en `extract_draw_commands_batch` hadden geen aanroepers meer en
zijn weg.

**Meting** (`node scripts/bench-rust/04-ipc-boundary.mjs`, met de serialiseerder
die Tauri zelf injecteert; #463, node 24):

| richting | als JSON | rauw |
|---|---:|---:|
| JS → Rust, 1 MB | 105 ms, 3,6 MB tekst | 0,1 µs, 1,0 MB |
| JS → Rust, 8 MB | 1587 ms, 28,6 MB tekst | 0,1 µs, 8,0 MB |
| Rust → JS, 1 MB | 22 ms `JSON.parse` | 0,3 µs |
| Rust → JS, 8 MB | 182 ms | 0,3 µs |

Een afdruktaak van 30 MB kostte dus ruim 3 s aan omzetten op de
interface-thread, plus een tussenarray van 30 miljoen getallen; een
vectorpagina met een paar MB tekencommando's 50–150 ms per pagina. Het
serde-werk aan de Rust-kant is niet gemeten. (Op 11-11 met een bouwende
machine gaf dezelfde meting 265 ms per MB voor `Array.from`.)

**Toets.** `js/core/temp-pdf.test.mjs`: rauwe body en kop op de desktop, geen
kop zonder naam, JSON met naam op Android, fout in de browser.

**Live na te kijken.** Een groot document afdrukken (de taaknaam in de
wachtrij van de printer, ook met leestekens), twee taken uit de printwachtrij
samengevoegd openen, en de miniaturen van een document met vectorpagina's.

## Symbolen zoeken: het zoeken in Rust, op hetzelfde beeld

**Wat is verplaatst.** `matchSymbols()` uit `js/search/symbol-matcher.js`: per
variant (draaiing × schaal) het sjabloon over het binaire paginabeeld
schuiven, vensters met de verkeerde hoeveelheid inkt overslaan, de rest op
doorsnede/vereniging scoren, en overlappende treffers uitdunnen. Dat staat nu
in de crate `open-pdf-scan` (pure logica, `cargo test -p open-pdf-scan` draait
gewoon). Het Tauri-commando `symbol_match_raster`
(`src-tauri/src/symbool_zoeken.rs`) krijgt het sjabloon en het beeld als rauwe
body (één byte per pixel) en de maten en toleranties in de kop
`x-opds-symbol`, en geeft de treffers terug.

Blijft in JS: de pagina renderen met pdf.js, `binaryImage()` en
`cropTemplate()` (samen 10–30 ms), het omrekenen naar paginacoördinaten, de
zoekvraag bewaren en de tellingen plaatsen. De JS-matcher blijft de terugval:
webversie, Android/iOS, een ontbrekend of falend commando (één waarschuwing in
de console) en `OPDS_RUST_SCAN=0`.

**Waarom op hetzelfde beeld.** Het beeld dat Rust krijgt is het beeld dat de
JS-matcher zou krijgen, dus de treffers zijn dezelfde. De andere mogelijkheid,
de pagina ook door PDFium laten renderen, is gebouwd en gemeten maar staat niet
aan; zie verderop.

**Pariteit.** `scripts/bench-rust/scan-golden.mjs` maakt beelden en laat de
JS-modules erop los; `open-pdf-scan/src/tests.rs` eist dezelfde uitkomst:
sjabloon, treffers in dezelfde volgorde, de afkapvlag, en scores en schalen
bit voor bit (f64-bitpatronen in de fixture). 15 gevallen: een tekening met
het symbool gedraaid, geschaald en beschadigd; alle twaalf varianten; drempel
1; dubbele toleranties; een rechthoek op gebroken coördinaten; een raster dat
na 5000 kandidaten afkapt; meer dan 1000 treffers; een sjabloon dat gedraaid
niet in het beeld past; en de fouten `INVALID_TOLERANCE`, `TEMPLATE_BOUNDS` en
`TEMPLATE_NEEDS_CONTRAST`. Samen ruim 2000 treffers. Ook `binaryImage()` zelf
(grijs rond de drempel, kleur, alfa). De rijen van een variant lopen in Rust
op een paar threads; de treffers worden in rijvolgorde samengevoegd, zodat de
grens van 5000 kandidaten op dezelfde plek valt.

**Meting** (`node scripts/bench-rust/11-symbool-formulier.mjs --worker …`,
node 24, Windows x64, release-build; de machine draaide tegelijk andere
builds). Het raster is hoogstens 1200 px op de lange zijde. Zoektijd in ms,
JS zonder de pauzes van de app:

| pagina | raster | JS, 1 variant | Rust, 1 variant | JS, 12 varianten | Rust, 12 varianten |
|---|---|---:|---:|---:|---:|
| 3131-CLT-Set p2 | 1200×809 | 171 | 9 | 739 | 61 |
| Zware vector PDF p3 | 1200×849 | 491 | 35 | 3287 | 306 |
| NKD1a p2 | 1200×555 | 76 | 6 | 289 | 36 |
| HY-103-1 p1 | 1200×721 | 3850 | 53 | 30.613 | 809 |
| contractvoorstel p1 | 849×1200 | 58 | 16 | 683 | 103 |
| Technische tekening p1 | 1201×848 | 37 | 9 | 427 | 57 |

Rust is 4 tot 70 keer sneller, het meest waar het telt (een dichte tekening
met veel kandidaten). Daar komt bij dat de JS-matcher om de 16 rijen pauzeert
(`setTimeout(0)`): ongeveer 50 pauzes per variant en pagina, in de WebView
~4 ms per stuk, dus ~0,2 s per variant bovenop de tabel; de Rust-route heeft
die pauzes niet nodig. De overdracht is het beeld zelf, hoogstens 2 MB als
rauwe body (met het model van de monochroomstap ~2 ms). De pdf.js-render vóór
het zoeken blijft: 0,04–10 s op deze pagina's (onder node met
@napi-rs/canvas; in de WebView niet gemeten).

**Standaard.** Rust aan op de desktop.

**Onderzocht en niet aangezet: ook de render door PDFium.** De worker kan de
pagina zelf renderen en erop zoeken (aanvraag `symbol_scan`,
`pdfium-worker/src/raster_scan/`), zodat ook de pdf.js-render en
`getImageData` van de interface-thread verdwijnen. Eind tot eind met één
variant: 876 → 646 ms (CLT), 5950 → 2976 (NKD1a), 13.657 → 2807 (HY-103),
611 → 48 (Technische tekening); op Zware vector p3 geen winst (3018 → 3327).
Maar het raster van PDFium is niet dat van pdf.js: 82–95 % van de inktpixels
valt precies samen, 99–100 % binnen één pixel
(`scripts/bench-rust/scan-raster-verschil.mjs`). Voor deze matcher is die ene
pixel veel: op een proefblad met hetzelfde symbool op 60 plekken met gebroken
coördinaten (`scripts/bench-rust/scan-waarheid.mjs`) liggen de scores van de
echte symbolen in beide routes tussen 0,56 en 0,97, rond de standaarddrempel
van 0,75:

| drempel | JS, zelfde draaiing | worker | JS, vier draaiingen | worker |
|---|---:|---:|---:|---:|
| 0,75 (standaard) | 12 van 29 | 10 van 29 | 27 van 60 | 16 van 60 |
| 0,6 | 27 van 29 | 27 van 29 | 57 van 60 | 60 van 60 |

Geen van beide routes gaf een valse treffer. De worker scoort gelijkmatiger
(laagste score 0,62 tegen 0,56) maar minder vaak boven 0,75, dus met de
standaarddrempel vindt hij met draaiingen minder. Dat is een andere uitkomst
voor de gebruiker, geen snelheidswinst alleen; daarom staat deze route uit.
`window.__opdsSymbolRender = 'pdfium'` in de ontwikkelconsole zet hem aan om
te vergelijken. De meting laat ook zien dat de matcher zelf op dun lijnwerk
bij de standaarddrempel minder dan de helft vindt, in beide routes; dat is
een eigenschap van het algoritme en los van deze stap.

**Live na te kijken.** Symbolen zoeken op een tekening (één pagina en een
reeks, met draaiingen en schalen), dezelfde treffers met `OPDS_RUST_SCAN=0`,
afbreken tijdens het zoeken, en de voortgangsbalk.

## Symbolen zoeken: een score die één pixel verdraagt

**Aanleiding.** De meting hierboven liet zien dat de matcher op dun lijnwerk
bij de standaarddrempel minder dan de helft van de echte symbolen vond, in
beide routes: de score was doorsnede/vereniging van inktpixels, en een lijn
van één pixel die één pixel verschuift (een symbool op een gebroken
pixelpositie, of een andere renderer) halveert die. De getallen in de twee
tabellen van het vorige hoofdstuk zijn met die oude score gemeten.

**Wat is veranderd** (in `js/search/symbol-matcher.js` en gelijk in
`open-pdf-scan/src/symbol.rs`; dit verandert de uitkomst, ook in de webversie):
- De score is het aandeel van de inkt dat het andere beeld binnen één pixel
  verklaart: (sjablooninkt met beeldinkt ernaast + beeldinkt met sjablooninkt
  ernaast) / (sjablooninkt + beeldinkt), over het venster van het sjabloon.
  Een exacte kopie scoort nog steeds 1.
- Waarborg tegen dichte inkt die niets met het sjabloon te maken heeft (tekst,
  arcering): de gewone doorsnede/vereniging moet minstens 0,6 × de drempel
  halen (`EXACT_SHARE`).
- De voorselectie op hoeveelheid inkt is verruimd naar 0,8 × de drempel
  (`COUNT_SHARE`) en de ankerpunten kijken in het gegroeide beeld, anders
  vallen verschoven kopieën al af vóór het scoren.

**Meting tegen de waarheid** (`scripts/bench-rust/scan-waarheid.mjs`; een blad
met het symbool op 60 plekken, 29 in de draaiing van het sjabloon; gevonden
van aanwezig, tussen haakjes valse treffers):

| drempel | score | JS, zelfde draaiing | worker | JS, vier draaiingen | worker |
|---|---|---:|---:|---:|---:|
| 0,75 (standaard) | oud | 12 van 29 (0) | 10 van 29 (0) | 27 van 60 (0) | 16 van 60 (0) |
| 0,75 (standaard) | nieuw | 29 van 29 (0) | 29 van 29 (0) | 60 van 60 (0) | 60 van 60 (0) |
| 0,6 | oud | 27 van 29 (0) | 27 van 29 (0) | 57 van 60 (0) | 60 van 60 (0) |
| 0,6 | nieuw | 29 van 29 (0) | 29 van 29 (14) | 60 van 60 (0) | 60 van 60 (27) |

Gelijk voor lijndiktes van 0,5, 1 en 2 pt; op het blad met /Rotate 90 geeft
ook de JS-route bij 0,6 valse treffers (15 en 24). Bij de standaarddrempel
vinden beide routes nu alles zonder valse treffers; een lagere drempel is met
de nieuwe score ruimer dan vroeger en geeft op dit blad valse treffers. De
keuze van de waarborg is gemeten met `scripts/bench-rust/scan-tolerant-proef.mjs`:
zonder waarborg gaf een willekeurig tekstvenster op een tekstpagina 101
treffers, met 0,6 nog 3 (was 1), en bij 0,5 bleven op de proefbladen enkele
valse treffers over.

**Pariteit.** De fixtures zijn opnieuw gemaakt met de aangepaste JS-matcher;
`cargo test -p open-pdf-scan` eist weer dezelfde treffers in dezelfde volgorde
met bitgelijke scores (15 gevallen, ruim 1500 treffers). In
`symbol-matcher.test.mjs`: een kopie waarvan een halve lijn één pixel
verschoven is wordt gevonden (met de oude score niet), en een dicht
willekeurig patroon geeft alleen zichzelf.

**Snelheid.** De ruimere voorselectie laat meer vensters door, dus het zoeken
zelf kost meer. Zelfde pagina's en omstandigheden als hierboven (de machine
was nog drukker), ms:

| pagina | JS, 1 variant | Rust, 1 variant | JS, 12 varianten | Rust, 12 varianten |
|---|---:|---:|---:|---:|
| 3131-CLT-Set p2 | 289 | 17 | 1628 | 156 |
| Zware vector PDF p3 | 2561 | 147 | 4873 | 297 |
| NKD1a p2 | 581 | 309 | 2342 | 2089 |
| HY-103-1 p1 | 7237 | 134 | 11.359 | 898 |
| contractvoorstel p1 | 633 | 120 | 4623 | 1049 |
| Technische tekening p1 | 607 | 74 | 3782 | 699 |

**De render door PDFium blijft uit.** Bij de standaarddrempel is het verschil
tussen de twee rasters met de nieuwe score verdwenen op de proefbladen, maar
bij een lagere drempel geeft het PDFium-raster meer valse treffers dan dat van
pdf.js. `window.__opdsSymbolRender = 'pdfium'` blijft de schakelaar om te
vergelijken.

**Live na te kijken.** Symbolen zoeken op echte tekeningen: of de extra
treffers echte symbolen zijn, en of de standaarddrempel in de dialoog nog de
goede is.

## Formulierherkenning: het paginabeeld uit de PDFium-worker

**Wat is verplaatst.** Voor "Formuliervelden herkennen" rendert de app per
pagina een raster van hoogstens 1600 px, niet gedraaid, en zoekt
`detectFormShapes()` (`js/pdf/form-recognition.js`) daarin samenhangende
inktgebieden: een lange dunne lijn is een schrijflijn, een lege omlijning een
tekstvak, aankruisvakje of keuzerondje. Op de desktop rendert nu de
PDFium-worker de pagina op dezelfde maat (`render_scan`: wit papier, geen
annotaties of velden, /Rotate teruggedraaid) en draait de port van
`detectFormShapes()` uit `open-pdf-scan` (aanvraag `form_shapes`, commando
`raster_scan_page`). Terug gaan alleen de vormen, als één JSON-regel.

Blijft in JS: de tekst van de pagina (pdf.js `getTextContent`, of OCR), de
bestaande velden, `labelCandidates()`, en het maken van het formulier met
pdf-lib. De pdf.js-route blijft de terugval: webversie, Android/iOS, een
document waarvan de bytes afwijken van het bestand op schijf, een worker
zonder `raster_scan` in zijn `caps`, elke fout (één waarschuwing), en
`OPDS_RUST_SCAN=0`.

**Pariteit, deel 1: het algoritme is bitgelijk.** Dezelfde fixtures en test
als hierboven: vijf paginabeelden (drie schalen, meer dan 500 kandidaten, een
lege pagina) met tekstvakken, aankruisvakjes, keuzerondjes, schrijflijnen,
gevulde vlakken, te korte en te hoge vormen en grijs net onder en boven de
inktdrempel; vormen in dezelfde volgorde, alle getallen bit voor bit.

**Pariteit, deel 2: PDFium tegen pdf.js.** Het raster verschilt langs randen
ongeveer een pixel (zie hierboven). Op een gemaakt papieren formulier met 8
tekstvakken, 6 aankruisvakjes, 4 keuzerondjes en 4 schrijflijnen op gebroken
coördinaten (`scan-waarheid.mjs`), met lijndiktes van 0,5, 0,75, 1 en 1,5 pt
en een pagina met /Rotate 90, vinden beide routes hetzelfde: alle tekstvakken,
aankruisvakjes en schrijflijnen, en evenveel vormen in totaal (23). De
keuzerondjes worden vanaf 0,75 pt in beide routes als aankruisvakje gezien;
dat is het algoritme, niet de route. Op bouwtekeningen, waar de vormen
toevallige rechthoeken in het lijnwerk zijn, verschilt het aantal wel (8
tegen 5, 16 tegen 12 op de meetpagina's).

**Meting** (zelfde script en omstandigheden; ms). JS = pdf.js-render +
`getImageData` + `detectFormShapes`; worker = één aanvraag, warm (koud is het
openen van het bestand erbij: 30–1000 ms):

| pagina | raster | JS: render | lezen | herkennen | totaal | worker: render | herkennen | totaal |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| contractvoorstel p1 | 1132×1600 | 26 | 31 | 32 | 88 | 19 | 8 | 27 |
| Technische tekening p1 | 1131×1600 | 110 | 73 | 85 | 268 | 54 | 9 | 64 |
| 3131-CLT-Set p2 | 1600×1079 | 622 | 43 | 107 | 773 | 720 | 5 | 726 |
| Zware vector PDF p3 | 1600×1132 | 2631 | 130 | 123 | 2884 | 2067 | 12 | 2079 |
| NKD1a p2 | 1600×740 | 5504 | 206 | 98 | 5808 | 3222 | 8 | 3231 |
| HY-103-1 p1 | 962×1600 | 11.845 | 54 | 117 | 12.016 | 3052 | 26 | 3079 |

Op documenten (waar formulieren staan) 3 tot 4 keer sneller; op zware
tekeningen bepaalt de render de tijd en wint PDFium 1 tot 4 keer. Het
herkennen zelf was in JS al klein; de winst zit in de render, in het
teruglezen van de pixels, en in het feit dat geen van drieën nog op de
interface-thread gebeurt.

**Standaard.** De worker aan op de desktop: sneller, en op formulieren
dezelfde velden.

**Live gecontroleerd** (12-11, release-build als onzichtbare testinstantie met
eigen datamap, via de tools `app_recognize_form` en `app_search_symbols`, met
en zonder `OPDS_RUST_SCAN=0`):
- Symbolen zoeken op het proefblad: dezelfde treffers in dezelfde volgorde met
  dezelfde scores, 12 bij de standaardinstelling en 57 met twaalf varianten op
  drempel 0,6; met twaalf varianten 2,2 s tegen 3,8 s (de pdf.js-render zit in
  beide).
- Formulierherkenning op het proefformulier (0,75 pt, ook met /Rotate 90): in
  beide routes 23 kandidaten met dezelfde verdeling (8 tekstvakken, 4
  schrijflijnen, 10 aankruisvakjes, 1 keuzerondje) en dezelfde labels; alle
  echte velden in beide. 20 van de 23 vallen binnen 1,5 pt samen. De rest:
  een ander rondje krijgt de soort keuzerondje, en elke route ziet één andere
  letter uit de tekst aan voor een vakje. 61 ms tegen 169–265 ms.
- `write_temp_pdf` met 6 MB: dezelfde bytes op schijf, de naam met leestekens
  behouden; 0,4–0,8 s rauw tegen 4,9–5,5 s in de oude JSON-vorm (drukke
  machine). `extract_draw_commands` geeft een `ArrayBuffer`; `read_file` en
  `extract_draw_commands_batch` bestaan niet meer.
- Een bestand dat op schijf afwijkt geeft `PDF_SCAN_STALE`, een ongeldige
  draaiing `INVALID_TOLERANCE`; geen waarschuwingen in de console.

**Nog live na te kijken.** Velden herkennen op een gescand formulier en met
OCR, afdrukken naar een echte printer (de taaknaam in de wachtrij), twee
taken uit de printwachtrij samengevoegd openen, het terugvallen met een
oudere sidecar, en macOS en Linux.
