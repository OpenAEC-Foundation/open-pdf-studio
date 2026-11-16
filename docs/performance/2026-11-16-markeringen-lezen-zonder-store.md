# Veel markeringen: lezen zonder de state-store (16-11-2026)

Aanleiding: gebruikers noemen de app traag in het gebruik. Na het
verscherpen in Rust (docs/rust-stappen.md) is zoomen vlot; wat overblijft
zit op bladen met veel markeringen.

## Meting

Release-build als onzichtbare testinstantie (eigen datamap, venster
1200 × 800 op schermfactor 1,5), een A3-tekening met 3009 markeringen
(rechthoeken, lijnen, cirkels) via `app_create_annotation`. Muisbewegingen,
pannen met de middelste knop en slepen via CDP; rekentijd uit de
JS-profiler (bemonstering om de 0,3 ms). Gesimuleerde invoer is geen echte
muis; de verhoudingen tellen, niet de absolute getallen.

Belasting van de interface-thread vóór de wijziging:

| handeling | script | beeldtempo (scherm 240 Hz) |
|---|---:|---:|
| muis bewegen | 30 % | 202 |
| pannen | 51 % | 144 |
| slepen | 38 % | 159 |

Zonder markeringen: 4–7 % en 236–240. Met 509 markeringen: 14–20 %.

## Oorzaak

In elk profiel stond dezelfde functie bovenaan: de `get` van de proxy van de
state-store, 37–40 % van de rekentijd. `doc.annotations` is een store-lijst
(`createMutable`): elk element en elke eigenschap die een lus leest gaat door
die proxy. De raakdetectie (`findAnnotationAt`, bij elke muisbeweging over
alle markeringen) en de tekenlus (bij elke hertekening over alle
markeringen) lezen alleen, buiten een reactieve berekening; de proxy levert
daar niets op. Daarbij las de raakdetectie de weergavefilters (document,
verborgen soorten, statusfilter, lagen) per markering opnieuw.

## Wijziging

- `js/annotations/kale-lijst.js`: `kaleLijst()` geeft de kale lijst onder een
  store-lijst, `kaal()` het kale object, `vanStore()` het store-object bij
  een kaal gevonden element.
- `findAnnotationAt` loopt over de kale lijst en geeft het store-object van
  de treffer terug, zodat wie het wijzigt dat reactief blijft doen. De
  weergavefilters worden één keer per doorloop gelezen
  (`pickableInViewTest`), met het kale document voor de laagregels.
- De twee tekenlussen (`redrawAnnotations`, de pagina's van de doorlopende
  weergave en de uitvoer) beslissen op de kale objecten welke markeringen op
  de pagina en in beeld staan. Getekend wordt het store-object, zoals
  voorheen: de tekencode vergelijkt op een paar plekken objecten op
  identiteit en gebruikt ze als sleutel van een cache.

## Resultaat

Rekentijd in JS over dezelfde reeks handelingen (ms):

| handeling | vóór | na |
|---|---:|---:|
| muis bewegen, hele blad in beeld | 3061 | 632 |
| muis bewegen, ingezoomd | 969 | 878 |
| pannen, ingezoomd | 887 | 214 |
| pannen, hele blad in beeld | 2249 | 2080 |
| slepen, hele blad in beeld | 3518 | 2866 |

De schermafdruk van het paginavenster (`app_screenshot_view`) is vóór en na
dezelfde PNG: passend, met een geselecteerde markering en in de doorlopende
weergave.

## Wat overblijft

- **Tekenen met alles in beeld** (pannen en slepen op het hele blad): daar
  tekent `drawAnnotation` elke markering en leest hij haar via de store; de
  proxy is nog 660–970 ms van de 2,1–2,9 s. Dat vraagt dat de tekencode met
  kale objecten overweg kan: de identiteitsvergelijkingen
  (`activeCropAnnotation() === annotation`, groepsleden van correcties) en de
  caches met de markering als sleutel (voorbeelden van vectorknipsels) moeten
  dan eerst op id of op het kale object. Niet gedaan.
- **Muisbewegen ingezoomd**: `querySelector`/`getBoundingClientRect` en een
  lus die bij elke beweging de aanwijzerstijl van de tekstlaag-spans zet,
  samen ~350 ms van de 880.
- De ruimtelijke index (`spatial-index.js`) bestaat maar is niet aangesloten;
  met de kale lijst is de lineaire doorloop bij 3000 markeringen ~0,5 ms per
  muisbeweging, dus dat loont pas bij veel grotere aantallen.
- De printwachtrij wordt elke ~2 s opgevraagd (`virtual_printer_collect`,
  `virtual_printer_jobs`), ook als er niets gebeurt.
