# Open PDF Studio

A free, open-source PDF annotation editor built with Tauri 2, SolidJS, and PDF.js, featuring a comprehensive ribbon interface.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org) | ≥ 20.19.0 | v24 LTS recommended |
| [Rust](https://rustup.rs) | stable | installs via `rustup` |
| [MSVC Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2022 | Windows only — select "Desktop development with C++" |
| [CMake](https://cmake.org/download/) | any recent | required to build `turbojpeg` |

> **Windows users:** After installing Rust, open a new terminal so `~/.cargo/bin` is on your PATH. If using Git Bash, add this to `~/.bashrc`:
> ```bash
> export PATH="$HOME/.cargo/bin:$PATH"
> ```

## Installation

```bash
cd open-pdf-studio
npm install
```

## Development

```bash
npm run tauri:dev
```

The first run compiles all Rust dependencies and takes several minutes. Subsequent runs are fast thanks to incremental compilation. Hot-reload is active — frontend changes reflect immediately without recompiling Rust.

### Windows gotchas

- **Pause Dropbox** (and any other sync client) before running `tauri:dev`. Dropbox locking temp files during Rust compilation causes build failures.
- **Windows Defender** can also cause file-locking errors on the `target/` directory. Add an exclusion for `src-tauri/target/` and the `cargo.exe` / `rustc.exe` processes to avoid this.

## Building

```bash
npm run tauri:build
```

This produces a platform installer in `src-tauri/target/release/bundle/`.

## Project Structure

```
open-pdf-studio/
├── index.html              # App entry point
├── vite.config.js          # Vite configuration
├── js/                     # Frontend application
│   ├── main.js             # Entry point
│   ├── bridge.ts           # Facade: vanilla JS → SolidJS stores
│   ├── core/               # State, platform abstraction, constants
│   ├── annotations/        # Annotation rendering and handling
│   ├── pdf/                # PDF loading, rendering, saving
│   ├── solid/              # SolidJS UI components and stores
│   ├── i18n/               # Internationalization (37 languages)
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/lib.rs          # All Rust commands (file I/O, printing, etc.)
│   └── Cargo.toml          # Rust dependencies
├── package.json
└── README.md
```

## Technologies Used

- **[Tauri 2](https://v2.tauri.app)** — Desktop shell and native OS integration
- **[SolidJS](https://solidjs.com)** — Reactive UI framework
- **[Vite](https://vitejs.dev)** — Build tool and dev server
- **[PDF.js](https://mozilla.github.io/pdf.js/)** — PDF rendering engine
- **[pdf-lib](https://pdf-lib.js.org)** — PDF creation and modification
- **[i18next](https://www.i18next.com)** — Internationalization (37 languages)

## License

MIT

## Links

- **Repository**: https://github.com/OpenAEC-Foundation/OpenPDFStudio
- **Issues**: https://github.com/OpenAEC-Foundation/OpenPDFStudio/issues
