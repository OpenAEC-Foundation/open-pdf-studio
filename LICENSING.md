# Licensing

A plain-language overview of the licence of Open PDF Studio and of the
third-party components it ships with. The legal texts are authoritative:
[`LICENSE.md`](LICENSE.md) (GNU LGPL v3) and [`GPL-3.0.txt`](GPL-3.0.txt) (the
GNU GPL v3 that the LGPL builds on). This page is not legal advice.

`scripts/licenties.test.mjs` (in `open-pdf-studio/`) keeps this page honest:
it fails when a runtime npm dependency is missing from the table below or
lists a different licence than its package, when a package manifest declares
another licence than the one stated here, or when the two licence texts are
merged into one file again.

## Summary

| | |
| --- | --- |
| Licence of the application | **LGPL-3.0-or-later** |
| Licence files | `LICENSE.md` (LGPL v3), `GPL-3.0.txt` (GPL v3, referenced by the LGPL) |
| Price | free, no paid edition, no licence key |
| Telemetry | none in the desktop app, see [`PRIVACY.md`](PRIVACY.md) |
| Watermarks | none; saving never adds a mark of the app to your pages |

What the LGPL means in practice:

- You may use Open PDF Studio for any purpose, commercial work included, on
  as many machines as you like.
- You may copy and redistribute it, modified or not. When you distribute it,
  you pass on the same rights: the licence texts and the corresponding source
  code of Open PDF Studio go with it.
- Changes to Open PDF Studio itself that you distribute are licensed under
  the LGPL as well.
- Other software may use the libraries of this repository without becoming
  LGPL itself, as long as users can replace the LGPL part (the "Lesser" in
  the name).
- There is no warranty.

## Licences per component of this repository

| Component | Licence |
| --- | --- |
| Application (`open-pdf-studio/`, frontend and `src-tauri`) | LGPL-3.0-or-later |
| `pdfium-worker`, `open-pdf-thumbnails`, `open-pdf-cad`, `open-pdf-cmyk`, `open-pdf-signatures` | LGPL-3.0-or-later |
| `open-pdf-render`, `open-pdf-security` | MIT |
| Python client (`python/`), MCP bundle (`mcpb/`) | LGPL-3.0-or-later |
| Flatpak, Snap and AUR packaging | LGPL-3.0-or-later |

## Third-party components shipped with the app

### JavaScript (runtime dependencies of `open-pdf-studio/package.json`)

