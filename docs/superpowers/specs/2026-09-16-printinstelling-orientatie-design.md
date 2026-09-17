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

## 4. Buiten scope

Deze instellingen in de printdialoog worden nog steeds opgeslagen maar niet
toegepast; ze vallen buiten deze opdracht en worden apart gemeld:

- Pagina-instelling: marges en papierbron.
- Printdialoog: schaling, centreren, subset (oneven/even), omgekeerde volgorde,
  sorteren, inhoud (met/zonder opmerkingen), afdrukken als afbeelding.
