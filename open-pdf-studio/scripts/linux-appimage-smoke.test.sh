#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
smoke="$script_dir/linux-appimage-smoke.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fake="$tmp/fake.AppImage"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == "--appimage-extract" ]]; then' \
  '  if [[ "${FAKE_MISSING_PDFIUM:-0}" != "1" ]]; then' \
  '    mkdir -p "squashfs-root/usr/lib/Open PDF Studio"' \
  '    : > "squashfs-root/usr/lib/Open PDF Studio/libpdfium.so"' \
  '  fi' \
  '  exit 0' \
  'fi' \
  'if [[ "${BASH_SOURCE[0]}" == *"-gvfs.AppImage" ]]; then' \
  '  echo "Failed to load module: libgvfsdbus.so: undefined symbol: g_task_set_static_name" >&2' \
  'fi' \
  'while true; do sleep 1; done' \
  > "$fake"
chmod +x "$fake"

bash "$smoke" "$fake" 1

if FAKE_MISSING_PDFIUM=1 bash "$smoke" "$fake" 1 >"$tmp/missing.log" 2>&1; then
  echo "smoke unexpectedly accepted an AppImage without libpdfium.so" >&2
  exit 1
fi
grep -q 'libpdfium.so is missing' "$tmp/missing.log"

gvfs_fake="$tmp/fake-gvfs.AppImage"
cp "$fake" "$gvfs_fake"
if bash "$smoke" "$gvfs_fake" 1 >"$tmp/gvfs.log" 2>&1; then
  echo "smoke unexpectedly accepted a GVFS symbol failure" >&2
  exit 1
fi
grep -q 'forbidden startup diagnostic' "$tmp/gvfs.log"
