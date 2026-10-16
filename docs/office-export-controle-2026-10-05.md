# Office-export — controle op 5 oktober 2026

## Uitgangssituatie

De eerdere export- en PDF.js-wijzigingen staan inmiddels in commit `2b2b3bb6`.
Bij aanvang waren alleen de bestaande mappen `promo/`, `scripts/promo/` en de
losse Linux PDFium-worker ongetrackt. Deze zijn niet aangepast.

De eerder gegenereerde `/tmp/opds-text-current-render.png` is visueel bekeken.
De lopende tekst, opsomming, offertedata en begrotingstabel zijn leesbaar,
zonder zichtbare overlapping. Dit bevestigt de leesbaarheid van deze ene
gerenderde exportpagina, niet een volledige visuele overeenkomst met de bron
of een controle van alle pagina's. De ODT is een bewerkbare reconstructie.

## Gerepareerd

Een tekstwijziging kon binnenkomen terwijl de Office-export op de
bestandsdialoog of PDF.js-tekstextractie wachtte. De controle op nog niet
opgeslagen tekstwijzigingen vond alleen vóór de dialoog plaats. Daardoor kon
de export oude PDF-tekst bevatten terwijl het document al nieuwe tekst toonde.

`ensureSource()` controleert nu ook op nog niet ingebakken tekstwijzigingen.
De export breekt dan vóór het schrijven af en vraagt met de bestaande
vertaalde melding om eerst op te slaan. Wisselen naar een ander tabblad blijft
toegestaan; de export blijft aan het oorspronkelijke document gebonden.

De regressietests dekken voor ODT en XLSX zowel wijzigingen tijdens de dialoog
als tijdens de daadwerkelijke tekstextractie. Reeds opgeslagen wijzigingen
blijven exporteerbaar.

## Validatie en resterend werk

- Alle zeven tests in `office-document.test.mjs` slagen.
- De gerichte suites voor Office-bestanden, documentbinding, veilig opslaan en
  TIFF slagen, inclusief de bestaande controles met echte PDF-bestanden.
- TypeScript-controle en Vite-productiebuild slagen.
- De volledige JavaScript-suite slaagt: 205 testbestanden, geen fouten.
  De runner rapporteert bestanden als tests; dit is geen telling van alle
  individuele testgevallen.
- De native debugbuild met ingebouwde frontend slaagt. De bestaande
  `Shell::open`-deprecationwaarschuwing blijft aanwezig. De executable staat
  op `target/debug/open-pdf-studio` en is daadwerkelijk gestart.
- Het bijgewerkte pakket
  `target/debug/bundle/deb/Open PDF Studio_2026.39.0_amd64.deb` is succesvol
  gebundeld en met `dpkg-deb --info` gecontroleerd (206.563.302 bytes).
  Het oude pakket is bewaard als `/tmp/opds-before-office-fix-2026-10-05.deb`.
  De eerste bundelpoging mislukte omdat de testapp nog draaide; na het sluiten
  van die instantie slaagde het verpakken zonder die fout. Daarna is de
  ontwikkelapp opnieuw gestart. Het pakket is niet systeembreed geïnstalleerd.
- PDFium, vier renderworkers, WebView en MCP op poort 9323 initialiseren.
  `Tekst.pdf` opent met vijf pagina's; het live paginabeeld is visueel bekeken.
- `js/text/mcp-live.test.mjs 9323` slaagt in deze nieuwe build: `Welcome`
  wordt `Bienvenue`, de opgeslagen PDF bevat de nieuwe tekst en behoudt
  de aantallen vectorpaden en afbeeldingen. De proef gebruikt een
  lettertypefallback naar Liberation Sans. Bestanden staan onder
  `/tmp/opds-mcp-text-hdMHEL/`.
- Het live beeld van die synthetische tekstproef toont een wit vlak achter
  het gewijzigde woord op de blauwe achtergrond. Dit moet nog nader worden
  onderzocht, inclusief vergelijking met de opgeslagen PDF. De geslaagde
  inhoudstest bewijst dus niet volledig visueel opmaakbehoud.
- De echte native UI-export op 300 DPI en de volledige exportdialoog blijven
  nog te controleren. De MCP-testserver op poort 9323 was bij aanvang niet
  bereikbaar vanuit de eerste controle; na het starten is de nieuwe app
  met succesvolle MCP-aanroepen gecontroleerd.
- Geen commit, push of systeembrede installatie uitgevoerd. De brede
  ontwikkelopdracht is hiermee niet afgerond.
