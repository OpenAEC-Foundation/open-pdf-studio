# Stijlcommando's via het toetsenbord (#1082)

Onder Voorkeuren → Sneltoetsen → Bewerken staan Stijl kopiëren, Stijl plakken
en Als standaardstijl instellen. Ze hebben bewust geen standaardtoets. Een
combinatie (bijvoorbeeld Ctrl+Alt+V) of reeks (bijvoorbeeld C C) kan worden
opgeslagen in de bestaande sneltoetsvoorkeur en geëxporteerd/geïmporteerd als JSON.
Opslaan als en Plakken op dezelfde plaats behouden hun bestaande toetsen.

De commando's gaan via `bridge.ts` naar hetzelfde stijlklembord als de knoppen.
Zonder selectie laat Kopiëren het klembord intact; Plakken volgt de bestaande
route voor gereedschapsstandaarden. Als standaardstijl instellen gebruikt de
eerste geselecteerde annotatie, mits die niet vergrendeld is, en verandert het gereedschap
niet. Tijdens tekstinvoer of een modaal venster doen deze commando's niets.

Het tijdelijke stijlklembord bevat ook tekstweergave (lettertype, grootte,
kleur, vet/cursief, onder-/doorstrepen en uitlijning). Die eigenschappen gaan
alleen naar tekstdragende doelen. De opgeslagen benoemde lijnstijlpresets
houden hun bestaande formaat en eigenschappen. Tekstinhoud, geometrie,
auteur, pagina en soortspecifieke gegevens worden niet gekopieerd. Vet/cursief
werken ook door op bestaande tekst-runs zonder hun tekst te vervangen.

## Controles

Vanuit `open-pdf-studio`:

```
node --test js/tools/sneltoetsen-aanpasbaar.test.mjs
node scripts/test-style-shortcuts-browser.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

De toetsenbordtest gebruikt de echte registry, import/export en
keydown-afhandeling met gestubde UI-acties. De Chromium-proef gebruikt de echte
app, twee documenten, pagina's en geselecteerde annotaties: C C en een
modifiercombinatie, gemengde doelen, een vergrendeld doel, één undo-stap,
herhaald plakken, de standaardstijl/fabriek en tekstinvoer. De aparte CI-workflow
herhaalt beide tests. Deze browserproef kwalificeert geen OS-specifieke
WebView/installer.
