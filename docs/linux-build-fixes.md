# Cross-platform build fix — Linux AppImage + Windows reproduction guide

The Linux build did not produce a working AppImage on a clean Ubuntu 24.04
checkout: the build aborted, and even when forced through, the binary could not
render PDFs. Investigation found **six** distinct, stacked problems. This
document lists each with its fix, and gives **complete build instructions for
both Linux and Windows** so the work can be continued/reproduced in another
session.

> Target branch: **`restore/pre-continuous`** (version 1.67.0), which is slated
> to become `main`. The fixes here are applied on that branch. (Note: `main`
> itself is older — 1.59.0.)
>
> One of the root causes (the Tauri version mismatch, #1) affects **all
> platforms**, including Windows. On `restore/pre-continuous` it is **already
> resolved** (npm is on `~2.11`/`~2.7`/`~2.5`), but it is documented below
> because a Windows session must keep npm and the Rust crates aligned.

---

## Verified result (Linux)

- `Open PDF Studio_1.67.0_amd64.AppImage` (97 MB) builds successfully on the
  `restore/pre-continuous` branch and **runs**: the window opens (title
  *"Open PDF Studio v1.67.0"*), the UI loads, and PDF pages render (thumbnails
  visible). The original *"the AppImage doesn't work"* is resolved.
- PDFium renders a real page through the newly bundled `libpdfium.so`:
  `BARN page 1 rendered: 1693x1191 px, 1863408 non-white pixels` (smoke test ok).
- The bundled AppImage contains `usr/lib/Open PDF Studio/libpdfium.so`, and
  launches without the old startup abort (`[mcp-bridge] WebView ready`).
- Built locally with:
  `APPIMAGE_EXTRACT_AND_RUN=1 PKG_CONFIG_PATH=<rsvg-shim> npx tauri build --bundles appimage`
  (the non-zero exit at the very end is only the optional updater-signing step,
  which needs `TAURI_SIGNING_PRIVATE_KEY`; the AppImage itself is complete — CI
  sets that key).

---

## The six problems

| # | Problem | Where it fails | Scope |
|---|---------|----------------|-------|
| 1 | Tauri Rust crates (2.11.x) vs npm packages (2.10.x) on different minors → CLI aborts: *"Found version mismatched Tauri packages"* | build start | **all platforms** |
| 2 | Node.js 18; Vite 7 needs Node ≥ 20.19 → `ERR_REQUIRE_ESM` | `beforeDevCommand`/`beforeBuildCommand` | local env |
| 3 | `externalBin: ["binaries/pdfium-worker"]` has no built binary; `build.rs` only *copies* an already-built `pdfium-worker(.exe)` → *"resource path binaries/pdfium-worker-&lt;triple&gt; doesn't exist"* | `cargo build` (tauri-build) | **Windows (worker)** + Linux/macOS |
| 4 | `libpdfium.so` is never bundled on Linux (only `binaries/win-x64/pdfium.dll` is committed). Production rendering always uses in-proc PDFium, so `init_pdfium` fails and the fatal `?` aborts startup | runtime | Linux |
| 5 | `linuxdeploy` runs as an AppImage and needs FUSE → *"failed to run linuxdeploy"* | AppImage bundling | Ubuntu 24.04 |
| 6 | linuxdeploy gtk plugin can't find `librsvg-2.0.pc` → *"no 'libdir' variable for 'librsvg-2.0'"* | AppImage bundling | local env |

---

## Repo fixes (committed — apply on every platform)

### #1 Align Tauri versions  *(affects Windows too — already fixed on this branch)*
On older branches `Cargo.lock` had drifted to `tauri 2.11.2` /
`tauri-plugin-dialog 2.7.1` / `tauri-plugin-fs 2.5.1` while `package.json`
pinned the 2.10.x npm packages, so the CLI aborted with *"Found version
mismatched Tauri packages"*. **`restore/pre-continuous` already carries the
fix** — `package.json` is on `@tauri-apps/api ~2.11`, `plugin-dialog ~2.7`,
`plugin-fs ~2.5`, matching the Rust 2.11 crates.

Rule of thumb (verify on Windows too): the npm `@tauri-apps/*` minor must equal
the matching Rust `tauri*` crate minor in `Cargo.lock`. Check with
`npx tauri info`. If they ever drift, bump the npm side to match the Rust tree.

### #3 + #4 Linux bundling — `src-tauri/tauri.linux.conf.json` (new)
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "resources": { "binaries/linux-x64/libpdfium.so": "libpdfium.so" }
  }
}
```
- De Linux-configuratie erft nu `externalBin` uit de basisconfiguratie (#923).
  De spawncode gebruikt inmiddels `pdfium-worker` zonder `.exe` op Linux.
  CI, release en nightly bouwen de sidecar vóór het bundelen.
- `libpdfium.so` wordt als resource in `usr/lib/Open PDF Studio` verpakt.
  Ook de worker zoekt deze map relatief aan zijn eigen executable.
- Tauri auto-merges `tauri.<platform>.conf.json`, so this file is a **no-op on
  Windows/macOS** — their `externalBin`/`resources` from `tauri.conf.json` are
  unchanged.

`src-tauri/binaries/linux-x64/libpdfium.so` (committed, ~7.3 MB, from
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries)) —
the Linux counterpart of the existing `binaries/win-x64/pdfium.dll`.

### #4 Resilient PDFium init  *(cross-platform, harmless on Windows)*
- `src-tauri/src/lib.rs` — `init_pdfium` is **non-fatal**: if the library is
  missing the app still starts and logs an error instead of aborting at startup.
- `src-tauri/src/pdfium_renderer.rs` — `PdfiumDocumentHandle::load_from_bytes`
  guards against an uninitialised PDFium, returning an error instead of
  panicking on the first render.

---

## Building on LINUX (Ubuntu 24.04) — full steps

```bash
# 1. Node 20 (Vite 7 needs >= 20.19)   — problem #2
nvm install 20 && nvm use 20           # or any Node 20 LTS

