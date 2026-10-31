# Open PDF Studio in OpenAEC Linux

OpenAEC Linux is the container image of the OpenAEC SuperCloud: every user gets
their own Linux environment on the server, with the Linux builds of all OpenAEC
tools, streamed to the browser. Open PDF Studio runs there as a normal Linux
program from the release AppImage (issue #863, shared rules in
OpenAEC-Blueprint#61). The SuperCloud builds the image and pins the release;
this repository only ships the AppImage.

This page is the contract between the app and that environment. The code is in
`open-pdf-studio/src-tauri/src/openaec_omgeving.rs` (detection and decisions,
with unit tests) and `open-pdf-studio/js/core/openaec-omgeving.js` (work folder
in the dialogs). Managed mode itself has one switch for the whole app:
`src-tauri/src/beheerd.rs` and `js/core/beheerd.js` (see the README section
"Managed deployments").

## How the SuperCloud starts the app

```bash
./Open.PDF.Studio_<version>_amd64.AppImage --appimage-extract   # once, when building the image
OPENAEC_BEHEERD=1 OPENAEC_MAP=/openaec squashfs-root/AppRun [file.pdf]
```

There is no FUSE in the container, so the AppImage is always run extracted.
`AppRun` sources the GTK hook, then changes to `squashfs-root/usr` (WebKit finds
its helper processes relative to that folder) and starts the app. Do not run
the binary in `usr/bin` directly and do not change the working folder after
`AppRun` started: WebKit would no longer find `WebKitWebProcess`.

## Environment variables

| Variable | Value | Effect |
|---|---|---|
| `OPENAEC_BEHEERD` | `1` (also `true`, `yes`, `on`) | Managed mode, see below. |
| `OPENAEC_MAP` | absolute folder, e.g. `/openaec` | Open, save and folder dialogs start in this folder, unless the app passes a folder itself (for example the folder of the open document). Ignored when it is not an existing absolute folder. A relative start argument falls back to it. |
| `OPENAEC_MCP_POORT` | port, e.g. `9300` | Starts the MCP server (AI connection) on this port. Needs `OPENAEC_MCP_GEHEIM`. |
| `OPENAEC_MCP_GEHEIM` | at least 16 characters | Secret for that server: every request must send `Authorization: Bearer <secret>`. The app removes it from its environment at startup, so child processes do not inherit it. |
| `OPENAEC_MCP_ADRES` | IP address | Bind address of that server. Default `0.0.0.0` (the internal network of the container) in managed mode, otherwise `127.0.0.1`. |
| `OPENAEC_SOFTWARE_RENDERING` | `1` / `0` | Force or forbid the software-rendering settings below; without it they follow the GPU detection. |
| `OPDS_GDK_BACKEND` | e.g. `wayland`, `x11` | GDK backend to use. The AppImage GTK hook overwrites `GDK_BACKEND`; this one is applied after it. |
| `OPDS_DATA_DIR` | folder | Where preferences, session and recovery files live (default: the XDG data folder). |
| `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | folders | Honoured as usual (logs, WebKit data, caches). |
| `OWD` / `PWD` | folder | Used to resolve a relative start argument, see below. |

All decisions are printed at startup to stderr with the prefix `[openaec]`, for
example `[openaec] managed=true container=true software_rendering=true
wayland=true x11=false workdir=/openaec`. The MCP secret is never logged and
never reaches the WebView.

## Behaviour

### Runs extracted, without FUSE
The release AppImage is an AppImage type 2. `--appimage-extract` needs no FUSE;
the extracted `AppRun` sets `APPDIR` itself. The app treats an extracted AppDir
like a mounted one (`linux_runtime.rs`: the bundled GIO modules are used for
both, so a newer host GVFS module is never loaded into the older bundled GLib).

### No GPU required
At startup, before GTK, the app checks for a DRM render node
(`/dev/dri/renderD*`). Without one (or with `LIBGL_ALWAYS_SOFTWARE=1` or
`OPENAEC_SOFTWARE_RENDERING=1`) it sets:

| Variable | Why |
|---|---|
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | The DMA-BUF renderer needs GBM on a real GPU; without one the window stays blank. |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | No accelerated compositing on llvmpipe; WebKit paints in software, which costs less CPU. The PDF pages are rendered by PDFium anyway. |
| `LIBGL_ALWAYS_SOFTWARE=1` | Mesa goes straight to llvmpipe instead of probing hardware drivers. |

Each one is only set when it is not set already, so an explicit value from the
environment wins. With a GPU nothing changes.

### Wayland (labwc)
The GTK hook in the AppImage always sets `GDK_BACKEND=x11` (an old workaround
for a crash with bundled Wayland libraries; those are no longer bundled, see
#362). The app changes it to `wayland,x11` when it runs from an AppImage, a
Wayland display is present, and either there is no X display or the app runs
managed. On a desktop with X or XWayland and without `OPENAEC_BEHEERD`, x11
stays as before. `OPDS_GDK_BACKEND` overrides both.

Without any display (no `WAYLAND_DISPLAY`, `WAYLAND_SOCKET`,
`$XDG_RUNTIME_DIR/wayland-0` or `DISPLAY`) the app exits with status 2 and a
one-line message instead of a GTK panic.

### No system tray, notification daemon or keyring
* System tray: the app has none (no tray icon feature is enabled).
* Notifications: the app uses none; messages are in-app dialogs.
* Keyring: only the OpenAEC Accounts sign-in stores tokens. Without a usable
  keyring (no Secret Service, or a platform where only the keyring crate's
  in-process store exists) the tokens are kept in memory for the session and
  signing in still works; they just do not survive a restart.
* Session bus: single-instance uses D-Bus. Without a session bus every start
  runs on its own; with a bus address whose transport the D-Bus library does
  not know (e.g. `autolaunch:`) single-instance is skipped instead of panicking.

### Start file and work folder
`AppRun <path>` opens that PDF. Because `AppRun` changes the working folder to
`squashfs-root/usr`, a relative path is resolved against the folder the user
started from: `OWD` (set by the AppImage runtime when mounted), else `PWD` (the
shell's folder), else `OPENAEC_MAP`. Absolute paths are used as given. The
resolved paths are logged as `[startup] command-line files: [...]`.

Open, save and folder dialogs start in `OPENAEC_MAP`; a suggested file name
("document.pdf") is placed in that folder.

### Managed mode (`OPENAEC_BEHEERD=1`)
* The updater plugin is not registered: no update check, no update prompt, no
  download (`[openaec] managed mode: updater disabled`).
* Help > Check for updates and Home > Previous version only say that updates
  are managed centrally.
* The automatic "What's new" dialog and its release-notes fetch at startup are
  skipped, and so is the "default PDF app" bar.
* There is no telemetry, managed or not (see Network below).

### MCP server (AI connection)
With `OPENAEC_MCP_POORT` and `OPENAEC_MCP_GEHEIM` the MCP server starts at
`http://<OPENAEC_MCP_ADRES>:<port>/mcp` with the same public tool set as the
in-app setting. It accepts a request only with
`Authorization: Bearer <OPENAEC_MCP_GEHEIM>` (compared in constant time) and
refuses every request that carries an `Origin` header, so a browser page can
never drive it. Only one of the two variables, a port outside 1-65535 or a
secret shorter than 16 characters: the server does not start and the reason is
logged. The in-app setting then reports the server as running and does not
start a second one.

### Clean shutdown on SIGTERM
In a container (`/.dockerenv`, `/run/.containerenv` or a `container`
variable) or in managed mode, on `SIGTERM` (logout, `docker stop`) the app asks the frontend for an emergency
snapshot of every document with unsaved changes (the same recovery files as
after a crash, in `<data>/OpenPDFStudio/herstel/`), waits at most 5 seconds,
and exits with status 0. The next start offers to restore that work. On a
normal desktop `SIGTERM` keeps its default behaviour.

### Memory
The app may use up to about 8 GB for very large PDFs. The memory at rest (no
document open, software rendering) is measured in the release workflow and
added to the release notes.

## Host libraries

The AppImage bundles GTK, WebKitGTK and their dependencies, but not the display
stack and the C/C++ runtime. The image must provide (Debian package names):
`libc6`, `libstdc++6`, `libgcc-s1`, `zlib1g`, `libexpat1`, `libgmp10`,
`libgpg-error0`, `libcom-err2`, `libfontconfig1`, `libfreetype6`,
`libharfbuzz0b`, `libfribidi0`, `libegl1`, `libgl1`, `libgles2`, `libgbm1`,
`libdrm2`, `libgl1-mesa-dri` (llvmpipe), `libwayland-client0`,
`libwayland-cursor0`, `libwayland-egl1`, `libwayland-server0`,
`libxkbcommon0`, `libx11-6`, `libx11-xcb1`, `libxcb1`, `libxcb-render0`,
`libxcb-shm0` and at least one font (e.g. `fonts-dejavu-core`). Installing
`libgtk-3-0t64` pulls in most of these. X11 client libraries are needed even
under Wayland (they are linked, not used).

## Network

What the desktop app connects to:

| When | Destination | Purpose |
|---|---|---|
| Startup, only after a version change, not in managed mode | `api.github.com` (releases of this repository) | "What's new" release notes |
| Help > Check for updates (not in managed mode) | `github.com/.../releases/latest/download/latest.json` | Updater |
| Home > Previous version (not in managed mode) | `api.github.com` (releases) | Find the previous release |
| Help > What's new | `api.github.com` (releases) | Release notes |
| Symbol palette settings, library download | `raw.githubusercontent.com`, `api.github.com` (symbol library repository) | Online symbol library |
| Send feedback | the feedback service of the project | Feedback form |
| Open > From URL | the URL the user typed | Download a PDF |
| Sign in with OpenAEC | the configured OpenAEC Accounts issuer and API, plus a loopback callback on `127.0.0.1:53682` | Account sign-in |
| SVG stamps with linked images | the linked host | Images inside the stamp |

There is no telemetry, analytics or crash upload. Crash logs stay on disk.

## Verification

### In CI
`scripts/openaec-linux-smoke.sh` reproduces the container: Debian 13,
`labwc` on the wlroots headless backend (`WLR_BACKENDS=headless`,
`WLR_RENDERER=pixman`), no `/dev/dri`, no X server, no session bus, no keyring,
`OPENAEC_BEHEERD=1`, `OPENAEC_MAP` set. It extracts the AppImage, starts
`AppRun` twice (without a document, and with a relative file argument from a
sub folder), requires that the app survives, takes a screenshot with `grim`,
measures the memory at rest (PSS of the app and its WebKit processes) and checks
that `SIGTERM` ends the app with status 0. It runs in `ci.yml` on every pull
request and in `release.yml` before the release is published; the screenshots
are uploaded as the `openaec-linux-smoke` artifact.
`scripts/openaec-linux-smoke.test.sh` tests the script itself with a fake
AppImage.

### By hand
```bash
docker run --rm -it -v "$PWD:/w" debian:13-slim bash
apt-get update && apt-get install -y --no-install-recommends labwc grim \
  libgtk-3-0t64 libegl1 libgl1 libgles2 libgbm1 libgl1-mesa-dri fonts-dejavu-core
bash /w/open-pdf-studio/scripts/openaec-linux-smoke.sh /w/Open.PDF.Studio_*_amd64.AppImage 15 /w/smoke-out
```

What only the real SuperCloud shows: the streaming path, input through the
browser, the real `/openaec` volume and its permissions, the memory budget
shared with other tools, and the MCP gateway that sends the secret.
