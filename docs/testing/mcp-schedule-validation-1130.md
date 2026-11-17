# Validatie vóór het plaatsen van een hoeveelhedenstaat (#1130)

`app_place_schedule` maakte of wijzigde eerst een persistente staat en controleerde
pas daarna de pagina en het resultaat van de hoeveelhedenberekening. Een verzoek
met onbekende velden gaf daardoor wel een fout, maar liet een lege staat achter.
Een ongeldige pagina kon bovendien een bestaande staat hernoemen.

De handler laadt nu eerst zijn afhankelijkheden en kiest daarna het actieve
document. Pagina, configuratietype, sjabloon en bestaande ID worden gecontroleerd
zonder de statenlijst te wijzigen. De app bouwt vervolgens een tijdelijke
hoeveelhedenstaat en zet die om naar tabeldata. Een fout of nul kolommen beëindigt
het verzoek vóór wijzigingen aan voorkeuren, annotaties of undo-historie.

Een geldig verzoek plaatst die voorbereide tabel en bewaart daarna de staat.
Deze stappen zijn synchroon: er zit geen `await` tussen documentkeuze, validatie
en plaatsing. Het gewone slepen van staten gebruikt dezelfde plaatsingsfunctie.
Storefuncties lopen via de bestaande bridge. De bronconfiguratie van de aanroeper
wordt gekopieerd; `config` vervangt de hele configuratie, zoals voorheen.

De staatdefinities blijven app-breed; de waarden komen uit het actieve document.
Dit is uitsluitend het deelprobleem van mislukte plaatsingen uit #1130. De nieuwe
verwijdertool wordt hier niet toegevoegd en het issue wordt niet gesloten.
Bestaande tabelannotaties bevatten geen bronstaat-ID; verwijderen op alleen titel
zou ook ongerelateerde tabellen kunnen raken.

## Testbewijs

```sh
node scripts/test-mcp-schedule-validation-browser.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

De browserregressie gebruikt de echte MCP-eventhandler en de SolidJS-app. Op de
oude code faalt de vergelijking van de app-state na `schedule produced no columns`.
Na de fix blijven bij elf afwijzingen de statenlijst, opgeslagen voorkeuren,
annotaties en undo-historie gelijk. Gevallen: nul kolommen, ongeldige pagina,
`null`/array/tekst/getal als config, onbekend sjabloon of ID en fouten bij hergebruik.
Twee geldige plaatsingen behouden titel, positie en ID-hergebruik; de tweede geeft
precies één nieuwe undo-stap. Een derde plaatsing via de bestaande drag-and-dropfunctie
behoudt titel, positie en één undo-stap. Linux CI draait deze browserregressie.

Verder worden de native/stdio/Python-toolbeschrijvingen gelijk gehouden. De reeds
ontbrekende `Preferences.ocrLanguage`-declaratie maakt de typecontrole mogelijk.
De bestaande zoomgrens staat als `32.0` in de JSON-catalogus om de strikte native
catalogustest te laten slagen; de numerieke betekenis verandert niet.

Beperking: dit kwalificeert geen geïnstalleerde Windows-app. De installerworkflow
op de persoonlijke fork is uitgeschakeld; de PR blijft concept zolang deze
kwalificatie en verplichte upstream beoordeling ontbreken.
