# Metselwerk- en grondarceringen (#1217)

De screenshots tonen `brick-running`, `brick-stack` en `grond-blokjes`
(“Earth (blocks)”). Het andere patroon `earth` is niet hetzelfde patroon.

## Oorzaak en correctie

- Halfsteensverband gebruikte een kolomafstand van 20 en een verschuiving van
  20 bij een streepperiode van 20. Daardoor ontbraken voegen in elke tweede
  laag en versprongen de overblijvende voegen niet. Afstand en verschuiving
  zijn nu 10; de stenen blijven 20 bij 10.
- Stapelverband had onderbroken verticale voegen. Deze zijn nu doorlopend.
- Grondblokjes herhaalden slechts één van de twee rijen van een schaakpatroon.
  Een herhaling en verschuiving van 6 vult de andere rij met de tegengestelde
  oriëntatie. Elk blok bevat drie korte strepen.
- De streepfase begon op het verre beginpunt van de lijn, afhankelijk van de
  vlakdiagonaal. Canvas en PDF gebruiken bovendien verschillende marges.
  Beide routes compenseren nu de afstand tot de familie-oorsprong met een
  dash-offset. Dit geldt voor alle onderbroken lijnfamilies; bestaande
  patronen kunnen daardoor anders uitgelijnd worden. Stippen en doorlopende
  lijnen behouden hun fase. Patroon-ID's en opgeslagen instellingen blijven
  behouden.

## Controle

`hatch-bonds.test.mjs` bemonstert de daadwerkelijke streep/gat-intervallen van
canvaspaden en PDF-operatoren. De 18 gevallen controleren voegen in positieve
én negatieve rijen/kolommen, aansluiting op beide lintvoegen en grondblokjes
in elke rij, bij drie vlakmaten en schalen (60%, 100%, 180%). Alle 18 gevallen
falen op de oorspronkelijke code en slagen met de correctie.

`hatch-bonds-roundtrip.test.mjs` gebruikt de echte saver/lader en MuPDF. Bij
30 graden en 130% blijven patroon, schaal, hoek en de gerenderde pixels na
opslaan/heropenen/opnieuw opslaan gelijk (drie gevallen).

Daarnaast zijn de canvasbeelden, picker-voorbeelden en met MuPDF gerenderde
PDF's naast elkaar bekeken bij 0 en 30 graden. Dit is browser-/PDF-controle;
een geïnstalleerde native Tauri-app en installers zijn niet gekwalificeerd.
