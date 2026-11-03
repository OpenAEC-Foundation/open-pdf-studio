# Verticale OCR voor paginalabels (#954)

De naambouwer las een volledige scan in één richting. Een geselecteerd
verticaal titelblok kon daardoor leeg blijven of losse verkeerde tekens
opleveren. Alleen de woorden achteraf op positie filteren herstelt dat niet.

Bij een leeg tekstvak in de PDF-tekstlaag stuurt de desktop-naambouwer nu het
selectievak naar `ocr_pdf_page` als optionele `labelRegion`. De OCR-module
knipt het gebied uit dezelfde 300-dpi-paginarendering en probeert 0°, 90°,
270° en 180° binnen één Tesseract-instantie, zonder OSD. Een kleine witte rand
helpt bij strak geselecteerde tekst. De kandidaat met de hoogste gewogen
herkenningszekerheid wordt gebruikt; bij gelijke scores blijft de eerste
kandidaat behouden. Zijn alle scores laag, dan blijft de ongedraaide uitkomst
beschikbaar.

De woorden blijven in Tesseracts leesvolgorde; hun rechthoeken gaan terug naar
de oorspronkelijke paginaruimte. De naambouwer sorteert ze niet nogmaals op
paginahoogte, want dat zou tekst van beneden naar boven omkeren. De extra
app-rotatie wordt vooraf uit het selectievak gehaald. De cache is gebonden
aan de PDF-instantie, het bestandspad, de pagina en het gebied. Mislukte
verzoeken worden opnieuw geprobeerd; resultaten van een inmiddels herladen
document worden genegeerd. `doc.ocrResults` en de op te slaan OCR-tekstlaag
worden niet gewijzigd. Aanroepen zonder `labelRegion` houden het bestaande
OCR-pad.

## Regressies

- `js/pdf/pagina-labels-ocr.test.mjs`: vier app-rotaties, leesvolgorde,
  gebiedsargumenten, cache/invalidation, foutafhandeling en web-terugval.
- `src-tauri/src/ocr/label_region.rs`: begrenzen/valideren van het gebied en
  terugrekenen van woordvakken voor alle draairichtingen en schaalfactoren.
- De expliciete OCR-test gebruikt de echte, vastgepinde Tesseract-library en
  de meegeleverde taaldata. De oude herkenning produceert verkeerde tekens;
  de nieuwe leest `GRADING PLAN GENERAL NOTES` bij alle vier rotaties, zowel
  met `eng` als met de standaard `chi_tra+eng`. Ook een leeg gebied blijft leeg.
  De synthetische PNG is lokaal gemaakt met DejaVu Sans, 58 px, zwarte tekst
  op wit (1250 × 100); hij bevat geen gebruikersdocument of externe bijlage.

```sh
node --test js/pdf/pagina-labels-ocr.test.mjs
OPDS_TESSDATA_DIR="$PWD/src-tauri/resources/tessdata" \
  cargo test -p open-pdf-studio ocr::label_region -- --include-ignored --nocapture
```

De expliciete OCR-test is standaard genegeerd omdat een kale Rust-checkout
geen taaldata bevat. De lokale kwalificatie gebruikt dezelfde productiemodule
in een klein Rust-testharnas; de PDF-renderer wordt daar niet aangeroepen.
De volledige app wordt afzonderlijk met `cargo check` gecontroleerd.

## Grenzen

Dit ondersteunt kwartslag gedraaide tekst, niet willekeurig scheve scans of
handgeschreven tekst. Automatische richtingskeuze blijft een OCR-heuristiek;
controleer de bestaande labelvoorvertoning vóór toepassen, zeker bij korte
ambigue codes. Per geselecteerd gebied zijn maximaal vier herkenningspasses
nodig. De volledige pagina wordt nog steeds eenmaal op 300 dpi gerenderd,
zoals bij de bestaande OCR; zeer grote tekeningen blijven geheugenintensief.
Android heeft in deze app geen Tesseract-backend. Een verpakte desktopinstaller
en de oorspronkelijke PDF uit de melding zijn niet in deze test gebruikt.
