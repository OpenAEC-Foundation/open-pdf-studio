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
vectoren behoudt. "PDF" telt ook als het aan een woord vastzit in de naam
van het stuurprogramma (veel PDF-printers heten zo); "XPS" alleen als los
woord, want ook papieren printers hebben XPS-stuurprogramma's.

### 2.7 Liggend vel als eigen maat bij een printer die een document schrijft

Gemeld: een liggende pagina, liggend afgedrukt naar een PDF-printer op basis
van een PostScript-stuurprogramma, komt staand uit. De app vraagt het vel
goed aan (`DM_ORIENTATION` liggend en de papiercode; de DC meldt een liggend
vel) en tekent per pagina een raster. Zo'n stuurprogramma maakt van
"liggend" een staand medium met de inhoud een kwartslag gedraaid, de gewone
PostScript-werkwijze; de omzetter naar PDF neemt het medium als MediaBox
over. Zijn automatische draaiing kijkt naar de tekstrichting en valt zonder
tekst terug op de stand uit `setpagedevice` ([AutoRotatePages]); een raster
heeft geen tekst. Uitkomst: een staande MediaBox met gedraaide inhoud.

Twee routes onderzocht:

- **A. Het liggende vel als eigen maat.** `dmPaperSize` = `DMPAPER_USER`
  met `dmPaperWidth` > `dmPaperLength` (in 0,1 mm, [DEVMODEW]) en
  `dmOrientation` staand. Het PostScript-stuurprogramma van Windows zet een
  eigen maat om in de `*CustomPageSize`-code uit de PPD van de printer
  (breedte, hoogte, twee verschuivingen en de invoerrichting;
  [Driver features], met een verwijzing naar par. 5.16 van de
  PPD-specificatie 4.3). Een PPD van zo'n PDF-printer kent `*CustomPageSize`
  (tot 14400 pt, alle vier de invoerrichtingen) en zet daarmee `/PageSize`
  direct: een liggend medium, dus een MediaBox breder dan hoog, en niets om
  te draaien.
- **B. Tekst en vectoren naar de printer** (`FPDF_RenderPage` op de
  printer-DC met `FPDF_SetPrintMode`, [fpdfview.h]). Niet gekozen:
  - De automatische draaiing van de omzetter werkt alleen op tekst en zet
    alleen de weergavedraaiing (/Rotate); het medium blijft staand. Een
    tekening met tekst als lijnen, gangbaar in uitvoer van tekenpakketten,
    blijft zonder tekst staand: A blijft dan toch nodig.
  - Of die draaiing aan staat, is een instelling van de PDF-printer.
  - `pdfium-render` 0.9 bindt deze twee functies niet (ze bestaan alleen op
    Windows); de meegeleverde `pdfium.dll` exporteert ze wel, dus het kan
    via `GetProcAddress`. Maar de print-PDF is nu een JPEG per pagina
    (`bouwPrintPdf`): B vraagt ook de vectorversie (`bouwVectorPrintPdf`)
    als bron, en verandert het printpad van elke printer (transparantie via
    GDI, snelheid, grootte van de spool) zonder dat dat zonder printen te
    testen is. B blijft een mogelijke verbetering van de scherpte, niet van
    de stand.

Gekozen: **A**, alleen bij een printer die een document schrijft
(`schrijft_document` in `print_instelling.rs`, uit het stuurprogramma en de
poort van de printer):

- "pdf" in de naam van het stuurprogramma, waar dan ook; of
- de poort `PORTPROMPT:` of een pad naar een `.pdf`, `.ps`, `.eps`, `.xps`
  of `.oxps`.

Niet bij papieren printers (netwerk-, USB- of WSD-poort), ook niet met een
XPS-stuurprogramma, en niet bij `FILE:` of een `.prn`-pad (ruwe printerdata
voor een papieren printer). Een papieren printer heeft geen liggend medium
van bijvoorbeeld A3; een eigen maat zou daar om ander papier vragen. Daar
blijft `DM_ORIENTATION`, zoals altijd.

