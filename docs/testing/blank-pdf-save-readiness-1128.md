# Lege PDF opslaan vóór het renderen

Na de integratie van #1140 is Continuous de standaardweergave. In de
browserroute van `createBlankPDF` werden pagina's niet als annotatiegereed
gemarkeerd totdat een renderer ze had geladen. Een nieuwe annotatie kon dus
al bestaan terwijl de saver die pagina nog als niet geladen beschouwde.
De beveiliging tegen verlies of verdubbeling van annotaties brak opslaan
terecht af met de melding dat het document tijdens het opslaan gewijzigd was.
Dit blokkeerde ook de browsertest van de geïntegreerde omtrekfix #1128.

Alleen voor zelf gegenereerde lege pagina's markeert de bestaande helper nu
alle pagina's als geladen en gereed. Daar zijn aantoonbaar geen bestaande
annotaties om in te lezen. De saverbeveiliging blijft intact. Meegeleverde
templatebytes kunnen annotaties bevatten en krijgen deze markering niet.
De desktoproute via een tijdelijk bestand blijft de gewone laadroute gebruiken.

`node scripts/test-blank-pdf-save-browser.mjs` gebruikt de echte MCP-handler,
loader en saver in Chromium. De test maakt twee pagina's in zowel Continuous
als Single, voegt direct op beide pagina's een annotatie toe en controleert
het opgeslagen PDF-bestand. Een apart template met een bestaande notitie
controleert dat nog niet geladen inhoud behouden blijft. De test faalde op
ongewijzigde main bij het opslaan en draait nu ook in Linux-CI.

Ook `node scripts/test-mcp-perimeter-browser.mjs` controleert opnieuw de
omtrekwaarden en het opslaan/heropenen. Er zijn geen gebruikersdocumenten
gebruikt of gewijzigd. Dit is browserkwalificatie; er worden geen resultaten
van een geïnstalleerde Windows- of macOS-app geclaimd.

## Bestaande hosted-controles na de nieuwe standaardweergave

De CI van #1140 strandde daarnaast in de hosted-bridgeproef op een ontbrekende
bounding box en in de hosted-CSP-proef op een wachttime-out. Beide kozen nog
het verborgen Single-canvas. De bestaande helpers kiezen nu het zichtbare
PDF- of annotatiecanvas van Single of Continuous. De tests blijven de echte
standaardweergave gebruiken; de controles op inkt, tekenen, opgeslagen
annotaties, conflicten, alleen-lezen documenten en CSP blijven behouden.

Lokale kwalificatie op deze wijziging:

- Alle 8610 unittests: 8576 geslaagd, 34 overgeslagen, geen fouten.
- TypeScriptcontrole en normale productiebuild geslaagd.
- De nieuwe lege-PDF-test en de omtrekregressie geslaagd in Chromium.
- Hosted-productiebundel gebouwd met `--mode hosted --base=./`.
- Hosted-CSP-proef geslaagd onder beide strikte beleidsvarianten; bewuste
  overtredingen werden gedetecteerd, de app veroorzaakte geen overtredingen.
- Hosted-bridgeproef geslaagd, inclusief opslaan, conflictkopie, oude versies,
  alleen-lezen documenten en afwijzing van vervalste berichten.
