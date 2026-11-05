# Publishing on Flathub

This repository holds everything Flathub needs (issue #389). The submission
itself happens in the Flathub organisation on GitHub and needs a maintainer.

## Files

| File | Role |
| --- | --- |
| `flatpak/org.openaec.OpenPdfStudio.yml` | Manifest. Builds from the local checkout (`type: dir`), for CI and local tests. |
| `flatpak/org.openaec.OpenPdfStudio.desktop` | Desktop entry, installed under the app id. |
| `flatpak/org.openaec.OpenPdfStudio.metainfo.xml` | AppStream metadata (store page: description, screenshots, releases). |
| `flatpak/flathub.json` | Flathub build options: x86_64 only (see below). |
| `flatpak/generate-sources.mjs` | Writes `generated-sources-npm.json` and `generated-sources-cargo.json` from `open-pdf-studio/package-lock.json` and `Cargo.lock`. No network needed; the output is not committed. |
| `flatpak/flathub-manifest.mjs` | Writes the files for the Flathub repository for one release tag. |
| `flatpak/ci-check.sh` | `lint` and `build` steps used by CI. |

`open-pdf-studio/scripts/flatpak-flathub.test.mjs` checks the static
requirements (permissions, offline sources, metainfo fields, version, icons).
CI runs `ci-check.sh lint` when the Flatpak or a lockfile changes (`ci.yml`,
job `flatpak-lint`), and on every release tag `release.yml` (job `flatpak`)
also builds the Flatpak the way Flathub does and lints the result. The bundle
it builds is a workflow artifact for testing; it is not a release asset.

## How the build stays offline

Flathub builds without network access. Every input is a declared source with
a checksum:

- npm packages: `generated-sources-npm.json` fills an npm cache
  (`flatpak-node/npm-cache`), and `npm ci --offline` installs from it.
- crates: `generated-sources-cargo.json` fills `cargo/vendor` and writes
  `cargo/config.toml`, which replaces crates.io and the `tesseract-rs` git
  patch with that directory; `cargo build --offline --locked` uses it.
- Leptonica and Tesseract: git sources at the tags that `tesseract-rs`'s
  build script would otherwise download. The manifest moves them to where
  that build script looks first.
- PDFium: the same `chromium/8076` archive the release workflows bundle.
- OCR trained data and CJK fonts: the files and SHA-256 sums from
  `open-pdf-studio/scripts/ocr-runtime.mjs`, pinned to a commit.
  `npm run build --ignore-scripts` skips the `prebuild` hook that would
  download them.

Both JSON files follow the layout of flatpak-node-generator and
flatpak-cargo-generator, so those tools can replace the script if ever needed.

## Permissions

| finish-arg | Why |
| --- | --- |
| `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc` | Windowing; X11 only without a Wayland session. |
| `--device=dri` | GPU rendering in WebKitGTK. |
| `--share=network` | OpenAEC account sign-in (loopback OAuth redirect and HTTPS API), the online symbol library, the "What's new" notes, and the optional local MCP connection that AI clients outside the sandbox reach on localhost. |
| `--socket=cups` | Printing to CUPS queues. |
| `--own-name=org.openaec.openpdfstudio.SingleInstance` | The single-instance plugin's bus name (from the Tauri identifier, lower case, so not covered by the app id). Lets "Open with" open the file in the running window. |

There is no `--filesystem` permission: files are opened and saved through
the file chooser portal, and "Open with" and drag and drop pass files through
the document portal.

The built-in updater is off in the Flatpak (Flathub does not allow apps to
update themselves); Help > Check for updates says that updates come from the
software center.

## Before the first submission

1. **App id and domain.** Flathub requires the app id to belong to a domain
   the developer controls. `org.openaec.OpenPdfStudio` needs control of
   `openaec.org`; Flathub verifies it with
   `https://openaec.org/.well-known/org.flathub.VerifiedApps.txt`. If the
   foundation does not control that domain, choose another id before the
   first submission (for example `com.open_aec.OpenPdfStudio` for
   `open-aec.com`, or `io.github.OpenAEC_Foundation.OpenPdfStudio`) and
   rename the three files in `flatpak/`, the ids inside them, and
   `APP_ID` in `flatpak/flathub-manifest.mjs` and the test. The id cannot be
   changed after publication without an end-of-life rename.
2. **Screenshots.** The metainfo points at `docs/screenshots/*.jpg` on `main`
   via `raw.githubusercontent.com`. Keep those files in place (Flathub
   mirrors them at build time).
3. Make sure the release you submit contains the desktop file with `%F`
   (#758) and the 256/512 px icons (#791) if those have been merged.

## Submitting (first time)

Run these from a checkout of the release tag, so the generated sources match
the lockfiles of that release.

```sh
git checkout v2026.43.11
commit=$(git rev-parse 'v2026.43.11^{commit}')
node flatpak/flathub-manifest.mjs --tag v2026.43.11 --commit "$commit" --out ../flathub-submission
```

`../flathub-submission` now holds `org.openaec.OpenPdfStudio.yml`,
`generated-sources-npm.json`, `generated-sources-cargo.json` and
`flathub.json`.

Test it locally (once: `flatpak install flathub org.flatpak.Builder`):

```sh
cd ../flathub-submission
flatpak run --command=flathub-build org.flatpak.Builder --install org.openaec.OpenPdfStudio.yml
flatpak run org.openaec.OpenPdfStudio
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest org.openaec.OpenPdfStudio.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
```

Then open the submission:

1. Fork <https://github.com/flathub/flathub> on GitHub. Leave "Copy the
   master branch only" unticked: submissions go against the `new-pr` branch.
2. Clone the fork on that branch and add the files:

   ```sh
   git clone --branch=new-pr git@github.com:<you>/flathub.git
   cd flathub
   git checkout -b open-pdf-studio
   cp ../flathub-submission/* .
   git add org.openaec.OpenPdfStudio.yml generated-sources-npm.json generated-sources-cargo.json flathub.json
   git commit -m "Add org.openaec.OpenPdfStudio"
   git push origin open-pdf-studio
   ```

3. Open a pull request from that branch against `flathub/flathub`, base
   branch **`new-pr`** (not `master`), titled `Add org.openaec.OpenPdfStudio`,
   and fill in the checklist of the template.
4. Reviewers comment on the PR. Push fixes to the same branch; comment
   `bot, build` to start a test build.
5. After approval Flathub creates `github.com/flathub/org.openaec.OpenPdfStudio`
   and invites the submitter as maintainer. From then on every update goes
   through that repository.

## Updating for a new release

1. In this repository, `node open-pdf-studio/scripts/bump-version.js <version>`
   also adds `<release version="..." date="...">` on top of the metainfo
   releases. Add a short `<description>` to it before tagging if you like;
   Flathub shows it as the changelog.
2. Tag the release as usual. The `flatpak` job of `release.yml` builds and
   lints the Flatpak for that tag; check it is green.
3. From a checkout of the tag, regenerate the Flathub files:

   ```sh
   git checkout v<version>
   node flatpak/flathub-manifest.mjs --tag v<version> --commit "$(git rev-parse 'v<version>^{commit}')" --out ../flathub-update
   ```

4. In a clone of `flathub/org.openaec.OpenPdfStudio`, on a new branch, copy
   the four files over the old ones, commit (`Update to <version>`), push and
   open a pull request against `master`. The Flathub bot builds it; merge
   when the build is green. The update reaches users after the next publish
   run (usually within a few hours).

The generated sources must be regenerated for every release, because
`Cargo.lock` and `package-lock.json` change. When PDFium, the OCR assets or
`tesseract-rs` change, update the matching sources in the manifest in this
repository first; the test compares the PDFium URL with the release
workflows and the OCR checksums with `ocr-runtime.mjs`.

## Known limitations

- **x86_64 only** (`flathub.json`): the PDFium source is declared for x86_64,
  like the other Linux release builds. An aarch64 build needs the
  `pdfium-linux-arm64.tgz` source with `only-arches: [aarch64]` and a test
  build.
- **Printer list**: printing calls `lpstat` and `lp`, which the GNOME runtime
  does not ship (it has `lpr` only), so the printer list stays empty in the
  Flatpak until printing uses libcups or the print portal, or the manifest
  builds the CUPS client tools.
- **Default PDF app**: the "make Open PDF Studio the default" check uses
  `xdg-mime`, which is not in the runtime; in a Flatpak the desktop's own
  settings set the default application.
