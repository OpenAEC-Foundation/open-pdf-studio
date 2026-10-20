# open-pdf-kernel

De Rust-kernel van Open PDF Studio: fase 1 van de Rust-migratie (zie [`docs/rust-migratie-plan.md`](../docs/rust-migratie-plan.md) en issue #625).

De crate is een pure Rust-bibliotheek zonder Tauri-afhankelijkheid. De app praat er via dunne commands mee; een latere native UI roept haar direct aan.

## Modules

| Module | Inhoud |
|---|---|
| `model` | Annotatiemodel: verliesvrije spiegel van het JS-object (`js/types/annotation.ts`). Het ruwe JSON-object is de bron en gaat ongewijzigd terug; getypeerde leesfuncties (`f64`, `str`, `points`, …) geven `None` bij een ontbrekende, `null` of verkeerd getypeerde waarde. |
| `dl` | Display list: één tekentaal (paden, lijnstijl, groepen met dekking, blend en clip) voor scherm en PDF. |
| `raster` | Display list → rechte RGBA-bitmap via `vello_cpu`, dezelfde rasterizer die Hayro gebruikt. |
| `pdfrender` | Paginarendering met Hayro (pure Rust), met dezelfde conventies als de PDFium-route: opaak wit, `ceil`-afmetingen, regio in weergave-punten, extra rotatie per kwartslag. Annotaties tekent de app zelf. |

## Testen

```bash
cargo test -p open-pdf-kernel
```

Op Windows bouw je buiten de OneDrive-map, bijvoorbeeld met `CARGO_TARGET_DIR=C:\opds-cargo-target-kernel`.

## Golden-bitmaps bijwerken

`tests/golden.rs` vergelijkt renders met de PNG's in `tests/golden/`. Per kanaal mag een pixel maximaal 3 afwijken; die marge vangt verschillen in SIMD-niveau tussen machines op. Bij een afwijking komt de werkelijke render in `<target>/golden-diff/`.

Na een bedoelde wijziging in de rendering:

```bash
OPDS_UPDATE_GOLDEN=1 cargo test -p open-pdf-kernel --test golden
```

Bekijk de nieuwe PNG's vóór het committen.
