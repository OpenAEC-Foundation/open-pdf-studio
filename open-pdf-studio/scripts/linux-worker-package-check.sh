#!/usr/bin/env bash
# Controleer de werkelijk verpakte worker, inclusief PDFium-initialisatie,
# zonder GUI, FUSE, installatie of een document van de gebruiker.
set -euo pipefail

if (( $# == 0 )); then
  echo 'usage: linux-worker-package-check.sh <package.deb|package.AppImage> [...]' >&2
  exit 1
fi
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
index=0
for package in "$@"; do
  [[ -f "$package" ]] || { echo "package not found: $package" >&2; exit 1; }
  package=$(realpath "$package")
  index=$((index + 1))
  unpack="$scratch/$index"
  mkdir -p "$unpack"
  case "$package" in
    *.deb)
      dpkg-deb -x "$package" "$unpack"
      root="$unpack"
      ;;
    *.AppImage)
      (cd "$unpack" && "$package" --appimage-extract >extract.log 2>&1) || {
        cat "$unpack/extract.log" >&2
        exit 1
      }
      root="$unpack/squashfs-root"
      ;;
    *) echo "unsupported package: $package" >&2; exit 1 ;;
  esac
  worker="$root/usr/bin/pdfium-worker"
  [[ -f "$worker" && -x "$worker" ]] || {
    echo "missing executable usr/bin/pdfium-worker in $package" >&2
    exit 1
  }
  [[ -f "$root/usr/lib/Open PDF Studio/libpdfium.so" ]] || {
    echo "missing bundled PDFium resource in $package" >&2
    exit 1
  }
  # A ready response is emitted only AFTER Renderer::new loads PDFium.
  # Empty stdin shuts the worker down normally and removes its SHM file.
  # Start outside the resource directory and discard launcher library paths:
  # .deb users must not depend on the AppImage launcher or the build cwd.
  if ! (cd "$unpack" && env -u LD_LIBRARY_PATH -u APPDIR -u APPIMAGE TMPDIR="$unpack" \
    timeout 15 "$worker" 0 "$$" </dev/null >worker.log 2>&1); then
    cat "$unpack/worker.log" >&2
    echo "packaged worker failed to initialize: $package" >&2
    exit 1
  fi
  if ! grep -q '"op":"ready"' "$unpack/worker.log"; then
    cat "$unpack/worker.log" >&2
    echo "packaged worker did not report ready: $package" >&2
    exit 1
  fi
  echo "OK: packaged worker initializes PDFium: $package"
done
