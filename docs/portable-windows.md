# Portable Windows version (#881)

Every release has `Open.PDF.Studio_<version>_x64_portable.zip` (plus a
`.sha256` file) next to the installers. Extract it anywhere you can write, for
example a USB drive or your Documents folder, and run `open-pdf-studio.exe`.
Nothing is installed and nothing is written to the registry by the app.

## What is in the zip

Everything sits in one folder, `Open PDF Studio\`:

| File | Purpose |
|------|---------|
| `open-pdf-studio.exe` | the program |
| `pdfium-worker.exe` | render worker (sidecar) |
| `pdfium.dll`, `WebView2Loader.dll`, `open-pdf-thumbnails.dll`, `file-icon.ico` | runtime libraries |
| `tessdata\`, `fonts\`, `kaders\`, `onderhoeken\` | OCR data, fonts, title blocks, corner templates |
| `portable.ini` | the marker that turns on portable mode |
| `README.txt` | short user guide |

This is the same layout the installer creates: on Windows the app looks for
its resources next to the exe. The resource list comes from
`tauri.conf.json` merged with `tauri.windows.conf.json`, so a new resource
lands in the zip automatically.

## Portable mode

Portable mode is on when `portable.ini` (or `.portable`) is next to
`open-pdf-studio.exe`, or when `OPDS_PORTABLE=1` is set (any platform, handy
for testing). `OPDS_PORTABLE=0` turns it off even with the marker.

When it is on, before anything else starts (`src-tauri/src/draagbaar.rs`,
called first in `main`):

- `OPDS_DATA_DIR` points to `<exe folder>\data`. Through `datamap.rs` this
  holds preferences, the session, symbol catalogs, extensions, recovery
  snapshots and crash logs (`data\OpenPDFStudio\`), and the log and caches
  (`data\org.openaec.openpdfstudio\`).
- `WEBVIEW2_USER_DATA_FOLDER` points to `data\webview2`: the WebView2 profile
  (localStorage, IndexedDB, HTTP cache). WebView2 lets this variable win over
  the folder Tauri passes in.
- Variables you set yourself are left alone (for example your own
  `OPDS_DATA_DIR`).
- The single-instance key gets a name per folder. Without that, starting the
  portable copy while the installed app runs would hand the PDF to the
  installed app and quit.

If the folder is not writable (a read-only share, `C:\Program Files`), the app
says so on start and stores its data in the normal per-user folders for that
session.

### WebView2 runtime

The zip does not contain the WebView2 runtime; Windows 10 and 11 include it.
Tauri's `webviewInstallMode` (including `fixedRuntime`) only affects the
installers, so the portable build handles this itself:

- If a Fixed Version runtime is extracted into `WebView2Runtime\` next to the
  exe (with `msedgewebview2.exe` directly inside), the app uses it
  (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`). We do not ship one: it is well over
  100 MB and would need its own security updates.
- Without that folder and without a system runtime, the app shows a clear
  error with the download link instead of exiting silently.

### Not available in portable mode

| Feature | Why | What the user sees |
|---------|-----|--------------------|
| Automatic update | the updater runs an installer | Help > Check for updates says a new version exists and offers the release page; Home > Previous version downloads the portable zip of that release |
| Default PDF app | not registered with Windows | Preferences > File association explains "Open with > Choose another app"; no prompt at start |
| File Explorer thumbnails | the COM registration would point into a folder that can move | explanation in Preferences; Rust refuses to enable it |
| Virtual printer | installed into Windows with administrator rights | explanation in Preferences; Rust refuses to install it |
| Start menu and desktop shortcuts | created by the installer | n/a |

### Updating and removing

Extract the new zip over the old folder: program files are replaced and
`data\` is kept. To remove, delete the folder. Windows may leave an empty
folder named after the app id under `%LOCALAPPDATA%` (Tauri creates it before
the WebView2 variable takes over); it can be deleted.

## Building the zip

```
npm run pack:portable -- --target <repo>/target/release --version v2026.45.1 [--out <dir>]
```

`--target` is the cargo output of a Windows release build (it must contain
`open-pdf-studio.exe` and `pdfium-worker.exe`); resources are taken from
`src-tauri`. The script stops and lists every missing file. Output: the zip
and `<zip>.sha256` (for `sha256sum -c`).

In CI the `windows-system` job of `.github/workflows/release.yml` runs this
after the NSIS build, signs any of our own binaries that are still unsigned,
smoke-starts the extracted exe with `--version` (which must create `data\`)
and attaches the zip and its checksum to the draft release.

Tests: `scripts/draagbare-zip.test.mjs` (file list, layout, zip format,
workflow wiring), `js/core/draagbaar.test.mjs` (front-end gating),
`js/i18n/draagbaar-i18n.test.mjs` (texts) and the Rust unit tests in
`src-tauri/src/draagbaar.rs` (detection and paths).

## Only verifiable on Windows

- WebView2 actually honouring `WEBVIEW2_USER_DATA_FOLDER` over Tauri's folder.
- The missing-runtime dialog and a Fixed Version runtime in `WebView2Runtime\`.
- Single-instance separation between installed and portable copies.
- Signatures of the binaries in the zip and the CI smoke start.
