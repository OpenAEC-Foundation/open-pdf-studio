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
