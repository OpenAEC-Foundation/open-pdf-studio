#!/usr/bin/env bash
# Start the AppImage the way OpenAEC Linux does (#863) and check it works:
#
#   * extracted (--appimage-extract, then squashfs-root/AppRun): no FUSE
#   * under a headless Wayland compositor (labwc on the wlroots headless
#     backend with the pixman renderer): no GPU, no X server
#   * without a session bus, keyring, system tray or notification daemon
#   * managed mode (OPENAEC_BEHEERD=1) with a work folder (OPENAEC_MAP)
#
# Run 1 starts without a document: it must survive, a screenshot is taken
# (grim), the memory at rest is measured and SIGTERM must end it cleanly.
# Run 2 starts with a RELATIVE file argument from a folder in the work folder
# (AppRun changes to $APPDIR/usr, the app must still find the file).
#
# Usage: openaec-linux-smoke.sh <appimage> [survival-seconds] [output-dir]
# Output: <output-dir>/openaec-linux.png, openaec-linux-document.png,
#         memory-at-rest.txt and the logs.
# SMOKE_COMPOSITOR / SMOKE_SCREENSHOT replace labwc / grim (self-test).
set -euo pipefail

appimage=${1:?"usage: openaec-linux-smoke.sh <appimage> [survival-seconds] [output-dir]"}
survival_seconds=${2:-15}
out=${3:-$PWD/openaec-linux-smoke}
compositor=${SMOKE_COMPOSITOR:-labwc}
screenshot=${SMOKE_SCREENSHOT:-grim}
term_seconds=${SMOKE_TERM_SECONDS:-20}

if [[ ! -f "$appimage" ]]; then
  echo "AppImage not found: $appimage" >&2
  exit 1
fi
appimage=$(cd -- "$(dirname -- "$appimage")" && pwd)/$(basename -- "$appimage")
[[ -x "$appimage" ]] || chmod +x "$appimage"
mkdir -p "$out"
out=$(cd -- "$out" && pwd)

