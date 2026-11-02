#!/usr/bin/env bash
set -euo pipefail
script=$(realpath "$(dirname "$0")/linux-worker-package-check.sh")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/root/DEBIAN" "$scratch/root/usr/bin" "$scratch/root/usr/lib/Open PDF Studio"
cat >"$scratch/root/DEBIAN/control" <<'CONTROL'
Package: worker-package-fixture
Version: 1.0
Architecture: amd64
Maintainer: Test <test@example.invalid>
Description: Linux package gate fixture
CONTROL
touch "$scratch/root/usr/lib/Open PDF Studio/libpdfium.so"
cat >"$scratch/root/usr/bin/pdfium-worker" <<'WORKER'
#!/usr/bin/env bash
[[ -z ${LD_LIBRARY_PATH+x} && -z ${APPDIR+x} && -z ${APPIMAGE+x} ]] || exit 10
[[ "$PWD" != *'/usr/bin' && "$PWD" != *'/Open PDF Studio' ]] || exit 11
printf '%s\n' '{"op":"ready"}'
WORKER
chmod +x "$scratch/root/usr/bin/pdfium-worker"
cp "$scratch/root/usr/bin/pdfium-worker" "$scratch/good-worker"

pack() { dpkg-deb --build "$scratch/root" "$scratch/package.deb" >/dev/null; }
passes() { bash "$script" "$@" >"$scratch/result.log" 2>&1 || { cat "$scratch/result.log"; exit 1; }; }
fails() {
  local expected=$1; shift
  if bash "$script" "$@" >"$scratch/result.log" 2>&1; then
    echo "unexpected success: $*" >&2; exit 1
  fi
  grep -q "$expected" "$scratch/result.log" || { cat "$scratch/result.log"; exit 1; }
}
pack
LD_LIBRARY_PATH=/invalid APPDIR=/invalid APPIMAGE=/invalid passes "$scratch/package.deb"
fails usage
fails 'package not found' "$scratch/missing.deb"
chmod -x "$scratch/root/usr/bin/pdfium-worker"
pack; fails 'missing executable' "$scratch/package.deb"
mv "$scratch/root/usr/bin/pdfium-worker" "$scratch/root/usr/bin/pdfium-worker-x86_64-unknown-linux-gnu"
pack; fails 'missing executable' "$scratch/package.deb"
rm "$scratch/root/usr/bin/pdfium-worker-x86_64-unknown-linux-gnu"
cp "$scratch/good-worker" "$scratch/root/usr/bin/pdfium-worker"
rm "$scratch/root/usr/lib/Open PDF Studio/libpdfium.so"
pack; fails 'missing bundled PDFium' "$scratch/package.deb"
touch "$scratch/root/usr/lib/Open PDF Studio/libpdfium.so"
printf '#!/bin/sh\nexit 1\n' >"$scratch/root/usr/bin/pdfium-worker"
pack; fails 'failed to initialize' "$scratch/package.deb"
printf '#!/bin/sh\nexit 0\n' >"$scratch/root/usr/bin/pdfium-worker"
pack; fails 'did not report ready' "$scratch/package.deb"
cp "$scratch/good-worker" "$scratch/root/usr/bin/pdfium-worker"

# Exercise the extraction contract without downloading or mounting an AppImage.
cat >"$scratch/package.AppImage" <<'APPIMAGE'
#!/usr/bin/env bash
set -eu
[[ $1 == --appimage-extract ]]
cp -a "$(dirname "$0")/root" squashfs-root
APPIMAGE
chmod +x "$scratch/package.AppImage"
pack
passes "$scratch/package.deb" "$scratch/package.AppImage"
rm "$scratch/root/usr/bin/pdfium-worker"
fails 'missing executable' "$scratch/package.AppImage"
printf '#!/bin/sh\necho broken-extraction\nexit 1\n' >"$scratch/package.AppImage"
fails broken-extraction "$scratch/package.AppImage"
printf 'OK: Linux worker package gate positive and negative cases\n'
