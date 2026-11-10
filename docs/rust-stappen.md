# Rust-stappen: rekenwerk van JavaScript naar Rust

Per stap één onderdeel dat in JavaScript veel rekentijd of geheugen kost, in
Rust binnen de bestaande Tauri-app. De JavaScript-uitvoering blijft altijd de
terugval (web, Android, verouderde worker, fout) en is per stap uit te zetten
om te vergelijken. Elke stap heeft een pariteitstest op gemaakte invoer en een
meting onder `open-pdf-studio/scripts/bench-rust/`.

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
