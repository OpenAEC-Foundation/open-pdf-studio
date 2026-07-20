#!/usr/bin/env bash
set -euo pipefail

appimage=${1:?"usage: linux-appimage-smoke.sh <appimage> [survival-seconds]"}
survival_seconds=${2:-10}

if [[ ! -f "$appimage" ]]; then
  echo "AppImage not found: $appimage" >&2
  exit 1
fi

appimage=$(cd -- "$(dirname -- "$appimage")" && pwd)/$(basename -- "$appimage")
if [[ ! -x "$appimage" ]]; then
  chmod +x "$appimage"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! (cd "$tmp" && "$appimage" --appimage-extract >extract.log 2>&1); then
  echo "AppImage extraction failed" >&2
  cat "$tmp/extract.log" >&2
  exit 1
fi

if ! find "$tmp/squashfs-root" -type f -name libpdfium.so -print -quit | grep -q .; then
  echo "libpdfium.so is missing from the AppImage" >&2
  exit 1
fi

launcher=("$appimage")
# SMOKE_NO_DISPLAY_WRAPPERS=1 slaat xvfb-run/dbus-run-session over. De
# zelftest (linux-appimage-smoke.test.sh) gebruikt dit: zijn fake-AppImage
# heeft geen X nodig, en Xvfb-opstart kan langer duren dan het 1s-venster —
# dan wordt de fake gekilld vóór hij zijn foutregel print en keurt de smoke
# een GVFS-faal onterecht goed.
if [[ "${SMOKE_NO_DISPLAY_WRAPPERS:-0}" != "1" ]]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    launcher=(xvfb-run -a "$appimage")
  fi
  if command -v dbus-run-session >/dev/null 2>&1; then
    launcher=(dbus-run-session -- "${launcher[@]}")
  fi
fi

set +e
APPIMAGE_EXTRACT_AND_RUN=1 timeout --kill-after=5s "${survival_seconds}s" \
  "${launcher[@]}" >"$tmp/startup.log" 2>&1
status=$?
set -e

if [[ $status -ne 124 ]]; then
  echo "AppImage exited before the ${survival_seconds}s survival window (status $status)" >&2
  cat "$tmp/startup.log" >&2
  exit 1
fi

if grep -Eiq \
  'panicked at|PDFium initialisation failed|undefined symbol: g_task_set_static_name|Failed to load module: .*libgvfsdbus\.so' \
  "$tmp/startup.log"; then
  echo "forbidden startup diagnostic detected" >&2
  cat "$tmp/startup.log" >&2
  exit 1
fi

echo "AppImage startup smoke passed"
