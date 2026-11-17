# Gereedschap bij het starten

Onder **Voorkeuren → Algemeen → Opstarten → Gereedschap bij volgende start**
kies je **Selecteren** of **Hand** (pannen). Sla de voorkeur op en start de app
opnieuw. Selecteren blijft de standaard voor nieuwe en bestaande profielen.

De keuze geldt eenmaal bij het starten, vóór documenten of de vorige sessie
worden geopend. Bij het openen van een document blijft Hand actief; een tekengereedschap
gaat zoals voorheen terug naar Selecteren. Opslaan van andere voorkeuren
wisselt het actieve gereedschap niet. Annuleren bewaart de wijziging
niet; **Standaardwaarden herstellen** en daarna opslaan kiest weer Selecteren.
Een ongeldige opgeslagen waarde valt eveneens terug op Selecteren.

De bestaande sneltoetsen en tijdelijke spatie-panfunctie blijven werken.
De voorkeur gebruikt dezelfde opslag als de overige instellingen: het
voorkeurenbestand op desktop en de browseropslag in de webversie. Als de
browseropslag niet beschikbaar is, kan de keuze een herstart niet overleven.

## Controle

- `node --test js/core/startup-tool.test.mjs`: oude/ongeldige waarden,
  opgeslagen Hand-keuze en labels in alle 40 talen.
- `node scripts/test-startup-tool-browser.mjs`: echte app in Chromium;
  eerste start, annuleren, opslaan, herladen, PDF openen, andere voorkeuren
  opslaan tijdens tekenen, standaardwaarden herstellen en ongeldige opslag.
- Het browserscenario draait ook in de Linux-CI.
