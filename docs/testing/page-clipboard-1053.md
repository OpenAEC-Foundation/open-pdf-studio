# Pagina's kopiëren tussen documenttabs (#1053)

Klik in document A op een paginaminiatuur. Selecteer eventueel meer pagina's
met Ctrl+klik of Shift+klik. Druk Ctrl+C, wissel naar document B, klik op de
miniatuur waarachter de kopie moet komen en druk Ctrl+V. De bron blijft gelijk;
Ctrl+Z maakt het invoegen in het doel ongedaan. Bij een meervoudige doelselectie
wordt achter de laatste geselecteerde pagina ingevoegd.

Voorheen stuurde de algemene toetsenbordhandler Ctrl+C/V uitsluitend naar
annotaties. Het contextmenu had al een paginaklembord. De miniaturen krijgen
nu focus bij een klik en onderscheppen de kopieer-/plaktoets op hun eigen
DOM-element, voordat de algemene annotatiehandler hem ontvangt. Beide acties
gebruiken de bestaande page-manager. Ook Cmd+C/V werkt op het miniaturenpaneel.
Tekstinvoer, afwijkende combinaties en uitgeschakelde standaardbindingen worden
niet overgenomen. PDF/A-/wachtwoordbeveiligde doelen blijven alleen-lezen.
Herhaalde of gelijktijdige opdrachten worden niet opgestapeld; een tabwissel
tijdens het laden van de module breekt de uitgestelde opdracht af.

## Validatie

Vanuit `open-pdf-studio`:

- `node scripts/test-thumbnail-clipboard-browser.mjs`: echte Solid-events,
  PDF.js en pdf-lib; bronpagina's 1 en 3 komen in de juiste volgorde in een
  tweede tab, bron blijft gelijk, undo werkt, paginalabels blijven bewerkbaar,
  een alleen-lezen doel wijzigt niet en pagina-acties bereiken de algemene
  annotatiesneltoetsen niet.
- Dezelfde browsertest met de twee oorspronkelijke miniatuurcomponenten
  van upstream `04a469099d9f39cc75080c8e50fb560573b66b5e` mist het paginaklembord
  na Ctrl+C en faalt. Met de gewijzigde componenten slaagt hij.
- 67 regressietests: het nieuwe toetsenbordgedrag, echte PDF-bewerkingen en
  meetschalen, bestaande aanpasbare sneltoetsen/Caps Lock, miniaturen zoeken
  en slepen. De nieuwe unit-tests staan in `scripts/unit-testlijst.txt`.
- 59 projectcontroles voor versies, native runtime, releases, Linux en beelden.
- TypeScript (`tsc --noEmit`) en productie-Vite-bouw geslaagd.

De browsertest wacht op de afgeronde paginabewerking en render voordat hij de
nieuwe PDF controleert. Het is een browserintegratietest, geen Windows-installer-
of Tauri-WebView-test. Er is geen wijziging aan Rust-code, de PDF-samenvoeglogica
of het systeemklembord. Het paginaklembord geldt voor tabs binnen dezelfde app;
uitwisseling tussen aparte appvensters en het meenemen van nog niet opgeslagen
bronannotaties worden hiermee niet toegevoegd.

Versie 2026.46.26. Een installerbuild blijft vereist vóór gereedmelding.
Chat-ID: 01a109f0-a849-7782-8641-0b091eb29747.
