# Windows distribution: winget, MSIX and the Microsoft Store

Issue #753 asks for three things: an MSIX package, a winget package and a
Microsoft Store listing. This document records what the repository does now,
what it cannot do on its own, and what a maintainer has to set up.

## What the release produces today

`.github/workflows/release.yml` builds two Windows installers with the Tauri
NSIS bundler (`bundle.targets` in `open-pdf-studio/src-tauri/tauri.conf.json`
contains `nsis`, not `msi`). An MSI is not possible: its ProductVersion allows
at most 255 as the first number and the version scheme starts with the year
(`scripts/versievelden.test.mjs` guards this).

| Release asset | Scope | Installs to | Apps & Features key |
| --- | --- | --- | --- |
| `Open.PDF.Studio_<version>_x64-setup.exe` | per machine (admin) | Program Files | `Open PDF Studio` |
| `Open.PDF.Studio_<version>_x64_user-setup.exe` | current user | `%LOCALAPPDATA%` | `Open PDF Studio (User)` |

Both are Authenticode-signed in CI (the `Configure Tauri sign command` step).
An arm64 build exists only as the experimental `windows-arm64.yml` workflow and
is not part of the release yet; the winget generator picks up an
`*_arm64-setup.exe` asset automatically once the release contains one.

Installer switches (from `src-tauri/nsis/installer.nsi`):

- `/S`: silent. Skips every page, so it creates the Start menu shortcut but no
  desktop shortcut, no PDF file association and no virtual printer.
- `/P`: passive (progress only). Sets the PDF association and the desktop
  shortcut, as on an interactive install with the defaults.
- `/D=<dir>`: install location (standard NSIS).

## winget (done in this repository)

`open-pdf-studio/scripts/winget-manifest.mjs` writes a winget multi-file
manifest (schema 1.10.0) for one release:

- `OpenAEC.OpenPDFStudio.yaml` (version manifest)
- `OpenAEC.OpenPDFStudio.locale.en-US.yaml` (publisher, licence
  `LGPL-3.0-or-later`, URLs, description, moniker `open-pdf-studio`)
- `OpenAEC.OpenPDFStudio.installer.yaml` (one entry per installer: type
  `nsis`, architecture, scope, URL, SHA256, `/S` and `/P` switches, the Apps &
  Features key as `ProductCode`, `.pdf` as file extension)

The metadata comes from `tauri.conf.json`, `package.json` and
`src-tauri/Cargo.toml`.

The release workflow job `winget-manifests` runs after the `build` job. It
downloads the installers from the draft release, computes their SHA256,
generates the manifests and publishes them both as the workflow artifact
`winget-manifests` and as the release asset
`open-pdf-studio-winget-manifests-<version>.zip`.

Run it locally against installers you already have:

```sh
cd open-pdf-studio
node scripts/winget-manifest.mjs --assets <dir-with-setup.exe-files> \
  --version 2026.43.11 --out ../winget-out
```

### Maintainer steps per release

The workflow does not submit anything to the winget community repository
(`microsoft/winget-pkgs`), on purpose:

1. Publish the draft release first. The installer URLs in the manifest only
   resolve for a published release, and the winget validation pipeline
   downloads them and checks the hashes. Do not re-upload an installer after
   that: a changed file invalidates `InstallerSha256`.
2. Take the manifests from the release asset and validate them on a Windows
   machine: `winget validate --manifest <dir>`, then
   `winget install --manifest <dir>` in a test VM (enable local manifests with
   `winget settings --enable LocalManifestFiles` as administrator).
3. Open a pull request to `microsoft/winget-pkgs` with the folder
   `manifests/o/OpenAEC/OpenPDFStudio/<version>/`, from a fork under a
   maintainer's GitHub account. The first submission creates the package;
   later versions are new folders next to it.
4. Optional, later: automate step 3 with a dedicated job that runs on the
   `release: published` event and uses a personal access token of a
   maintainer account with a fork of `winget-pkgs`. That needs a new
   repository secret and is therefore left to the maintainers.

Points to check on the first submission:

