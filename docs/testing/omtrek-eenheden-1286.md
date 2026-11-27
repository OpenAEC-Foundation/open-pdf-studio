# Eenheid van een omtrekmeting (#1286)

## Probleem en wijziging

Bij een bestaande omtrekmeting overschreef de herberekening in Eigenschappen de gekozen eenheid met de documentschaal. Hoekpunt- en MCP-bewerkingen negeerden eveneens de eigen schaal. De PDF-lader las een geërfde eenheid niet terug in het model, waardoor het eenheidsveld leeg werd.

Een omtrek kan nu dezelfde eigen lengteschaal gebruiken als een meetvlak. De eenheidskeuze rekent die schaal om: 2500 mm wordt 2,50 m, zonder de fysieke lengte te veranderen. Eigenschappen, geometriebewerkingen en MCP gebruiken die schaal. Het bestaande standaard-PDF-woordenboek `/Measure` bewaart haar. De lader vult eenheid, waarde en puntlengte terug in; een geërfde schaal blijft geërfd.

De voorkeur voor het omtrekgereedschap geldt bij het ontbreken van een documentschaal. Een gekalibreerd document blijft zijn kalibratie gebruiken bij het tekenen, zoals vastgelegd door #554. De expliciete eenheidskeuze in Eigenschappen kan die meting vervolgens in een andere eenheid tonen. Het bewust opnieuw kalibreren van alle metingen blijft eigen schalen terugzetten, zoals bij maatlijnen en meetvlakken.

## Regressies

`js/pdf/perimeter-eenheid.test.mjs` gebruikt de echte properties-store, maker, geometrieherberekening, PDF-saver en PDF-lader:

- mm → m → cm, behoud van lengte en terugvallen op de documentschaal;
- handmatige voorkeur in meters blijft behouden na geometriebewerking;
- twee rondgangen door PDF met controles op `/Measure /X /U` en `/C`;
- geërfde eenheid zichtbaar na heropenen zonder een vaste eigen schaal te maken.

Alle vier faalden vóór de wijziging. Samen met de bestaande PDF-uitwisseling en documentschaaltests slagen twintig tests.

`scripts/test-mcp-perimeter-browser.mjs` bedient daarnaast de echte eenheidskeuzelijst in Chromium en controleert ongedaan maken/opnieuw uitvoeren, geometriebewerking en heropenen via `loadPDF` met vooraf ingelezen bytes (de normale bestandroute). De bestaande MCP-tests voor open/gesloten omtrekken blijven actief. Dit script draait al in Linux CI.

## Grenzen

De bestaande getalopmaak en precisiekeuzes blijven behouden. Dit is geen algemene herziening van de meetkalibratie of voorkeuren. Installed Tauri en installers moeten nog worden gekwalificeerd; de fork kan de installerworkflow momenteel niet uitvoeren (Actions uitgeschakeld). De bestaande entry-bundelbudgetoverschrijding wordt afzonderlijk gevolgd in PR #1258. Er wordt geen release gepubliceerd.

Tijdens de browserproef bleek de aparte route voor een nieuw document uit sjabloonbytes extra PDF-eigenschappen te verliezen: `createBlankPDF` cachet onder een geheugensleutel, terwijl `getSharedPdfLibDoc` op het lege bestandspad zoekt. Dat bestaande probleem valt buiten deze Tauri-fix. De rondgangtest gebruikt daarom de normale bestandroute; de eenhedenfix claimt geen herstel van browsersjablonen.
