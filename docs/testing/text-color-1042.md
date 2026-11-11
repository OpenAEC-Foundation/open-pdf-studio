# Tekstkleur en standaardstijl — #1042

## Reproductie

Op upstream `270313292338017c2f0aa99f1469a23adae829ef` toont het lint
**Opmaak** voor een tekstvak alleen vul- en randkleur. De bestaande
tekstkleuroptie in Eigenschappen verandert wel een selectie, maar ontbreekt
in de stijlvoorkeuren: nieuwe tekstvakken en bijschriften krijgen altijd
`#000000`. Twee nieuwe regressietests faalden hierop vóór de fix.

## Wijziging

Het lint krijgt een tekstkleurkiezer voor tekstvakken en bijschriften en
**Als standaardstijl instellen** voor één ontgrendeld tekstobject. Tekstkleur
blijft onafhankelijk van de randkleur. Zonder selectie wijzigt de kiezer de
standaard voor het actieve tekstgereedschap. De bestaande voorkeurenroute
bewaart de kleur per type en gebruikt die bij nieuwe objecten; ook de
bestaande standaardstijl- en Eigenschappen-acties gebruiken deze waarde.
Bestaande vertaalsleutels worden hergebruikt.

## Testbewijs

- Volledige unitsuite: 8.175 geslaagd, 7 overgeslagen, 0 mislukt.
- Gerichte voorkeuren-, gereedschap- en projectcontroles: 78 geslaagd.
- TypeScript `tsc --noEmit`: geslaagd.
- Vite-productiebuild: geslaagd.
- `node scripts/test-text-color-browser.mjs`: geslaagd in Chromium met de
  echte SolidJS-interface, op 1433 × 1000 pixels. Controleert voor beide typen
  de kleurkeuze, behoud van randkleur, undo/redo, standaardstijlknop, meerdere
  selecties, vergrendeling, gereedschapvoorkeuren en bewaren na herladen.
  Bij een rechthoek wordt de tekstkleurkiezer niet getoond. Geen page-errors.
- De browsercontrole draait ook in de Linux-CI na de bestaande Playwright-setup.

Een browserstart onder gelijktijdige zware unit/build-belasting overschreed
30 seconden; de uiteindelijke run slaagde met een expliciete opstartlimiet
van 120 seconden, nadat deze controles waren afgerond.

## Beperkingen

De browsercontrole gebruikt de webopslagadapter. Een geïnstalleerde Windows-
Tauri-app is niet handmatig getest. De verplichte installerworkflow moet nog
slagen voordat de concept-PR gereed is; fork-Actions waren bij de vorige
pushes uitgeschakeld. Er wordt geen release gepubliceerd.
