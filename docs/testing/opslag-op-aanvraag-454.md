# PDF-opslag laden bij de eerste opdracht (#454)

Vier directe imports vanuit tabsluiting, sneltoetsen, het bestandsmenu en de
mobiele interface trokken `pdf/saver.js` bij het opstarten binnen. Deze
opdrachten gebruiken nu `pdf/save-commands.js`: de opslagmodule laadt pas
bij Opslaan of Opslaan als. De opslagimplementatie en de PDF-uitvoer zijn
niet gewijzigd.

De dunne tussenlaag legt het document vast vóór de asynchrone import.
Wisselt de gebruiker tijdens het laden van tab, dan blijft de opdracht
bij de oorspronkelijke PDF. Expliciete documenten, uitvoerpaden en
annuleringsopties gaan ongewijzigd door. Resultaten en fouten blijven
onderdeel van de teruggegeven promise.

## Bewijs

De desktopmeting met `node scripts/meet-bundel.mjs` op upstream `2cabd87ed`
is 4248,0 KiB voor de opstartchunk. Met alleen de importwijziging is dat
4099,6 KiB: 148,3 KiB minder. De bestaande limieten van 4230 KiB en 1386 KiB
gzip blijven ongewijzigd. De opslagmodule wordt een afzonderlijke chunk;
de winst betreft de eerste lading, niet het totaal van alle functies.

- `js/pdf/save-commands.test.mjs`: de eerste Opslaan- en Opslaan-als-opdracht
  behouden hun document bij een tabwissel; paden, opties, resultaten en
  fouten worden doorgegeven, ook na een mislukte poging.
- `scripts/test-lazy-save-browser.mjs`: de echte app en PDF-lader in Chromium.
  Opstarten en openen laden de opslagmodule niet. De test houdt de eerste
  moduleaanvraag na Ctrl+S tegen, wisselt naar de tweede PDF en laat de
  aanvraag doorgaan. Alleen de eerste PDF wordt geschreven; de tweede
  blijft actief en gewijzigd. De geschreven bytes openen als twee pagina's.
  Alleen native bestands-I/O is nagebootst.
- Bestaande annotatierondgangen en de klassieke-xref-browserproef blijven
  de echte opslagcode en heropening controleren.
- CI bouwt de frontend vóór de bundelgroottetest, zodat die test niet wegens
  ontbrekende `dist/` wordt overgeslagen, en draait de nieuwe browserproef.

Dit sluit de brede opsplitsings- en onderhoudsopgave van #454 niet af.
Een native installerproef en het volledige release-testprotocol blijven
vereist vóór een release; de browserproef vervangt die niet.
