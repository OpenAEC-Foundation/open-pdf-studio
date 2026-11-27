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

De desktopmeting met `node scripts/meet-bundel.mjs` op upstream `b2e0e51ca`
is 4248,1 KiB voor de opstartchunk. Met alleen de importwijziging is dat
4099,7 KiB: 148,3 KiB minder. De bestaande limieten van 4230 KiB en 1386 KiB
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
  Tauri-aanroepen zijn nagebootst; de browserlader, interface en saver zijn echt.
- Bestaande annotatierondgangen en de klassieke-xref-browserproef blijven
  de echte opslagcode en heropening controleren.
- CI bouwt de frontend vóór de bundelgroottetest, zodat die test niet wegens
  ontbrekende `dist/` wordt overgeslagen, en draait de nieuwe browserproef.

Dit sluit de brede opsplitsings- en onderhoudsopgave van #454 niet af.
Een native installerproef en het volledige release-testprotocol blijven
vereist vóór een release; de browserproef vervangt die niet.

## Open controlepunt

De eerste Linux-CI-run liep vast op de onderschepping van de opslagmodule.
Een aanvraag met Vite-queryparameters reproduceert die timeout: de oude
URL-glob onderschepte die niet. De proef gebruikt nu dezelfde padnaamcontrole
als de aanvraagregistratie, geeft de actieve tab focus en controleert vóór de
tabwissel dat nog niets geschreven is. CI draait zowel gewone module-URL's
als `--vite-query`. Bij een timeout meldt de proef aanvragen, toetsafhandeling,
focus, schrijfacties en paginafouten. De oorspronkelijke CI-log bevatte deze
gegevens niet; dezelfde hoofdoorzaak in CI is daarom nog niet bewezen.

De gehoste Opslaan-als-proef had één wisselende uitkomst: na het openen van
de opgeslagen kopie ontbrak de tweede rechthoek in de volgende opslag. Een
diagnostische uitvoering met alleen extra browserfoutlogging slaagde wel,
zonder CSP-, console- of paginafouten. De oorzaak is nog niet vastgesteld;
dit resultaat blijft een kwalificatieblokkade. De test is niet versoepeld.
