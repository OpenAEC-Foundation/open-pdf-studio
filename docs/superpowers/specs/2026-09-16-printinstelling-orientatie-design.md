# Pagina-instelling volgt het document en gaat mee naar de printer — ontwerp

Status: ontwerp, goedgekeurd.

## 1. Probleem

Gemeld: bij een liggende tekening staat de Pagina-instelling (bereikbaar vanuit
de printdialoog) op staand.

Bij onderzoek bleek:

1. `PageSetupDialog.jsx` begint altijd met hardgecodeerd `orientation:
   'portrait'` en `size: 'a4'`, ongeacht het document.
2. `getPageSetupSettings()` wordt nergens gelezen. De hele dialoog is
   decoratief: wat je instelt, bereikt de printer niet.
3. Het vinkje **Automatisch draaien** in de printdialoog wordt opgeslagen maar
   niet doorgegeven aan de printopdracht.
4. `print_pdf` (Rust) draait wél per pagina mee (`DMORIENT_LANDSCAPE` als de
   pagina breder is dan hoog). Gemeten op drie echte printerdrivers: de
   apparaatcontext klapt correct om. Dat gedrag blijft de standaard.

## 2. Oplossing

### 2.1 Standaard volgt het document

Bij het openen van de Pagina-instelling worden oriëntatie en papierformaat
afgeleid van de huidige pagina van het actieve document:

- **Oriëntatie**: breder dan hoog → liggend; anders staand (vierkant = staand).
- **Papierformaat**: de pagina (in mm, in beide oriëntaties) vergeleken met de
  lijst, met een tolerantie van 3 mm. Geen overeenkomst → **Printerstandaard**
  (nieuwe optie). Een A1- of A0-tekening krijgt dus de printerstandaard, geen
  verzonnen formaat: Windows kent daar geen standaardconstante voor.

Kiest de gebruiker zelf een andere oriëntatie of een ander formaat, dan blijft
die keuze staan zolang hij in hetzelfde document werkt. Bij een ander document,
of als er niets handmatig gewijzigd is, wordt opnieuw afgeleid — zo volgt een
document met gemengde oriëntaties de huidige pagina.

A2 komt erbij in de lijst (`DMPAPER_A2` bestaat in Windows).

### 2.2 Instelling gaat mee naar de printer

`PrintDialog.executePrint` → `runPrintJob` → `print_pdf` krijgt twee extra,
optionele argumenten:

| Argument | Waarden | Herkomst |
|---|---|---|
| `orientatie` | `auto`, `portrait`, `landscape` | Automatisch draaien aan → `auto`; uit → oriëntatie uit de Pagina-instelling, mits die voor dit document is bevestigd; anders `auto` |
| `papier` | `printer`, `a2`, `a3`, `a4`, `a5`, `letter`, `legal`, `tabloid` | Papierformaat uit een voor dit document bevestigde Pagina-instelling; anders `printer` |

Zonder argumenten gedraagt `print_pdf` zich exact als nu (achterwaarts
compatibel).

### 2.3 Rust

Nieuwe module `src-tauri/src/print_instelling.rs`, platformonafhankelijk en
puur:

- `Orientatie::uit_keuze(&str)` en `Papier::uit_keuze(&str)` — onbekende waarde
  → `Auto` resp. `Printer`.
- `orientatie_voor_pagina(keuze, breedte_px, hoogte_px) -> Liggend|Staand` —
  bij `Auto` het huidige gedrag.
- `dmpaper(papier) -> Option<i16>` — `None` bij `Printer`. Waarden uit
  `windows-sys 0.59`: A2=66, A3=8, A4=9, A5=11, Letter=1, Legal=5, Tabloid=3.
- `lp_opties(orientatie, papier) -> Vec<String>` — voor Linux en macOS.

Windows (`print_pdf`): `dmFields` wordt `DM_ORIENTATION`, plus
`DM_PAPERSIZE` als er een papierformaat is. `dmOrientation` per pagina via
`orientatie_voor_pagina`. De uitkomst van `ResetDCW` wordt gecontroleerd; bij
een fout een waarschuwing in het log, de opdracht gaat door.

Linux en macOS: `lp` krijgt `-o orientation-requested=4` (liggend) of `=3`
(staand) bij een expliciete oriëntatie, en `-o media=<formaat>` bij een
papierformaat. Bij `auto` geen oriëntatie-optie.

### 2.4 Automatisch draaien

