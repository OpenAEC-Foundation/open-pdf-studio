# Schaalregio's bij maatkettingen — #1046

Op upstream `270313292338017c2f0aa99f1469a23adae829ef` reproduceerden twee
regressietests de fout: een detailwand van 200 pt op 1:10 werd als 7056 in
plaats van 706 mm gerapporteerd, en het PDF-/Measure-woordenboek kreeg de
paginaschaal wanneer de verschoven maatlijn buiten de regio lag.

De ketting kiest nu de schaal bij de geselecteerde wanden. Een gedeeld
meetpunt gebruikt bij hulplijnen de werkelijk gemeten punten, zodat de
offset de schaal niet verandert. MCP-aanmaak, interactief kettingbewerken,
herberekening, eigenschappen, geometrische wijzigingen, laden en PDF-opslag
gebruiken datzelfde meetpunt. Zonder hulplijnen blijft de bestaande
middenpuntregel gelden. Er wordt geen vaste schaal op de annotatie gezet.

## Verificatie

- 151 gerichte tests voor plattegronden, kettingbewerking en PDF-/Measure.
- De integratietest draait de echte `runAppEvent('mcp:floorplan', ...)` en
  `plattegrondInApp` met de echte schaalopzoeking, annotaties en undo-manager;
  DOM/canvas en de native brug zijn teststubs. Aanmaken, splitsen, verversen,
  globale herberekening en de PDF-schaalfactor zijn gecontroleerd.
- Een echte PDF wordt geschreven en het /Measure-woordenboek teruggelezen.
- Volledige unitsuite: 8174 geslaagd, 7 overgeslagen, geen fouten.
- TypeScript, Vite-productiebuild en 38 versie-/projectcontroles geslaagd.

Relevante opdrachten, vanuit `open-pdf-studio` met Node 24:

```
node --test js/plattegrond/*.test.mjs js/pdf/saver/dimension-measure.test.mjs js/annotations/maatketting-bewerken.test.mjs
node scripts/draai-unit-tests.mjs --test-reporter=tap
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

Geen handmatige desktoptest of installerkwalificatie. Een maat die meerdere
schaalregio's doorsnijdt houdt de bestaande middenpuntsemantiek; integratie
van verschillende schalen over één lijn is geen onderdeel van deze fix.
De verplichte installerdispatch wordt apart vastgelegd in de concept-PR.
