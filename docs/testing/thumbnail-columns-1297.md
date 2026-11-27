# Miniatuurkolommen — issue 1297

Onder de kop van het miniaturenpaneel staat een schuifregelaar zodra er meer dan één kolom past. Het maximum volgt de binnenbreedte, met minimaal 150 px per kolom. Een keuze onder het maximum blijft een bovengrens: versmallen verlaagt tijdelijk het aantal zichtbare kolommen, verbreden herstelt de keuze. De hoogste stand kiest automatisch zoveel kolommen als passen.

De voorkeur loopt via de centrale opslagmodule onder `opds:thumbnailColumns`. Automatisch is de standaard en verwijdert de opgeslagen keuze. Een geblokkeerde opslag of ongeldig getal verhindert het gebruik niet. De gebruiker ziet het label in alle 40 talen.

De renderbreedte volgt hetzelfde gekozen kolomaantal als het raster. Grotere miniaturen vragen een grotere bitmap aan; de vorige bitmap blijft zichtbaar tot de nieuwe klaar is. De bestaande bovengrens van 600 pixels blijft gehandhaafd om het geheugenverbruik bij veel pagina's te begrenzen. Op zeer brede panelen of schermen met hoge pixeldichtheid kan daarom nog opschaling voorkomen.

## Controles

- `node --test js/ui/panels/miniatuur-*.test.mjs js/core/opslag.test.mjs`: geometrie, gekozen bovengrens, automatisch verbreden, renderresolutie, bewaren/herladen, ongeldige waarden, opslagfouten en de centrale opslagafspraak.
- `node scripts/test-thumbnail-columns-browser.mjs`: echt geladen PDF-document in Chromium; van vier naar twee kolommen vergroot zowel tegel als bitmap; versmallen/vergroten, automatische stand en herladen behouden het juiste gedrag. Ctrl+A, paginazoeken, verslepen, ongedaan maken en de tegel voor een nieuwe pagina worden daadwerkelijk bediend. Deze test draait ook in Linux-CI.
- Volledige unitsuite, TypeScript, rechtstreekse Vite-productiebouw, versiecontrole en runtime/release/Android-configuratiechecks. De afzonderlijke bundelcontrole wordt na de bouw uitgevoerd; de bestaande entrylimiet wordt niet verhoogd.

## Kwalificatie

De browsercontrole kwalificeert de Tauri-webinterface met de PDF.js-route. Een geïnstalleerde Tauri-app en native PDFium-miniaturen zijn hiermee niet opnieuw gekwalificeerd. De installerworkflow op de persoonlijke fork is uitgeschakeld. De PR blijft concept zolang bundelcontrole, installerkwalificatie of vereiste upstreamreview ontbreken. Er wordt geen release gepubliceerd.

Chat-ID: `01a109f0-a849-7782-8641-0b091eb29747`.
