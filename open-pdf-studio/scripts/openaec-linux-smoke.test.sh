#!/usr/bin/env bash
# Self-test of openaec-linux-smoke.sh with a fake AppImage, compositor and
# screenshot tool: the smoke must pass a well-behaved app and catch each
# failure it exists for.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
smoke="$script_dir/openaec-linux-smoke.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Fake compositor: creates the Wayland socket entry and waits.
compositor="$tmp/fake-compositor"
printf '%s\n' '#!/usr/bin/env bash' \
  ': > "$XDG_RUNTIME_DIR/wayland-1"' \
  'exec sleep 600' >"$compositor"
# Fake screenshot tool: writes a PNG signature.
grim="$tmp/fake-grim"
printf '%s\n' '#!/usr/bin/env bash' \
  "printf '\\211PNG\\r\\n\\032\\n' > \"\$1\"" >"$grim"
chmod +x "$compositor" "$grim"

# fake_appimage <mode>: the AppRun it extracts behaves according to <mode>
# (ok, exits, ignores-term, wrong-path, unmanaged).
fake_appimage() {
  local mode=$1 file="$tmp/fake-$1.AppImage"
  cat >"$file" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "--appimage-extract" ]] || exit 3
mkdir -p squashfs-root
cat > squashfs-root/AppRun <<'APPRUN'
#!/usr/bin/env bash
mode=$mode
[[ \$mode == exits ]] && exit 0
if [[ \$mode != unmanaged && "\${OPENAEC_BEHEERD:-}" == 1 ]]; then
  echo "[openaec] managed=true container=true software_rendering=true wayland=true x11=false workdir=\$OPENAEC_MAP"
  echo "[openaec] managed mode: updater disabled"
fi
if [[ -n "\${1:-}" ]]; then
  if [[ \$mode == wrong-path ]]; then dir=/opt/app/usr; else dir=\$PWD; fi
  echo "[startup] command-line files: [\"\$dir/\$1\"]"
fi
if [[ \$mode == ignores-term ]]; then
  trap '' TERM
else
  trap 'echo "[openaec] SIGTERM: writing recovery files"; exit 0' TERM
fi
while true; do sleep 0.1; done
APPRUN
chmod +x squashfs-root/AppRun
EOF
  chmod +x "$file"
  echo "$file"
}

run_smoke() {
  SMOKE_COMPOSITOR="$compositor" SMOKE_SCREENSHOT="$grim" SMOKE_TERM_SECONDS=2 \
    bash "$smoke" "$1" 1 "$tmp/out-$2"
}

run_smoke "$(fake_appimage ok)" ok
test -s "$tmp/out-ok/openaec-linux.png"
test -s "$tmp/out-ok/openaec-linux-document.png"
grep -q 'Memory at rest' "$tmp/out-ok/memory-at-rest.txt"

expect_failure() {
  local mode=$1 message=$2
  if run_smoke "$(fake_appimage "$mode")" "$mode" >"$tmp/$mode.log" 2>&1; then
    echo "smoke unexpectedly accepted mode $mode" >&2
    exit 1
  fi
  grep -q "$message" "$tmp/$mode.log" || { echo "mode $mode: expected '$message'" >&2; cat "$tmp/$mode.log" >&2; exit 1; }
}

expect_failure exits 'exited before'
expect_failure ignores-term 'did not exit'
expect_failure wrong-path 'not resolved against the start folder'
expect_failure unmanaged 'managed mode (OPENAEC_BEHEERD=1) not detected'

echo "openaec-linux-smoke self-test passed"