Aangevinkt (standaard): per pagina afleiden, zoals nu — goed voor documenten
met gemengde oriëntaties. Uitgevinkt: de oriëntatie uit de Pagina-instelling
geldt voor alle pagina's, mits die Pagina-instelling voor dit document is
bevestigd; zonder bevestigde Pagina-instelling blijft het per pagina afleiden.

Wat "Automatisch draaien" precies doet: het vel volgt de getoonde pagina
(breder dan hoog = liggend), per pagina, en een in de Pagina-instelling
gekozen stand telt dan niet. Dat gebeurde stil (`printArgumenten` stuurt
`auto`). De printdialoog zegt het nu onder de kop, alleen als het voor de
getoonde pagina iets uitmaakt (`overstemdeStand`): "Automatisch draaien
overstemt de gekozen stand (Staand)." Wie de gekozen stand wil, zet het
vinkje uit.

### 2.5 Een pagina haaks op het vel: een kwartslag linksom

Met "Automatisch draaien" uit kan de pagina haaks op het vel staan (een
liggende tekening, Staand gekozen). Voorheen kwam ze dan ongedraaid op het
vel, passend op zo'n 70 % met brede witranden. Nu ligt ze een kwartslag
LINKSOM op het vel: de bovenrand van de pagina komt aan de linkerrand van
het vel, genoteerd als /Rotate-graden met de klok mee = 270
(`DRAAIING_HAAKS`, in `js/pdf/print-plaatsing.js` én in
`src-tauri/src/print_plaatsing.rs`). Het voorbeeld, de print-PDF en de
afdruk gebruiken dezelfde regel en dezelfde richting:

- JS (`berekenPlaatsing`): `gedraaid` en `draaiing`; alle rechthoeken op de
  pagina gelden voor de pagina zoals ze op het vel ligt, `ongedraaidDeel`
  rekent terug naar de getoonde pagina. Bij `auto` volgt het vel de pagina en
  wordt er nooit gedraaid; een vierkante pagina of een vierkant vel staat nooit
  haaks. Bij onbekend papier (geen vel bekend, de printer past in) draait JS
  niet: dat laat het aan het stuurprogramma en de printkern.
- Rust (`print_windows.rs`, plaatsingen `Passend` en `Vel`): staat de
  PDF-pagina haaks op het vel dat de DC meldt (het stuurprogramma nam een
  ander vel of een andere stand dan gevraagd), dan wordt het beeld een
  kwartslag linksom gerenderd of gedraaid (`draaiing_voor_vel`,
  `draai_linksom`, `deel_linksom`) zodat het het vel vult. De stand van het
  vel telt in inches (de dpi kan in x en y verschillen).

### 2.6 Doel "Opslaan als PDF"

Een afdruk naar een PDF-stuurprogramma loopt door dat stuurprogramma: de app
levert pixels, en het stuurprogramma bepaalt hoe het vel in het bestand komt
(sommige schrijven een liggend vel als staand medium met gedraaide inhoud;
hun automatische draaiing kijkt naar tekstrichting en vindt in een raster
niets). Daarom staat bovenaan de printerlijst het doel "Opslaan als PDF"
(`js/pdf/print-doel.js`, `DOEL_PDF`), vertaald in alle talen:

- Dezelfde paginakeuze, schaal en plek op het vel, velstand en -maat en
  "Document" / "Document en markeringen" als een printopdracht; geen spooler,
  geen DEVMODE, geen exemplaren (uitgegrijsd), geen Eigenschappen.
- De bronpagina's gaan als Form XObject in het bestand
  (`js/pdf/print-vector.js`, `bouwVectorPrintPdf`): tekst blijft tekst,
  lijnen blijven lijnen. Elke pagina krijgt een MediaBox in de gekozen stand
  (liggend = breder dan hoog), /Rotate 0, inhoud rechtop; de draaiing van de
  bron (/Rotate, plus de draaiing uit de app) en de kwartslag uit 2.5 zitten
  in de matrix van de vorm. Grote en verlengde vellen werken zonder
  papiercode: de maat in mm is het vel.
- Markeringen, watermerken en tekstbewerkingen komen als doorzichtige beelden
  bovenop de vectoren, alleen waar iets staat (tegelraster); een pagina zonder
  markeringen krijgt geen beeld.
- Zonder formaat uit de Pagina-instelling is het vel de pagina zelf
  (`papier: 'pagina'` in `berekenPlaatsing`), in de gekozen stand.
