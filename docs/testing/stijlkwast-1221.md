# Stijlkwast voor annotaties (#1221)

Selecteer een bronannotatie en kies **Opmaak → Stijlgereedschappen → Stijlkwast**.
Dezelfde opdracht staat onder **Voorkeuren → Sneltoetsen → Bewerken**. Geef
**Stijlkwast** daar één toets of toetscombinatie, bijvoorbeeld Ctrl+Alt+P.
Er is geen standaardtoets toegewezen, overeenkomstig de bestaande opdrachten
Stijl kopiëren en Stijl plakken.

De opdracht neemt de stijl onmiddellijk over. Beweeg daarna de aanwijzer over
de doelannotaties; een tweede toets of klik is niet nodig. Iedere geraakte
annotatie wordt eenmaal per activering behandeld en krijgt een eigen stap in
Ongedaan maken. Esc, rechtsklikken of een ander gereedschap kiezen stopt de
kwast. Een andere actieve documentcontext of alleen-lezen toestand beëindigt
de toepassing vóór het volgende object wordt gewijzigd.

De bestaande stijlklembordregels blijven leidend: rand, vulling, dekking,
lijnkoppen en toepasselijke tekstopmaak. Geometrie en tekstinhoud worden niet
overgenomen. De bronstijl blijft een momentopname, ook wanneer de selectie
naar een doel verschuift. Verborgen objecten, vergrendelde lagen en vergrendelde
annotaties worden overgeslagen. Navigeren met een ingedrukte muisknop en
veegbewegingen met een vinger passen geen stijl toe. Dit is geen nieuwe
hatch-, symbool- of geometrische-lijntype-editor.

## Geautomatiseerd bewijs

Vanuit `open-pdf-studio/`:

```sh
node --test js/tools/sneltoetsen-aanpasbaar.test.mjs
node scripts/test-style-painter.mjs
node scripts/test-style-shortcuts-browser.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/bump-version.js --check v2026.48.7
```

De stijlkwasttest start een eigen Vite-server zonder HMR en een eigen headless
Chromium. Er wordt geen verbinding met een draaiende gebruikersapp gemaakt.
De echte toetsafhandeling, pointerdispatcher, selectie, hit-test, opmaakstore
én undo-manager worden gebruikt. De 12 scenario's controleren:

- Eén toegewezen sneltoets, meerdere doelen, herhaald aanwijzen zonder extra
  geschiedenis, onveranderlijke bronmomentopname, afzonderlijk undo/redo.
- Doorlopende weergave op pagina 2 terwijl pagina 1 de huidige pagina is.
- Vergrendelde en verborgen doelen, alleen-lezen worden, documentwissel.
- Esc, rechtsklikken, gereedschapswissel en lege bronselectie.
- Tekstopmaak met behoud van de doeltekst en de positie.
- Middelste muisknop en aanraking zonder toepassing.

De browsertest faalt op upstream `41ee1abd68949c446e11309ee3f98dcf6259d695`
omdat de nieuwe opdracht ontbreekt (Selecteren blijft actief). Op de wijziging
slagen alle 12 scenario's. Ook de bestaande stijl-sneltoets-browsertest slaagt.
De volledige unitsuite telt 9.048 tests: 9.006 geslaagd, 42 overgeslagen,
geen fouten. De 23 sneltoetstests, typecontrole, productiebuild en 54
runtime/release/configuratietests slagen. De labels en gebruikshint staan in
alle 40 talen. CI voert de nieuwe browsertest uit in **Style shortcuts**.

## Nog te kwalificeren

Controleer in een geïnstalleerde Tauri-app de fysieke sneltoets, de menukeuze,
muis/pen-aanwijzen, annuleren en opslaan/heropenen van een gewijzigd document.
De native installercontrole is nog niet uitgevoerd. De bestaande beperking
van GitHub Actions op de persoonlijke fork kan het maken van installers
blokkeren; de PR blijft concept totdat die controle is afgerond. Er wordt geen
release gepubliceerd.