| Package | Licence | Used for |
| --- | --- | --- |
| `pdfjs-dist` | Apache-2.0 | page rendering fallback, text layer, annotation reading |
| `pdf-lib` | MIT | reading and writing PDF structure on save |
| `@pdf-lib/fontkit` | MIT | embedding fonts in written text |
| `mupdf` | AGPL-3.0-or-later | decoding JPEG, JPEG 2000, JBIG2 and CCITT images when redacting them; see [the AGPL question](#the-agpl-question-mupdf) |
| `solid-js` | MIT | user interface |
| `three` | MIT | live view of 3D models embedded in a PDF |
| `i18next` | MIT | translations |
| `i18next-browser-languagedetector` | MIT | choosing the interface language |
| `@tauri-apps/api` | Apache-2.0 OR MIT | desktop shell interface |
| `@tauri-apps/plugin-dialog` | MIT OR Apache-2.0 | file dialogs |
| `@tauri-apps/plugin-fs` | MIT OR Apache-2.0 | file access |
| `@tauri-apps/plugin-os` | MIT OR Apache-2.0 | platform detection |
| `@tauri-apps/plugin-process` | MIT OR Apache-2.0 | process control of the desktop shell |
| `@tauri-apps/plugin-shell` | MIT OR Apache-2.0 | opening links in the browser |
| `@tauri-apps/plugin-updater` | MIT OR Apache-2.0 | update check on request |
| `@crabnebula/tauri-plugin-drag` | MIT OR Apache-2.0 | dragging tabs out of the window |

### Native libraries and data

| Component | Licence | Notes |
| --- | --- | --- |
| PDFium | BSD-3-Clause (parts Apache-2.0) | main renderer, shipped as a shared library next to `pdfium-worker` |
| Tesseract OCR and Leptonica | Apache-2.0, BSD-2-Clause | compiled from source and linked statically for OCR |
| Tesseract language data (`tessdata_fast`) | Apache-2.0 | `resources/tessdata` |
| Little CMS (`lcms2`) | MIT | CMYK conversion for PDF/X export, linked statically |
| libjpeg-turbo (`turbojpeg`) | BSD-3-Clause, IJG, Zlib | JPEG decoding |
| `acadrust` and the CSS parser crates | MPL-2.0 | DXF/DWG export; MPL is file-level copyleft and allows combination with the LGPL |
| Noto fonts and Inter | OFL-1.1 | text in other scripts, CJK OCR text layer |
| Microsoft WebView2 loader (Windows) | Microsoft redistributable | the web view of the desktop shell |
| Tauri and its plugins | MIT OR Apache-2.0 | desktop shell |

### Rust crates

The desktop binaries (`open-pdf-studio`, `pdfium-worker`,
`open-pdf-thumbnails`) pull in about 800 crates. A census with
`cargo metadata` (normal and build dependencies, all platforms, release
2026.44.x) gives:

- about 98% permissive: MIT and/or Apache-2.0, BSD, ISC, Zlib, Unlicense,
  BSL-1.0, CC0-1.0, Unicode-3.0, CDLA-Permissive-2.0;
- 6 crates under MPL-2.0 (`acadrust`, `cssparser`, `cssparser-macros`,
  `selectors`, `dtoa-short`, `option-ext`);
- the LGPL-3.0 crates of this repository and `openaec-update` (LGPL-3.0-only,
  the OpenAEC installer integration on Windows);
- no GPL or AGPL crate.

Regenerate the census with:

```bash
cargo metadata --format-version 1 > meta.json
```

and count `packages[].license` over the crates reachable from the three
binaries.

## The AGPL question (MuPDF)

**The facts.**

- The npm package `mupdf` (MuPDF compiled to WebAssembly) is licensed
  AGPL-3.0-or-later. Its authors also sell a commercial licence.
- In the app it is loaded on demand, in one place only: when a redaction
  covers an image stored as JPEG, JPEG 2000, JBIG2 or CCITT data, MuPDF
  decodes the pixels so they can be overwritten
  (`js/pdf/redaction/images.js`). Rendering, saving and every other feature
  use PDFium, pdf.js and pdf-lib. A cleanup call in
  `js/pdf/mupdf-renderer.js` is a no-op unless the module was loaded.
- Many unit tests use MuPDF as an independent reference reader. Test code is
  not part of the distributed app.
- Because the module is part of the frontend bundle, every installer and the
  hosted web version contain AGPL code.

**What follows from that.**

- The LGPL v3 and the GPL v3 both allow combining with AGPL v3 code (GPL v3
  section 13). There is no licence conflict.
- The distributed app as a whole (the combined work) must then be passed on
  under terms that respect the AGPL. Open PDF Studio already meets the main
  duty: the complete corresponding source of every release is public in this
  repository, and the About dialog links to it.
- The AGPL adds a network clause (section 13): people who use a *modified*
  version over a network must be offered its source. That matters for the
  hosted web version: it must be built from published source, which the
  current deploy from this repository does.
- The source files of Open PDF Studio stay LGPL. Someone who reuses them
  without MuPDF is bound by the LGPL only.

**Options, for the project owner to decide.**

1. Keep MuPDF and state it: the binaries are distributed under the AGPL
   terms for the combined work, the source stays LGPL. This is the current
   state and needs no code change.
2. Replace MuPDF for image decoding with PDFium, which already ships with the
   app and can render the same images to pixels (through `pdfium-worker`). The
   binaries are then LGPL plus permissive components only. This is the
   cleanest answer for companies that do not accept AGPL software.
3. Make MuPDF an optional download, only fetched when a user redacts such an
   image for the first time.

Until a choice is made, option 1 describes the situation of every release.