tmp=$(mktemp -d)
compositor_pid=
app_pid=
cleanup() {
  [[ -n "$app_pid" ]] && kill -KILL "$app_pid" 2>/dev/null || true
  [[ -n "$compositor_pid" ]] && kill -TERM "$compositor_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

fail() {
  echo "OpenAEC Linux smoke: $1" >&2
  shift
  for log in "$@"; do
    [[ -f "$log" ]] && { echo "--- $(basename "$log")" >&2; cat "$log" >&2; cp "$log" "$out/" 2>/dev/null || true; }
  done
  exit 1
}

# 1. Extract: there is no FUSE in the container.
if ! (cd "$tmp" && "$appimage" --appimage-extract >extract.log 2>&1); then
  fail "AppImage extraction failed" "$tmp/extract.log"
fi
apprun="$tmp/squashfs-root/AppRun"
[[ -x "$apprun" ]] || fail "squashfs-root/AppRun is missing after extraction"

# 2. A clean environment: no X, no session bus, no GPU hint, own runtime dir.
workdir="$tmp/openaec"
home="$tmp/home"
runtime="$tmp/xdg-runtime"
startdir="$workdir/plannen"
mkdir -p "$startdir" "$home" "$runtime"
chmod 700 "$runtime"
# Smallest valid one-page PDF (offsets in the xref table are exact).
printf '%s\n' '%PDF-1.4' \
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj' \
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj' \
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj' \
  'xref' '0 4' '0000000000 65535 f ' '0000000009 00000 n ' '0000000052 00000 n ' '0000000101 00000 n ' \
  'trailer<</Size 4/Root 1 0 R>>' 'startxref' '164' '%%EOF' >"$startdir/smoke.pdf"

clean_env=(env -i
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  HOME="$home" USER="${USER:-openaec}" LANG=C.UTF-8
  XDG_RUNTIME_DIR="$runtime")

# 3. Headless Wayland compositor, software rendering.
"${clean_env[@]}" WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  $compositor >"$tmp/compositor.log" 2>&1 &
compositor_pid=$!
socket=
for _ in $(seq 1 100); do
  socket=$(find "$runtime" -maxdepth 1 -name 'wayland-*' ! -name '*.lock' -print -quit 2>/dev/null || true)
  [[ -n "$socket" ]] && break
  kill -0 "$compositor_pid" 2>/dev/null || fail "compositor exited" "$tmp/compositor.log"
  sleep 0.2
done
[[ -n "$socket" ]] || fail "compositor did not create a Wayland socket" "$tmp/compositor.log"
wayland_display=$(basename "$socket")

app_env=("${clean_env[@]}" WAYLAND_DISPLAY="$wayland_display" OPENAEC_BEHEERD=1 OPENAEC_MAP="$workdir")

forbidden='panicked at|Could not create default EGL display|EGL_BAD|Failed to initialize gtk|cannot open display|PDFium initialisation failed|undefined symbol|Failed to load module: .*libgvfsdbus\.so'

# Sum of the proportional set size (PSS) of a process and all its children,
# in KiB (shared libraries counted once). Falls back to RSS without smaps.
memory_kib() {
  local root=$1 total=0 pid kib
  local -a todo=("$root") all=()
  while ((${#todo[@]})); do
    pid=${todo[0]}; todo=("${todo[@]:1}")
    all+=("$pid")
    for child in $(cat /proc/"$pid"/task/*/children 2>/dev/null); do todo+=("$child"); done
  done
  for pid in "${all[@]}"; do
    kib=$(awk '/^Pss:/ {print $2; exit}' /proc/"$pid"/smaps_rollup 2>/dev/null || true)
    [[ -n "$kib" ]] || kib=$(awk '/^VmRSS:/ {print $2; exit}' /proc/"$pid"/status 2>/dev/null || echo 0)
    total=$((total + kib))
  done
  echo "$total ${#all[@]}"
}

take_screenshot() {
  local file=$1
  "${clean_env[@]}" WAYLAND_DISPLAY="$wayland_display" $screenshot "$file" >"$tmp/screenshot.log" 2>&1 \
    || fail "screenshot failed" "$tmp/screenshot.log" "$tmp/compositor.log"
  [[ -s "$file" ]] || fail "screenshot is empty"
  [[ "$(head -c 4 "$file" | od -An -c | tr -d ' ')" == "211PNG" ]] || fail "screenshot is not a PNG"
}

stop_with_sigterm() {
  local log=$1 status
  kill -TERM "$app_pid"
  for _ in $(seq 1 $((term_seconds * 5))); do
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$app_pid" 2>/dev/null; then
    fail "the app did not exit within ${term_seconds}s after SIGTERM" "$log"
  fi
  set +e
  wait "$app_pid"
  status=$?
  set -e
  app_pid=
  [[ $status -eq 0 ]] || fail "the app exited with status $status after SIGTERM" "$log"
  grep -q '\[openaec\] SIGTERM' "$log" || fail "no SIGTERM handling in the log" "$log"
}

check_log() {
  local log=$1
  if grep -Eiq "$forbidden" "$log"; then
    fail "forbidden startup diagnostic detected" "$log"
  fi
  grep -q '\[openaec\] managed=true' "$log" || fail "managed mode (OPENAEC_BEHEERD=1) not detected" "$log"
  grep -q '\[openaec\] managed mode: updater disabled' "$log" || fail "the updater is not disabled in managed mode" "$log"
}

# 4. Run 1: no document. Survive, screenshot, memory at rest, SIGTERM.
(cd "$workdir" && exec "${app_env[@]}" "$apprun") >"$tmp/run-1.log" 2>&1 &
app_pid=$!
sleep "$survival_seconds"
kill -0 "$app_pid" 2>/dev/null \
  || fail "the app exited before the ${survival_seconds}s survival window" "$tmp/run-1.log" "$tmp/compositor.log"
check_log "$tmp/run-1.log"
read -r kib processes < <(memory_kib "$app_pid")
mib=$(( (kib + 512) / 1024 ))
printf 'Memory at rest (Linux AppImage, no document open, software rendering): %s MiB PSS over %s processes\n' \
  "$mib" "$processes" | tee "$out/memory-at-rest.txt"
take_screenshot "$out/openaec-linux.png"
stop_with_sigterm "$tmp/run-1.log"
cp "$tmp/run-1.log" "$out/"

# 5. Run 2: relative start argument from a folder below the work folder (the
#    shell passes that folder as PWD; AppRun itself moves to $APPDIR/usr).
(cd "$startdir" && exec "${app_env[@]}" PWD="$startdir" "$apprun" smoke.pdf) >"$tmp/run-2.log" 2>&1 &
app_pid=$!
sleep "$survival_seconds"
kill -0 "$app_pid" 2>/dev/null \
  || fail "the app exited before the ${survival_seconds}s survival window (with a document)" "$tmp/run-2.log"
check_log "$tmp/run-2.log"
grep -qF "[startup] command-line files: [\"$startdir/smoke.pdf\"]" "$tmp/run-2.log" \
  || fail "the relative start argument was not resolved against the start folder" "$tmp/run-2.log"
take_screenshot "$out/openaec-linux-document.png"
stop_with_sigterm "$tmp/run-2.log"
cp "$tmp/run-2.log" "$tmp/compositor.log" "$out/"

echo "OpenAEC Linux smoke passed"
