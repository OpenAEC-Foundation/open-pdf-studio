# PDFium prebuilt binaries — Windows x64

## Provenance

- **Source:** https://github.com/bblanchon/pdfium-binaries
- **Release:** `chromium/8076`
- **Download URL:** https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8076/pdfium-win-x64.tgz
- **Date pulled:** 2026-09-30

## Files

- `pdfium.dll` — PDFium DLL, dynamically linked at runtime by `pdfium-render`.
- `LICENSE` — BSD-3-Clause license from Google's PDFium project.

## SHA-256

```
69f1e860f6742fbaafcc4db80e785eec9a4ee0da36ea6d1dc0867ea0f18baea6  pdfium.dll
```

## Hoe te updaten

1. Vind een recentere release op https://github.com/bblanchon/pdfium-binaries/releases
2. Download `pdfium-win-x64.tgz` en pak `bin/pdfium.dll` + `LICENSE` uit
3. Vervang de bestanden in deze directory
4. Update versie + datum + SHA-256 in deze README
5. Test met `cargo run --bin open-pdf-studio` dat de app nog start

## License

PDFium zelf is BSD-3-Clause (zie `LICENSE`). De Open PDF Studio app is MIT.
Beide licenses zijn compatibel; voeg de BSD-3 attributie toe aan de
"About"-dialog van de app (tijdens release-prep, niet in deze test-branch).

## Dev workflow

Voor `cargo run` / `npm run tauri:dev` moet `pdfium.dll` in
`open-pdf-studio/src-tauri/target/debug/` of `target/release/`
staan. De build-flow doet dat niet automatisch (Tauri's
`bundle.resources` werkt alleen tijdens `cargo tauri build`).

Eenvoudige workaround: kopieer de DLL handmatig na een fresh checkout:

```bash
cp open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll \
   open-pdf-studio/src-tauri/target/debug/
```

Een `build.rs` die dit automatisch doet kan in een latere refactor toegevoegd worden.
