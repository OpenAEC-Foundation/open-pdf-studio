# PDFium + WebView2Loader for Windows ARM64

- `pdfium.dll`: PDFium prebuilt for win-arm64, from
  https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F7834
  (same chromium/7834 pin as the Linux fetch in `.github/workflows/release.yml`).
  Licence: `LICENSE` in this directory (Apache-2.0/BSD-3-Clause, see file).
- `WebView2Loader.dll`: win-arm64 native loader from the `Microsoft.Web.WebView2`
  NuGet package, version 1.0.4078.44 (`runtimes/win-arm64/native/`).

Selected at build time by the ARM64 workflow in
`.github/workflows/windows-arm64.yml`, which rewrites `bundle.resources` to
point here instead of `binaries/win-x64/`.
