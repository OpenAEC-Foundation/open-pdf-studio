#!/usr/bin/env bash
# Flatpak checks for CI (.github/workflows/ci.yml and release.yml).
#
#   bash flatpak/ci-check.sh lint    validate the desktop file and metainfo,
#                                    run flatpak-builder-lint on the manifest
#                                    as it would be submitted to Flathub
#   bash flatpak/ci-check.sh build   build the Flatpak offline from the
#                                    declared sources, lint the build
#                                    directory and the repo, export
#                                    ./org.openaec.OpenPdfStudio.flatpak
#
# Needs: node, appstreamcli, desktop-file-validate, flatpak with the flathub
# remote and org.flatpak.Builder installed (see the workflows).
set -euo pipefail

cd "$(dirname "$0")/.."
app_id=org.openaec.OpenPdfStudio
mode=${1:-lint}
lint=(flatpak run --command=flatpak-builder-lint org.flatpak.Builder)

node flatpak/generate-sources.mjs

case "$mode" in
  lint)
    desktop-file-validate "flatpak/$app_id.desktop"
    appstreamcli validate --pedantic --explain "flatpak/$app_id.metainfo.xml"

    version=$(node -p "require('./open-pdf-studio/package.json').version")
    commit=$(git rev-parse HEAD)
    rm -rf flathub-out
    node flatpak/flathub-manifest.mjs --tag "v$version" --commit "$commit" --out flathub-out
    "${lint[@]}" appstream "flatpak/$app_id.metainfo.xml"
    "${lint[@]}" manifest "flathub-out/$app_id.yml"
    ;;
  build)
    # flathub-build builds the way the Flathub builders do (sandboxed, sources
    # downloaded first, no network during the build, screenshots mirrored)
    # into ./builddir and ./repo, and installs the result.
    flatpak run --command=flathub-build org.flatpak.Builder --install "flatpak/$app_id.yml"
    "${lint[@]}" builddir builddir
    "${lint[@]}" repo repo
    flatpak build-bundle repo "$app_id.flatpak" "$app_id"
    ;;
  *)
    echo "usage: $0 lint|build" >&2
    exit 2
    ;;
esac