# 2. System build deps                  — problems #5/#6
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev patchelf libfuse2t64

# 3. Build
cd open-pdf-studio
npm install
APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --bundles appimage deb
#  ^ APPIMAGE_EXTRACT_AND_RUN=1 makes linuxdeploy/appimagetool work without a
#    FUSE mount (problem #5).
```

Dev mode (no bundling, so #5/#6 don't apply):
```bash
nvm use 20
cd open-pdf-studio && npx tauri dev
```

> No-sudo alternative for #6: instead of `librsvg2-dev`, drop a minimal
> `librsvg-2.0.pc` (defining `libdir=/usr/lib/x86_64-linux-gnu`) into a dir and
> `export PKG_CONFIG_PATH=<that dir>:$PKG_CONFIG_PATH` before building — the
> runtime `librsvg-2.so.2` is already present via GTK.

Verify rendering in isolation:
```bash
OPEN_PDF_STUDIO_TEST_DLL_DIR=src-tauri/binaries/linux-x64 \
OPEN_PDF_STUDIO_TEST_PDF=/path/to/any.pdf \
cargo test -p open-pdf-studio --release --test pdfium_smoke -- --nocapture
```

---

## Building on WINDOWS — what a future session needs

The committed fixes already make Windows version-consistent (#1). The remaining
Windows-specific gotcha is the **pdfium-worker sidecar** (#3).

### Prerequisites
- **Node 20 LTS** (#2 applies on Windows too — Vite 7 needs ≥ 20.19).
- **Rust (stable, MSVC)** via rustup; the `x86_64-pc-windows-msvc` toolchain.
- **WebView2 runtime** (present on Win10/11 by default).
- VS Build Tools (MSVC linker).

### CRITICAL: build the PDFium worker first  (#3)
`externalBin: ["binaries/pdfium-worker"]` requires
`src-tauri/binaries/pdfium-worker-x86_64-pc-windows-msvc.exe` to exist *before*
`tauri build`/`tauri dev`. `src-tauri/build.rs` only **copies** the worker from
`target/<profile>/pdfium-worker.exe` — it does **not** build it, and nothing
else does (the app crate doesn't depend on the worker, and there is no
`default-members`). So a clean checkout fails with
*"resource path binaries/pdfium-worker-x86_64-pc-windows-msvc.exe doesn't exist"*
unless you pre-build the worker:

```powershell
# from repo root — build the worker so build.rs can pick it up
cargo build -p pdfium-worker            # for `tauri dev`   (debug profile)
cargo build -p pdfium-worker --release  # for `tauri build` (release profile)
```
> The profile must match: `tauri dev` uses debug, `tauri build` uses release.
> Re-run after editing the worker crate.
>
> Follow-up worth doing: make `build.rs` (or an npm `pretauri` script /
> `default-members`) build the worker automatically so this manual step
> disappears. The CI `release.yml` currently has no worker build step either —
> it should get one (`cargo build -p pdfium-worker --release`) before the Tauri
> build, or it will hit the same #3 failure.

### Build
```powershell
cd open-pdf-studio
npm install
cargo build -p pdfium-worker --release   # (see above)
npx tauri build                          # NSIS installer + updater artifacts
# dev:
cargo build -p pdfium-worker
npx tauri dev
```

### Verify rendering (Windows)
```powershell
$env:OPEN_PDF_STUDIO_TEST_DLL_DIR="src-tauri\binaries\win-x64"
$env:OPEN_PDF_STUDIO_TEST_PDF="C:\path\to\any.pdf"
cargo test -p open-pdf-studio --release --test pdfium_smoke -- --nocapture
```

### Confirm the Linux changes don't affect Windows
- `tauri.linux.conf.json` is merged **only** for Linux targets → Windows
  `externalBin` (worker) and `resources` (pdfium.dll) are untouched.
- `binaries/linux-x64/libpdfium.so` is **not** referenced by Windows config, so
  it is not bundled into the Windows installer.
- `init_pdfium` non-fatal + the render guard are platform-neutral; on Windows
  `pdfium.dll` loads normally so behaviour is unchanged.

---

## Follow-ups
- De worker wordt inmiddels in CI, release en nightly gebouwd. De pakketcontrole
  `bash scripts/linux-worker-package-check.sh pakket.deb pakket.AppImage`
  pakt beide formaten uit en start hun worker zonder GUI, FUSE of installatie.
  Een `ready`-antwoord bevestigt PDFium-initialisatie. Een ontbrekende executable,
  bibliotheek of een mislukte start laat de workflow falen. Dit vervangt geen
  render- of praktijktest op de doelcomputer.
- Some Wayland/Nvidia setups show a blank WebKitGTK window; workaround
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` — consider baking into the AppImage
  launcher if it appears.
- End users on Ubuntu 24.04 need FUSE 2 (`libfuse2t64`) to run any AppImage, or
  `./App.AppImage --appimage-extract-and-run`.
