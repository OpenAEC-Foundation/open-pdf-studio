# Getalvelden aanpassen door slepen

Bij #1168 konden gebruikers de lettergrootte alleen typen of met de
stapknoppen wijzigen. Getalvelden met `data-getal` ondersteunen nu ook
verticaal slepen met de linkermuisknop: omhoog verhoogt, omlaag verlaagt.
Elke zes schermpixels vormen één bestaande `step`, begrensd door `min`
en `max`. Horizontaal slepen blijft gewone tekstselectie.

Tijdens het slepen verandert alleen de getoonde waarde. Loslaten verstuurt
eenmalig de bestaande `input`- en `change`-gebeurtenissen. Daardoor krijgt
de lettergrootte één wijziging in de undo-geschiedenis. Escape,
pointerannulering, focusverlies of het verwijderen/uitschakelen van het
veld breekt het slepen af. Een inmiddels programmatisch vervangen waarde
wordt niet overschreven.

De decimaalnotatie volgt de taal; handlers blijven canonieke getallen
lezen. Uitgeschakelde en alleen-lezenvelden, ongeldige/leeg gelaten waarden
en voet-inchuitdrukkingen worden niet gesleept. Touch- en peninvoer houden
hun bestaande gedrag. Er is geen andere muiscursor toegevoegd.

## Controle

Voer vanuit `open-pdf-studio` uit:

```sh
node scripts/test-numeric-drag-browser.mjs
```

De test start een eigen Vite-server zonder hot reload en gebruikt Chromium.
Een echte tekstannotatie begint op 16 pt: 30 pixels omhoog toont 21 pt,
loslaten past 21 pt toe, één undo herstelt 16 pt en redo geeft weer 21 pt.
Op de oorspronkelijke code blijft het veld 16 en faalt deze controle.
Aanvullende dynamische velden controleren decimale stappen, Nederlandse
notatie, grenzen, annuleren, programmatische updates, uitgeschakelde en
alleen-lezenvelden, voet-inchwaarden, tekstselectie, typen, toetsen en
verwijdering. De Linux-CI voert dezelfde browsertest uit.

Deze controle bewijst het frontendgedrag in Chromium. Een geïnstalleerde
Tauri-app op Windows/macOS/Linux blijft onderdeel van de installercontrole.
