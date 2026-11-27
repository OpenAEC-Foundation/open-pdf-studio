# Centrale live samenwerking (#1067)

Na aanmelden kan een document met een PDF nu ook als **Live samenwerking**
worden geopend. De bestaande knop voor een losse momentopname blijft bestaan.
De server-PDF verandert niet: alleen annotaties gaan door het revisieprotocol.

Een verbonden tab houdt zijn eigen sessie vast nadat het beheervenster sluit.
Bewerkers publiceren automatisch, normaal iedere twee seconden. Lezers
ontvangen wel wijzigingen, maar hun eigen lokale bewerkingen blijven lokaal.
De statusbalk opent de verbindingsstatus en eventuele conflicten. Verbreken
behoudt de lokale tab. Sluiten of opnieuw laden maakt de verbinding ongeldig.

Een lokale bewerking houdt de revisie waarop die is gemaakt. Binnenkomende
wijzigingen overschrijven geen ongestuurde bewerking. Bij een conflict kiest
het teamlid expliciet tussen zijn huidige lokale versie en de serverversie.
De serverversie is in het venster te inspecteren. Een nieuwe serverwijziging
na die keuze kan opnieuw een conflict opleveren.

Een onzekere bevestiging wordt met hetzelfde gebeurtenis-ID herhaald. Replay
kan een verloren bevestiging alsnog bevestigen. Een bewerking tijdens het
netwerkverzoek blijft behouden voor een volgende gebeurtenis. Het verwijderen
van een oorspronkelijke PDF-annotatie zonder serverrevisie maakt eerst een
basisrevisie en verwijdert die in de volgende cyclus.

Binnenkomende wijzigingen wissen de lokale undo/redo-geschiedenis, zodat een
oude undo-momentopname geen bewerkingen van collega's terugdraait. Een actieve
teken-, sleep-, resize- of tekstbewerking stelt synchronisatie uit. Verbindings-
fouten gebruiken een oplopende wachttijd van maximaal 30 seconden. Rechten- en
protocolfouten vereisen een handmatige herhaling. Niet-verzonden bewerkingen
blijven in het lokale document en kunnen via Opslaan als of XFDF worden bewaard.
Ze vormen geen duurzame offline wachtrij die na een herstart opnieuw verbindt.

## Regressiebewijs

- `js/review/central-review-live.test.mjs`: twee clients, maken/bewerken/
  verwijderen/herstellen, eerste verwijdering van een PDF-annotatie, expliciete
  conflictkeuzes, edits tijdens pull en acknowledgement, verloren bevestiging,
  offline herhaling, alleen-lezen toegang, tabsluiting, uitgestelde gebaren en
  een fout op een volgende replaypagina.
- Adaptertests: stabiele PDF-ID's, botsende lokale/server-ID's, selectie/undo,
  paginagrenzen en weigeren van verouderde documentgeneraties.
- Openingtests: overdracht aan de live tab behoudt de lease zonder dat het
  beheervenster de overgedragen tab later kan sluiten.
- `central-review-integration.test.mjs`: productieclients en live controllers
  tegen echte SQLite, inclusief conflict, verloren bevestiging en ingetrokken
  toegang. De HTTP/native transportlaag is in deze test een fixture.
- `scripts/test-central-review-live-browser.mjs`: twee echte PDF-tabbladen in
  Chromium, publicatie/replay, reactief conflictvenster, keuze via de knop,
  lokale kopie na verbreken en sessievrijgave bij tabsluiting. Het server-
  transport is hier een geheugenfixture; laden/renderen en UI zijn echt.
- Bestaande browserkwalificaties voor aanmelden/delen/rechten en voor het
  openen van een momentopname plus PDF/XFDF-export blijven van toepassing.

## Nog te kwalificeren vóór gereedmelding

Twee afzonderlijke native Tauri-apps tegen een Docker/S3-installatie, inclusief
verbindingsverlies, heraanmelden, ACL-wijziging, zware tekeningen en opslaan na
onderbreking. De native transportlaag is hier niet gewijzigd. De PR blijft
concept zolang die kwalificatie en de installerworkflow ontbreken. Nieuwe
labels zijn aanwezig in alle 40 talen; buiten Nederlands en Engels zijn de
nieuwe teksten voorlopig Engels. Dit is vervolgwerk op de al gemergede
serverbasis en momentopnamefunctie, geen volledige afronding van #1067.

### Bundelcontrole bij synchronisatie op 24 november 2026

De verse productiebouw op upstream `2cabd87ed` overschrijdt zelf het bestaande
budget van 4230 KiB: 4240,7 KiB. De gesynchroniseerde live-reviewbranch meet
4241,5 KiB. De controle blijft ongewijzigd en faalt terecht; dit is een
aanvullende blokkade voor gereedmelding, ook wanneer de compilatie slaagt.
De reviewdialoog en zijn services worden al bij het eerste gebruik geladen.

### Herkwalificatie op 27 november 2026

De eerdere bundelblokkade is opgelost na integratie van PR #1258 via upstream.
De branch volgt nu main d5b9104ba. Het importconflict in tabs.js behoudt zowel
review-opruiming als de upstream beginzoom. De volledige suite, TypeScript,
productiebouw, bundelbudget, versie- en configuratiecontroles en browserproef
met twee PDF-tabbladen slagen. De hierboven beschreven native/installer-
kwalificatie blijft nodig; er is geen release gepubliceerd.
