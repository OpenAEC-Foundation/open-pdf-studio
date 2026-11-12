## 🇳🇱 Nederlands

### Sinds v1.47.5

**🐛 Bugfixes**

- **PDF tekst-rendering — gestripte tekst (`.HOGHU` shift)** — fonts met ontbrekende `/CIDToGIDMap` werden niet correct als Identity geïnterpreteerd, waardoor karakters door systeem-Arial werden vertaald als Unicode-codepoints. CID 46 (`K` in embedded ArialMT) → Unicode 46 = `.` → -29 shift. Fix in `open-pdf-render/src/fonts.rs`: missende `/CIDToGIDMap` → Identity per ISO 32000-1 spec, géén systeem-font fallback voor Type0/CID, en ToUnicode-CMap-fallback chain. Geverifieerd op AutoCAD/PDF X-Change PDFs.
- **Embedded Type1 fonts (UniviaPro, Calibri Light, etc.)** — werden eerder volledig genegeerd door de vector renderer, waardoor tekst onzichtbaar bleef in Word/InDesign exports. Nu geparseerd via `hayro-font` crate (eexec decryptie + charstring decoder), zodat de echte letterformen renderen i.p.v. een Arial-substitutie.
- **Linux / Ubuntu**:
  - "Open with → Open PDF Studio" werkt nu vanuit Nautilus/Files (file-association in `tauri.conf.json` toegevoegd).
  - Printers selecteren werkt op Linux + macOS via CUPS (`lpstat -p`); `cups-bsd` toegevoegd aan `.deb` dependencies.
- **Windows installer**: `WebView2Loader.dll` wordt nu gegarandeerd meegebundeld via een pre-bundle workflow-stap in CI (faalde stilletjes voor v1.47.5).

**⚡ Performance**

- **Thumbnails 108× sneller** — de processor was 3 seconden gepauzeerd bij elke `renderPage` (auto-resume timer zonder early-resume signaal). Time-to-all-thumbnails op 4-pagina vector-PDF: 2810 ms → **26 ms**. Pause-window verlaagd naar 500 ms + expliciete `resumeThumbnails()` na de actieve render.
- **Achtergrond vector-prefetch** bij doc-open — alle pagina's krijgen `extract_draw_commands` op een achtergrondworker gedraaid (concurrency 2, yieldt tussen pagina's). Thumbnails hitten daarna allemaal het JS replay-pad → tekst-only pagina's tonen tekst i.p.v. alleen page-background.

**🧹 Onderhoud**

- 394 regels dood code verwijderd: ongebruikte MuPDF WASM helpers in `renderer.js` + verweesd `tile-renderer.js` (300 regels, 0 importers).
- `renderer.js` van 1458 → 1394 regels.

---

## 🇬🇧 English

### Since v1.47.5

**🐛 Bug fixes**

- **Garbled PDF text (`.HOGHU` shift)** — fonts with missing `/CIDToGIDMap` were not interpreted as Identity per spec, causing characters to be translated through the system Arial cmap as Unicode codepoints. CID 46 (`K` in embedded ArialMT) → Unicode 46 = `.` → -29 shift. Fixed in `open-pdf-render/src/fonts.rs`: missing `/CIDToGIDMap` → Identity per ISO 32000-1, no system-font fallback for Type0/CID fonts, and a ToUnicode-CMap fallback chain. Verified on AutoCAD / PDF X-Change re-saved PDFs.
- **Embedded Type1 fonts (UniviaPro, Calibri Light, etc.)** — were silently dropped by the vector renderer, leaving text invisible in Word/InDesign exports. Now parsed via the `hayro-font` crate (eexec decryption + charstring decoder), so the original letterforms render rather than an Arial substitute.
- **Linux / Ubuntu**:
  - "Open with → Open PDF Studio" now works from Nautilus/Files (added `fileAssociations` for `application/pdf` in `tauri.conf.json`).
  - Printer selection works on Linux + macOS via CUPS (`lpstat -p`); `cups-bsd` added to `.deb` dependencies.
- **Windows installer**: `WebView2Loader.dll` is now guaranteed to ship via a pre-bundle workflow step in CI (was silently missing in v1.47.5).

**⚡ Performance**

- **Thumbnails 108× faster** — the processor was paused for 3 seconds on every `renderPage` (auto-resume timer with no early-resume signal). Time-to-all-thumbnails on a 4-page vector PDF: 2810 ms → **26 ms**. Pause window lowered to 500 ms + explicit `resumeThumbnails()` call after the active render.
- **Background vector prefetch** on document open — all pages get `extract_draw_commands` run on a background worker (concurrency 2, yields between pages). Thumbnails subsequently all hit the JS replay path → text-only pages render text instead of just the page background.

**🧹 Cleanup**

- Removed 394 lines of dead code: unused MuPDF WASM helpers in `renderer.js` + orphaned `tile-renderer.js` (300 lines, 0 importers).
- `renderer.js` shrunk from 1458 → 1394 lines.