- Het doelbestand mag niet het geopende bestand of zijn werkkopie zijn
  (`doelIsGeopend`); het voorstel staat naast het document met een
  achtervoegsel. Na afloop een melding met het pad en een knop Openen.
- Is de bron niet te lezen (bijvoorbeeld versleuteld), dan de gerasterde
  print-PDF, en de melding zegt dat.

De printknop heet dan "Opslaan". De kop van het voorbeeld toont bij elk doel
het vel met zijn stand en de maten zoals het ligt: "A2 liggend (594 × 420
mm)" (`velTekst`). Bij een printer die naar een bestand schrijft (poort
`PORTPROMPT:`/`FILE:`/een bestandspad, of "PDF"/"XPS" als los woord in de
naam van het stuurprogramma; `isBestandsPrinter`, alleen uit wat de
printerlijst al meldt) staat erbij dat "Opslaan als PDF" de stand en de
vectoren behoudt.

## 3. Testen

- JS, puur (`js/pdf/print-pagina-instelling.js` + test): oriëntatie-afleiding
  (liggend, staand, vierkant); formaatherkenning inclusief tolerantie en beide
  oriëntaties; A1/A0 → printerstandaard; keuzeregel handmatig vs afleiden (zelfde
  document, ander document, niets gewijzigd); argumenten voor `print_pdf` met
  Automatisch draaien aan en uit.
- Rust, puur (`print_instelling.rs`, `cargo test`, draait op elk platform):
  keuzes parsen; orientatie per pagina; `dmpaper`-waarden gelijk aan de
  `windows-sys`-constanten (test vergelijkt direct met de constanten op
  Windows); `lp`-opties.
- DEVMODE-proef op echte drivers (zonder te printen), uitgebreid met
  papierformaat: `ResetDC` met `DM_PAPERSIZE` levert de verwachte
  bedrukbare afmetingen op.
- In de app: liggend verificatiebestand openen → Afdrukken → Pagina-instelling
  staat op liggend; afdrukken naar de virtuele PDF-printer en de oriëntatie
  van de uitvoer controleren.
- Haaks op het vel (2.5): JS `print-plaatsing.test.mjs` (wanneer draaien,
  welke kant, `ongedraaidDeel` heen en terug, afsnijden gedraaid); Rust
  `print_plaatsing.rs` (`haaks_op_vel`, `draaiing_voor_vel` in inches,
  `draai_linksom` op een 3 x 2-beeld, `deel_linksom`).
- "Opslaan als PDF" (2.6): `print-vector.test.mjs` bouwt print-PDF's met
  pdf-lib en leest ze terug: MediaBox in de gekozen stand zonder /Rotate,
  precies één Form XObject met tekst- en lijnoperatoren en geen afbeelding,
  matrix van de vorm bij /Rotate 90 en bij de kwartslag, plaatsingsmatrix op
  ware grootte, grote en verlengde vellen, geen wezen of andere bronpagina's
  in het bestand. `scripts/print-opslaan-als-pdf-proef.mjs` +
  `scripts/meet-print-opslaan-als-pdf.py` meten hetzelfde met een
  onafhankelijke lezer, inclusief een beeldvergelijking met de bron.
  `print-doel.test.mjs`: het doel, het doelbestand, de bestandsprinter en de
  teksten in alle 39 talen.

## 4. Buiten scope en open punten

Deze instellingen in de printdialoog worden nog steeds opgeslagen maar niet
toegepast; ze vallen buiten deze opdracht en worden apart gemeld:

- Pagina-instelling: marges en papierbron.
- Printdialoog: sorteren, afdrukken als afbeelding.

Open punten:

- Liggend vel als eigen velmaat met staande DEVMODE: een stuurprogramma dat de
  liggende stand niet overneemt zou een liggend vel kunnen krijgen als eigen
  papiermaat (breedte > hoogte) met `DMORIENT_PORTRAIT`. Niet gebouwd; de
  printkern draait in dat geval het beeld (2.5), en "Opslaan als PDF" slaat
  het stuurprogramma over.
- Terugkoppeling na het echte printen (de velmaat teruglezen zoals
  `papier_voor_opdracht` en melden als het stuurprogramma stand of papier
  niet overnam): niet zonder printer te testen, daarom niet gebouwd.
- Bij "Opslaan als PDF" wordt de laag met markeringen per pagina op 300 dpi
  getekend, ook als er niets op staat; op een A0 kost dat evenveel geheugen
  als de gerasterde printopdracht.