Terugval (`liggend_voor_opdracht` en `liggend_als_eigen_maat` in
`print_devmode.rs`): de maat is het vel van de staande DEVMODE van de
opdracht, nagemeten op een informatiecontext (dus ook bij papier
"printer"), een kwartslag gedraaid (`liggende_eigen_maat_tiende_mm`). Het
stuurprogramma controleert de DEVMODE, en een informatiecontext meet het vel
opnieuw (`PHYSICALWIDTH`/`PHYSICALHEIGHT`, [GetDeviceCaps]; geen opdracht).
Alleen als dat de gevraagde maat is, breder dan hoog, en de DEVMODE staand
bleef (`liggend_vel_aangenomen`), krijgen liggende pagina's deze DEVMODE;
anders de liggende stand zoals voorheen. De ingebouwde PDF-printer van
Windows negeert een eigen maat (zie de proeven in `print_windows.rs`) en
houdt dus de liggende stand; die schrijft een liggend vel al als liggende
pagina. Tussen staande en liggende pagina's wisselt `ResetDC` nu ook de maat,
op het moment waarvoor het bedoeld is: tussen pagina's [ResetDC]. Staat de
pagina toch haaks op het vel dat de DC meldt, dan draait de printkern het
beeld (2.5). Het bedrukbare gebied in de printdialoog wordt met dezelfde
DEVMODE gemeten.

Wat de app niet kan nameten: de invoerrichting die het PostScript-
stuurprogramma meegeeft. Die staat in het eigen deel van zijn DEVMODE en is
niet via de openbare velden te zetten. Bij de ene richting zet de PPD-code
een liggend medium (gewenst), bij de andere een staand medium met een
kwartslag in `/Install`: dan is de uitkomst dezelfde als voorheen, niet
slechter. De DC meldt in beide gevallen een liggend vel. Dat valt alleen met
een echte afdruk te controleren.

De printdialoog krijgt geen nieuwe keuze: de kop toont het vel al met zijn
stand, en bij een bestandsprinter blijft de hint naar "Opslaan als PDF"
staan (vectoren, en een stand die niet van het stuurprogramma afhangt). Voor
het geval een stuurprogramma toch iets onverwachts met de eigen maat doet,
is de hele regel zonder nieuwe versie terug te zetten op de liggende stand:
`OPDS_LIGGEND_VEL=0` in de omgeving (`liggend_vel_uitgezet`).

[AutoRotatePages]: https://ghostscript.readthedocs.io/en/latest/VectorDevices.html
[DEVMODEW]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-devmodew
[Driver features]: https://learn.microsoft.com/en-us/windows-hardware/drivers/print/driver-features
[fpdfview.h]: https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdfview.h
[GetDeviceCaps]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps
[ResetDC]: https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-resetdcw

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
- Liggend vel als eigen maat (2.7): Rust `print_instelling.rs`
  (`schrijft_document` voor document- en papieren printers,
  `liggende_eigen_maat_tiende_mm` voor elk bekend vel en de grenzen van een
  DEVMODE, `liggend_vel_aangenomen` voor elke manier waarop een
  stuurprogramma het vel kan weigeren). De aanroepen van Windows zelf zijn
  dun en alleen met `cargo check` geborgd; of de PDF-printer het vel liggend
  wegschrijft, blijkt alleen uit een echte afdruk.

## 4. Buiten scope en open punten

Deze instellingen in de printdialoog worden nog steeds opgeslagen maar niet
toegepast; ze vallen buiten deze opdracht en worden apart gemeld:

- Pagina-instelling: marges en papierbron.
- Printdialoog: sorteren, afdrukken als afbeelding.

Open punten:

- Liggend vel als eigen velmaat met staande DEVMODE: gebouwd voor printers
  die een document schrijven (2.7). Open: of het PostScript-stuurprogramma
  daarbij een invoerrichting meegeeft die toch weer een staand medium maakt;
  alleen met een echte afdruk naar zo'n PDF-printer te zien (MediaBox breder
  dan hoog, inhoud rechtop). Bij papieren printers blijft het ongewijzigd.
- Terugkoppeling na het echte printen (de velmaat teruglezen zoals
  `papier_voor_opdracht` en melden als het stuurprogramma stand of papier
  niet overnam): niet zonder printer te testen, daarom niet gebouwd.
- Bij "Opslaan als PDF" wordt de laag met markeringen per pagina op 300 dpi
  getekend, ook als er niets op staat; op een A0 kost dat evenveel geheugen
  als de gerasterde printopdracht.
