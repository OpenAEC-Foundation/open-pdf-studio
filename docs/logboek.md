# Het logboek van de Rust-kant

De app registreert bij het starten een logger (`open-pdf-studio/src-tauri/src/logboek.rs`,
via `tauri-plugin-log`). Alles wat de Rust-kant met `log::info!`, `log::warn!`
of `log::error!` meldt, komt daardoor in een logbestand terecht — ook in een
geïnstalleerde app, niet alleen in een ontwikkelbouw.

## Waar staat het?

Het bestand heet `open-pdf-studio.log` en staat in de logmap van de app:

| Platform | Map |
| --- | --- |
| Windows | `%LOCALAPPDATA%\org.openaec.openpdfstudio\logs` |
| macOS | `~/Library/Logs/org.openaec.openpdfstudio` |
| Linux | `~/.local/share/org.openaec.openpdfstudio/logs` |

Staat `OPDS_DATA_DIR` in de omgeving (testinstanties, de MCP-testopstelling en
de prestatiemeting zetten die), dan gaat het logboek naar
`%OPDS_DATA_DIR%\org.openaec.openpdfstudio\logs`. Zo schrijft een tweede
instantie nooit in het logboek van de geïnstalleerde app.

Bij het starten meldt de app zelf op de foutuitvoer waar het logboek terecht
komt (`[startup] logboek in ...`), en de eerste regel in het bestand noemt het
gekozen niveau en de map.

In een ontwikkelbouw (`npm run tauri:dev`) gaan dezelfde regels ook naar de
standaarduitvoer, zodat ze meteen in de terminal staan.

## Rotatie

Bij 2 MiB gaat het bestand op de rol; de vijf jongste bestanden blijven
bewaard (samen hooguit ~10 MiB). De oudere krijgen de datum in hun naam.

## Niveau sturen

Standaard staat het op `info`. Met de omgevingsvariabele `OPDS_LOG` is het te
verhogen of te verlagen:

```powershell
$env:OPDS_LOG = "debug"   # off | error | warn | info | debug | trace
npm run tauri:dev
```

Hoofdletters en spaties maken niet uit; een waarde die geen niveau is (of een
lege waarde) valt terug op `info`, zodat een typefout het logboek nooit
stilzet.

Code van derden (vensterbeheer, HTTP, TLS) komt er hooguit als waarschuwing
in — anders verdringen hun regels de onze. Alleen bij `OPDS_LOG=trace` komt
ook die stroom in het bestand.

## Wat er wel en niet in hoort

Paden van de gebruiker mogen: het bestand blijft lokaal en zonder pad is een
foutmelding meestal onbruikbaar. **Inhoud van documenten** (tekst, annotaties,
afbeeldingen) hoort er niet in.

Wat zich per pagina of per tegel herhaalt (de renderlus, de worker-pool) hoort
op `debug` of `trace`, of blijft op de fout-/standaarduitvoer staan; anders
levert een gewone sessie megabytes log op.

## Het aparte printlogboek

De printkern schrijft zijn regels via `print_instelling::meld` ook nog naar
`%TEMP%\opds-print.log`. Dat eigen bestand staat er alleen nog voor een lopend
printonderzoek en mag weg zodra dat klaar is: dezelfde regels staan dan al in
het logboek hierboven.
