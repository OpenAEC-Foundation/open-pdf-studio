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
dezelfde PNG: passend en met een geselecteerde markering. Voor de doorlopende
weergave zegt die vergelijking niets: de schermafdruk is daar leeg. Die
weergave is bij het vervolg hieronder met een echte vensteropname vergeleken.

## Vervolg: tekenen en de tekstlaag

**Tekenen van eenvoudige vormen op het kale object.** De tekenlussen geven
lijn, pijl, rechthoek, ellips, polylijn, veelhoek, markering en inkt als kaal
object aan `drawAnnotation` (`KAAL_TEKENBAAR` in rendering.js). Van die
soorten is nagelezen dat het tekenen alleen eigen velden leest: geen
vergelijking met een ander object, geen cache die een ander vult, geen
geregistreerde tekenaar. Alle andere soorten krijgen het store-object.

**De tekstlaag bij muisbewegen.** Het selectiegereedschap zette bij elke
muisbeweging de doorval naar de tekstlaag op elke tekst-span. De laag onthoudt
nu wat er het laatst op gezet is (`js/tools/tekstlaag-doorval.js`); de lus
draait alleen als de waarde verandert, als er spans bij of af zijn, of als
een ander de spans herschreef.

Rekentijd in JS, dezelfde reeks handelingen en 3009 markeringen, drie
herhalingen na de wijziging (ms):

| handeling | hiervoor | nu |
|---|---:|---:|
| muis bewegen, hele blad in beeld | 632 | 431–528 |
| muis bewegen, ingezoomd | 878 | 445–850 (drie van de vier keer rond 450) |
| pannen, hele blad in beeld | 2080–3301 | 1508–2067 |
| slepen, hele blad in beeld | 2866–3411 | 2035–2163 |
| pannen, ingezoomd | 142–214 | 148–165 |

Controle van het beeld: 160 vormen van de acht soorten (kleuren, lijnstijlen,
dekking, draaiing, kruis, pijlpunten) op een tekening met eigen annotaties.
Passend, 300 %, 60 % en geselecteerd via `app_screenshot_view`, en de
doorlopende weergave op twee zoomstanden via een opname van het venster: vóór
en na dezelfde PNG. De vensteropname met een selectie wisselt tussen twee
varianten, ook binnen één build; bij herhaling kwam ze exact overeen.

**Onderzocht en niet gedaan: stempelbeelden.** De terugval voor stempels
rendert de pagina met pdf.js en knipt de stempels eruit (160–730 ms bij het
eerste beeld van een pagina). Alleen het stempelgebied renderen maakte het
niet sneller (385 → 467 ms, 733 → 866 ms: de tijd zit in het uitlezen van de
pagina, niet in het vullen van het canvas) en bij twee van de vijf bestanden
werd het stempelbeeld anders. Teruggedraaid.

## Wat overblijft

- **Tekenen van de overige soorten** (tekstvak, aanhaling, maten, stempels,
  bouwkundige soorten) leest nog via de store. Per soort eerst nalezen of het
  tekenen objecten op identiteit vergelijkt (`activeCropAnnotation() ===
  annotation`, groepsleden van correcties) of een cache met de markering als
  sleutel gebruikt (voorbeelden van vectorknipsels); pas dan in
  `KAAL_TEKENBAAR`.
- **Muisbewegen**: `querySelector`, `getBoundingClientRect` en
  `elementsFromPoint` zijn samen nog ~250 ms van de ~450.
- De ruimtelijke index (`spatial-index.js`) bestaat maar is niet aangesloten;
  met de kale lijst is de lineaire doorloop bij 3000 markeringen ~0,5 ms per
  muisbeweging, dus dat loont pas bij veel grotere aantallen.
- De printwachtrij wordt elke ~2 s opgevraagd (`virtual_printer_collect`,
  `virtual_printer_jobs`), ook als er niets gebeurt.
