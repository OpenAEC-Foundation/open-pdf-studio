# Installing on Linux

Every [release](https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/latest)
has a `.deb`, an `.AppImage` and a `.snap` for x86_64 (amd64). Other
architectures are not built.

## Verifying the download (OpenPGP)

Each `.deb`, `.AppImage` and `.snap` on a release has a detached OpenPGP
signature next to it (`<file>.asc`), and `SHA256SUMS` lists the checksums of
the Linux files, signed as `SHA256SUMS.asc`. They are made with the release key
of the OpenAEC Foundation, primary fingerprint
`13F6D414ADEE4ED4CD09AC60601D86C93C504D29`. The public key is in this
repository as [`docs/keys/openaec-signing-public-key.asc`](keys/openaec-signing-public-key.asc)
and on every release as `openaec-signing-public-key.asc`.

```bash
gpg --import openaec-signing-public-key.asc
gpg --fingerprint 13F6D414ADEE4ED4CD09AC60601D86C93C504D29
gpg --verify Open.PDF.Studio_*_amd64.deb.asc Open.PDF.Studio_*_amd64.deb
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

Only trust a "Good signature" when the fingerprint that `gpg --fingerprint`
prints is exactly the one above. These are signatures of the files as
downloaded; the `.deb` has no signature embedded in the package, and the Snap
Store checks the installed snap with its own assertions. The `.sig` files next
to the `.deb` and the AppImage belong to the built-in updater and are a
different signature.

The release workflow (`sign-linux` job in `.github/workflows/release.yml`)
signs the files, checks that the key has the fingerprint above and verifies
every signature against the public key from the repository before the draft
release is finished. When `snap.yml` uploads a snap after that job (or rebuilds
the snap of an existing release), it signs the Linux files again.

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
`OPDS_ALLOW_REALTIME=1` to keep the session's limit.

**The window goes blank while zooming (GPU canvas).** The web process could
crash in the GPU path that draws the page canvas, where the WebKitGTK in the
AppImage meets the host's Mesa driver. The app therefore turns off GPU
acceleration of the 2D canvas (the WebKitGTK setting
`enable-2d-canvas-acceleration`, WebKitGTK 2.46 and later) in every window it
opens; the canvas is then drawn on the CPU and the rest of the window stays
GPU-composited. Set `OPDS_CANVAS_GPU=1` to keep canvas acceleration on. If the
window still goes blank, `WEBKIT_DISABLE_DMABUF_RENDERER=1` avoids the GPU
renderer altogether, at the cost of much slower rendering. Issue
[#924](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/924) tracks
these crashes.

**Smooth scrolling.** WebKitGTK animates scrolling by default (the WebKitGTK
setting `enable-smooth-scrolling`): the page keeps gliding after the mouse
wheel stops. Open PDF Studio turns this off in every window, together with its
own wheel and jump animations, unless *Preferences > Behavior > Smooth
scrolling* is on. The setting is applied when a window opens and again when
you change the preference; if a WebKitGTK version does not pick up the change
at once, restart the app. The app adds no momentum of its own to touchpad
scrolling: any sliding on after you lift your fingers comes from GTK and the
desktop. Issue [#1007](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/1007).

**Choosing Wayland or X11.** The AppImage's GTK hook overwrites `GDK_BACKEND`.
Set `OPDS_GDK_BACKEND=wayland` (or `x11`) to choose the backend instead.

For containers without FUSE or a GPU, and for centrally managed installs, see
[docs/managed-deployments.md](managed-deployments.md) and
[docs/openaec-linux.md](openaec-linux.md). Building the packages yourself is
described in [docs/building.md](building.md) and
[docs/linux-build-fixes.md](linux-build-fixes.md).
