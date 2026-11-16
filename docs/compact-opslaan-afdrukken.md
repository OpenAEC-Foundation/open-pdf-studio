# Compact opslaan en afdrukken (#1111)

De titelbalk toont één Opslaan-knop met een afzonderlijk pijltje. De hoofdknop blijft direct opslaan; het menu bevat de bestaande acties Opslaan als en exporteren als raster-PDF. Zonder document zijn beide knoppen uitgeschakeld. Bij een alleen-lezen hostversie blijft het menu beschikbaar voor een kopie. Een dialoog sluit het menu en blokkeert de knoppen.

Enter of Spatie opent het pijltjesmenu; pijl omhoog/omlaag opent het op het laatste/eerste item. Pijltoetsen, Home en End navigeren. Escape sluit en herstelt focus op het pijltje; een klik of focus buiten het menu sluit het ook. De bestaande sneltoetsen voor opslaan blijven behouden.

In het afdrukvenster beginnen labels, zelfstandige vinkjes en notities aan de leesrand van de groep. Het aangepaste paginabereik heeft geen extra inspringing. Keuzelijsten gebruiken hun natuurlijke inhoudsbreedte en krimpen waar nodig. Het aangepaste raster toont afzonderlijk gelabelde kolommen en rijen, in alle 40 talen. De bestaande grenzen van 1–10 en de afdrukberekening blijven behouden.

Controle: `node scripts/test-save-print-ui-browser.mjs` opent de echte interface met een gegenereerde PDF, controleert bediening en geometrie en gebruikt de echte knopcomponent met testcallbacks om de drie acties zonder bestandswrites te onderscheiden. De afdrukdialoog wordt rechtstreeks geopend omdat de webomgeving de normale printeropdracht niet aanbiedt. Dit vervangt geen fysieke printertest of kwalificatie van een geïnstalleerde Tauri-app.
