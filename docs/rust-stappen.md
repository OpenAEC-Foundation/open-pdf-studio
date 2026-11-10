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
