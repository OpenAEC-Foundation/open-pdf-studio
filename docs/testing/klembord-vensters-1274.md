# Annotaties kopiëren tussen vensters — #1274

## Reproductie

Op upstream `7168c6d64d995c683b1722569b30214642e3364b` houdt elk venster zijn eigen `clipboardState` bij. Een lijn kopiëren in venster A laat het klembord in venster B leeg. De browserproef met twee afzonderlijke app-pagina's liep vóór de wijziging vast bij het wachten op de gekopieerde lijn in B.

## Oplossing en grenzen

Een expliciete kopie (één annotatie, een selectie of een gekozen klembordgeschiedenis-item) deelt een onafhankelijke JSON-kopie met andere open app-vensters. Losgetrokken Tauri-tabs zijn afzonderlijke processen (`window_mgmt.rs`); de gewone eventbus bereikt die niet. Ze erven nu een lokaal brokeradres en een willekeurig sessietoken van de hoofdapp. De native opdracht `exchange_annotation_clipboard` wisselt data uit met deze broker in het geheugen. De browser gebruikt BroadcastChannel binnen dezelfde origin. Er komen geen nieuwe externe toegangsrechten bij. Een nieuw venster vraagt de nieuwste kopie op bij reeds open vensters. De uitwisseling blijft in het geheugen; er wordt niets naar opslag, externe server of systeemklembord geschreven door deze uitwisseling. De bestaande afbeeldingsexport naar het systeemklembord blijft werken.

Afbeeldingspixels die alleen in de broncache staan reizen als data-URL mee. Het ontvangende venster decodeert ze en gebruikt eigen cache-ID's. Een verouderde, langzaam ladende kopie kan een nieuwere kopie niet overschrijven. Bestaande plakfuncties blijven verantwoordelijk voor nieuwe annotatie-ID's, plaatsing, gekoppelde annotaties en undo. Dupliceren publiceert geen nieuwe expliciete kopie naar andere vensters. Ontvangen kopieën voegen geen geschiedenis-items toe en veroorzaken geen heruitzending.

Dit deelt het klembord tussen de hoofdapp en haar losgetrokken processen, of browservensters met dezelfde origin. Onafhankelijk gestarte sessies zonder geërfd adres, verschillende browserprofielen/origins en kopiëren nadat alle deelnemende processen zijn gesloten vallen buiten deze sessie-uitwisseling. De broker luistert alleen op loopback, verifieert een willekeurig sessietoken en begrenst berichten op 64 MiB. Ontvangers controleren elke seconde, bij focus en vóór plakken. Na sluiten van het brokerproces kan een ander proces het adres overnemen en zijn geheugenkopie terugzetten. Er wordt geen tekst/afbeelding van andere apps ingelezen door het nieuwe protocol. De bestaande focusregel en native plakroute blijven intact.

## Verificatie

Vanuit `open-pdf-studio`:

```sh
node --test js/annotations/window-clipboard-channel.test.mjs
node scripts/window-clipboard-e2e.mjs
cargo test --manifest-path scripts/review-native-tests/Cargo.toml annotation_clipboard
cargo build --manifest-path scripts/review-native-tests/Cargo.toml --bin clipboard-probe
NATIVE_CLIPBOARD_PROBE="$PWD/scripts/review-native-tests/target/debug/clipboard-probe" node scripts/window-clipboard-e2e.mjs
```

Vier Rust-tests controleren onafhankelijke clients, een echt kindproces, token-/payloadvalidatie en overname van een gesloten endpoint. Dezelfde zeven browserscenario’s draaien ook via de productie-Rustbroker met aparte clientprocessen. De pure JavaScript-tests controleren onafhankelijke kopieën, groepen, opvragen bij openen, volgorde, trage afbeeldingsdecodering, ongeldige berichten, afsluiten en de Tauri-/browsertransporten. De echte browsertest gebruikt meerdere app-vensters en controleert lijnen, groepen in beide richtingen, Ctrl+V, undo/redo, plakken op plaats, een nieuw geopend venster, cache-afbeeldingspixels na sluiten van het bronvenster, geschiedenis en alleen-lezen-/tekstveldbeveiliging.

Voor kwalificatie in geïnstalleerde Tauri: open twee PDF-vensters, kopieer een lijn en een afbeelding/groep in beide richtingen, controleer Ctrl+V/Ctrl+Shift+V en undo, en open daarna een derde venster. Controleer ook een extern gekopieerde afbeelding na het wisselen naar een andere app. Native installer- en releaseprotocolcontroles blijven vereist; zonder die controles blijft de PR concept. Geen release publiceren.
