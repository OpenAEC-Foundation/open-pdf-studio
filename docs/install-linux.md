# Installing on Linux

Every [release](https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/latest)
has a `.deb`, an `.AppImage` and a `.snap` for x86_64 (amd64). Other
architectures are not built.

## Snap (Ubuntu App Center)

```bash
sudo snap install open-pdf-studio
```

The snap is built from the `.deb` by `.github/workflows/snap.yml` on every
release tag and published to the stable channel of the Snap Store. The Snap
Store keeps it up to date.

## Debian and Ubuntu (`.deb`)

```bash
sudo apt install ./Open.PDF.Studio_*_amd64.deb
```

The package depends on `libwebkit2gtk-4.1-0`, `libgtk-3-0` and the CUPS client
tools (`cups-bsd`, `cups-client`) for printing.

## AppImage

```bash
chmod +x Open.PDF.Studio_*_amd64.AppImage
./Open.PDF.Studio_*_amd64.AppImage
```

The AppImage and the `.deb` update themselves through the built-in updater.

Without FUSE, extract it and start `AppRun`:

```bash
./Open.PDF.Studio_*_amd64.AppImage --appimage-extract
squashfs-root/AppRun [file.pdf]
```

## Nix and NixOS (x86_64)

The repository is a Nix flake. It wraps the released AppImage with
`appimageTools.wrapType2`, so nothing is compiled and no cargo or npm hashes are
involved.

```bash
# Run once without installing
nix run github:OpenAEC-Foundation/open-pdf-studio

# Install into your user profile (adds the menu entry and icons)
nix profile install github:OpenAEC-Foundation/open-pdf-studio
```

On NixOS you can also add it to your system configuration:

```nix
# flake.nix of your system
inputs.open-pdf-studio.url = "github:OpenAEC-Foundation/open-pdf-studio";

# configuration.nix (with `inputs` passed through specialArgs)
environment.systemPackages = [ inputs.open-pdf-studio.packages.x86_64-linux.default ];
```

Notes:

- Only `x86_64-linux` is packaged, because releases ship an amd64 AppImage only.
- The flake points at a fixed release. After publishing a release, update its
  version and hash with `node open-pdf-studio/scripts/nix-flake-bijwerken.mjs`
  (it reads the AppImage checksum from the GitHub release; no download needed).

## Flatpak

A Flathub-ready manifest is in [`flatpak/`](../flatpak/), and CI builds and lints
the Flatpak, but it is not on Flathub yet. See [docs/flathub.md](flathub.md),
including its known limitations (no printer list in the Flatpak yet).

## Troubleshooting

**The window stays blank.** With some GPU drivers WebKitGTK cannot use its
DMA-BUF renderer. Start the app with:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 open-pdf-studio
```

**The app closes while zooming (realtime limits).** WebKitGTK raises some of its
internal threads to realtime priority when the session allows it (many
audio-tuned distributions give the `audio` group `rtprio 99`) and then gives them
a 200 ms CPU budget; a busy thread past that budget makes the kernel kill the
whole app without a message. The app therefore lowers its own `RLIMIT_RTPRIO` to
0 at startup, the same as starting it with `prlimit --rtprio=0`. Set
`OPDS_ALLOW_REALTIME=1` to keep the session's limit. If the window instead goes
blank while zooming (the web process crashed in the GPU renderer),
`WEBKIT_DISABLE_DMABUF_RENDERER=1` avoids it at the cost of slower rendering.
Issue [#924](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/924)
tracks the remaining crash.

**Choosing Wayland or X11.** The AppImage's GTK hook overwrites `GDK_BACKEND`.
Set `OPDS_GDK_BACKEND=wayland` (or `x11`) to choose the backend instead.

For containers without FUSE or a GPU, and for centrally managed installs, see
[docs/managed-deployments.md](managed-deployments.md) and
[docs/openaec-linux.md](openaec-linux.md). Building the packages yourself is
described in [docs/building.md](building.md) and
[docs/linux-build-fixes.md](linux-build-fixes.md).
