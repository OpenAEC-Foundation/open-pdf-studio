# Hoeveelheden na heropenen (#1287)

## Probleem en wijziging

Een opgeslagen meetvlak kreeg bij het heropenen wel zijn label en eventuele eigen schaal terug, maar geen `measureValue`. Bij geërfde schalen ontbrak ook `measureUnit`. Daardoor bleef de oppervlaktecel leeg; de omtrek moest terugvallen op de op dat moment beschikbare paginaschaal.

De PDF-lader berekent nu de numerieke oppervlakte uit de geometrie (inclusief gaten) en de opgeslagen `/Measure`-schaal. De schaal uit `/X` en de oppervlakte-eenheid blijven consistent. De bestaande labeltekst blijft behouden. Een geërfde schaal levert de waarde bij het laden, zonder een eigen `measureScale` te worden: latere kalibratie kan nog steeds doorwerken. Zonder opgeslagen schaal blijft de bestaande schaalopzoeking gelden.

## Regressiecontrole

`node --test js/pdf/quantities-area-reload.test.mjs` bevat vier tests met echte PDF-save/load. Alle vier falen vóór de wijziging en slagen erna:

- Eigen schaal in meters en in millimeters, inclusief gat, twee save/load-rondes en omtrekconversie naar meters.
- Geërfde schaal: waarde en eenheid zijn beschikbaar voordat de paginaschaal is geladen, zonder de schaal op de annotatie vast te zetten.
- Geïmporteerd meetvlak met `/X` in mm en `/A` in m²; numerieke waarde onafhankelijk van de labeltekst.

Samen met `meting-uitwisseling.test.mjs`, `vlak-omtrek.test.mjs` en `staat-oppervlakte-eenheid.test.mjs`: 29 tests geslaagd.

`node scripts/test-quantities-area-browser.mjs` opent de echte hoeveelhedendialoog in Chromium. Een vlak van 2 m² heeft voor en na normaal openen via `loadPDF` een oppervlakte van 2 en omtrek van 6000 mm. In het echte eenheidsveld van Hoeveelheden-eigenschappen wordt `m` ingevuld: zowel kolomkop als waarde veranderen naar meter, met omtrek 6. De test draait ook in Linux CI.

## Reikwijdte en beperkingen

Het afzonderlijke probleem dat de lengtekolom *altijd* mm zou blijven, is niet onafhankelijk gereproduceerd: de bestaande opmaakconversie werkt in de browsertest. De herstelde numerieke waarde/eenheid voorkomt wel de onjuiste terugval na heropenen. Bevestiging met het oorspronkelijke bestand van de melder blijft wenselijk. Instellingen voor hoeveelheden bewaren/exporteren (#1290) valt buiten deze wijziging.

Dit is een Tauri-frontendwijziging, getest via de echte browserapp en PDF-pijplijn. Een geïnstalleerde desktopapp en nieuwe installers zijn hiermee niet gekwalificeerd. Versie 2026.48.39 volgt de repository-instructies. Geen release publiceren.

## Projectcontroles

- Volledige unitset: 9129 geslaagd, 41 overgeslagen, één bestaande fout: de entry-bundel is 4241,1 KiB bij een budget van 4230 KiB (afzonderlijke PR #1258). Ook de expliciete budgetcontrole na de build faalt hierop; de grens is niet verhoogd.
- TypeScript, 34 runtime/release/Android-configuratietests, versieconsistentie en `git diff --check` slagen.
- Productiefrontend via `node node_modules/vite/bin/vite.js build` slaagt; dit voert de native prebuild/installer niet uit.
- Installerworkflow moet na push worden geprobeerd; de fork heeft Actions uitgeschakeld. PR blijft concept zolang kwalificatie en verplichte review ontbreken.