- The Apps & Features publisher is derived by the Tauri NSIS bundler from
  `bundle.publisher`, or else from the second part of the identifier
  (`org.openaec.openpdfstudio` gives `openaec`). The generator uses the same
  rule; verify the `Publisher` value under the uninstall key after a test
  install. Setting `bundle.publisher` in `tauri.conf.json` would give a nicer
  name in Apps & Features; the generator follows that setting automatically.
- `UpgradeBehavior: install` relies on the NSIS installer installing over an
  existing version, which it does.

## MSIX

Tauri cannot produce MSIX. The project uses `@tauri-apps/cli` 2.10 and
`tauri` 2.11; their Windows bundle targets are `nsis` and `msi` only (and
`msi` is ruled out by the version scheme, see above). MSIX itself accepts the
version: each of its four parts may go up to 65535 (`2026.43.11.0`). An MSIX
would have to be built outside the Tauri bundler:

- Pack the files that the NSIS installer lays down (the app, `pdfium-worker`,
  the DLLs and resources) with `makeappx.exe` from the Windows SDK and an
  `AppxManifest.xml` that declares the `.pdf` file type association and the
  `openpdfstudio:` protocol, or convert the existing installer with the MSIX
  Packaging Tool.
- Parts of the current installer do not fit the MSIX model and need rework:
  the virtual printer (installs a printer driver and port through PowerShell,
  needs admin), the thumbnail provider DLL (`open-pdf-thumbnails.dll`, a COM
  shell extension that MSIX would have to declare in the manifest) and the
  WebView2 bootstrapper (MSIX would declare WebView2 as a dependency instead).
  The in-app updater (Tauri updater with `latest.json`) must be disabled in an
  MSIX build: MSIX packages update through the Store or an App Installer
  file.
- An MSIX must be signed, and the `Publisher` in `AppxManifest.xml` must equal
  the certificate subject exactly. For side-loading this means a code-signing
  certificate whose subject matches; the signing setup already used for the
  NSIS installers is a candidate, provided its certificate profile can sign
  MSIX packages. For Store distribution the Store signs the package itself.

winget can install MSIX packages as well (`InstallerType: msix`), but the NSIS
installers are enough for winget; MSIX is mainly useful for the Store and for
managed or S-mode devices.

## Microsoft Store

Two routes, both requiring a Partner Center developer account for the
organisation (registration, publisher display name and the reservation of the
app name are steps only a maintainer can take):

1. **Win32 app with the existing installer.** The Store accepts unpackaged
   Win32 apps that are submitted as an HTTPS URL to a versioned installer
   (`.exe` or `.msi`; here the `.exe`), with the silent install switch. The installer must be
   signed with a certificate from a trusted certificate authority and must
   not change after submission. Check the current Store policy on apps that
   update themselves (the Tauri updater) before submitting. The per-machine
   NSIS installer with `/S` fits this route with the least work. Such apps are not available on
   Windows in S mode.
2. **MSIX submission.** Build an MSIX as described above, with
   `Identity Name` and `Publisher` copied from the reserved app in Partner
   Center, and upload it there. The Store re-signs it. This is the route that
   reaches S-mode devices (education), as #753 mentions, but it depends on the
   MSIX rework above.

None of the account values (publisher ID, package identity name, Store app ID)
exist yet, so nothing for the Store is wired into the workflows.

## Relation to the antivirus false positives (#724, #761, #782)

Users report the setup executable being flagged by Microsoft Defender
(`Trojan:Win32/Wacatac.H!ml`, a machine-learning detection) and other
scanners, and SmartScreen warnings on download.

- The installers are already Authenticode-signed. A signature helps, but
  SmartScreen and the Defender cloud classifier also weigh the reputation of
  the certificate and of each new file hash; a new certificate or a new
  release has little reputation at first.
- winget does not avoid this: it downloads the same signed installer and the
  local Defender scan still runs. Its own pipeline scans the installer too and
  may reject a submission while a detection is active.
- A Store-signed MSIX is trusted by SmartScreen, and a Store-listed Win32
  installer is scanned by Microsoft at submission, which makes the Store the
  route with the fewest warnings for end users.
- For each release that gets flagged, a maintainer can submit the file as a
  false positive through the Microsoft Security Intelligence portal
  (submission for analysis as a software developer). Keeping the same signing
  certificate across releases lets reputation build up.
