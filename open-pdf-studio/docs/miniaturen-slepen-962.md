# Pagina's verslepen via miniaturen (#962)

De miniaturenlijst gebruikte HTML5-slepen. Native bestandsdrops in een Tauri
WebView kunnen die interne sleepactie overnemen. De pagina-organizer en
bladwijzers gebruiken daarom al pointergebaren; de miniaturen volgen nu dezelfde
aanpak via de bestaande gebaarcontroller.

Een drag verplaatst de geselecteerde groep, of alleen de ongeselecteerde pagina
waar de drag begint. De doelmarkering gebruikt boven/onder in een kolom en
links/rechts in een raster. Langs de rand blijft de lijst scrollen. Escape,
verlies van focus, annuleren en loslaten buiten de lijst voeren niets uit.
Een documentwissel, PDF-herlading of alleen-lezenstatus maakt de drag ongeldig.
Gewone klikken, labelbewerking en aanraken om te scrollen blijven beschikbaar.

## Controle

```sh
node --test js/ui/panels/thumbnail-pointer-drag.test.mjs
node scripts/thumbnail-drag-e2e.mjs http://127.0.0.1:32862
```

De browsertest start een eigen Chromium-context met een gegenereerde PDF. Hij
blokkeert HTML5-dragstart om de native conflictroute te modelleren. Op de
ongewijzigde basis blijft de eerste herschikking uit. Met de wijziging worden
één pagina en een selectie herschikt; de test leest de werkelijke PDF-tekst per
pagina en controleert ongedaan maken, annuleren, selectie en labelbewerking.
Er worden nul HTML5-drags gestart. De unittests dekken daarnaast het raster,
scrollen, opruimen, aanraakbediening en document-/rechtenwijzigingen.

Dit model is geen native reproductie op macOS Sequoia. Een verpakte macOS-app
en de oorspronkelijke gebruikersomgeving moeten nog worden gekwalificeerd.
