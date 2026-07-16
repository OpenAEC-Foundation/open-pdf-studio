#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?usage: macos-startup-smoke.sh /path/to/App.app}"
test -d "$app_path"

existing_diagnostics="$(find "$HOME/Library/Logs" "$HOME/Library/Application Support" -name startup-diagnostics.jsonl -type f -print -quit 2>/dev/null || true)"
baseline_lines=0
if [[ -n "$existing_diagnostics" ]]; then
  baseline_lines="$(wc -l < "$existing_diagnostics")"
fi

crash_baseline="$(mktemp)"
touch "$crash_baseline"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$crash_baseline"
}
trap cleanup EXIT

find_new_crash_report() {
  local reports="$HOME/Library/Logs/DiagnosticReports"
  if [[ ! -d "$reports" ]]; then return 0; fi
  find "$reports" -type f -newer "$crash_baseline" \
    \( -name 'Open PDF Studio*.ips' -o -name 'Open PDF Studio*.crash' \
       -o -name 'open-pdf-studio*.ips' -o -name 'open-pdf-studio*.crash' \) \
    -print -quit 2>/dev/null || true
}

assert_process_healthy() {
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "App process exited during startup smoke"
    local report
    report="$(find_new_crash_report)"
    if [[ -n "$report" ]]; then echo "Crash report: $report"; fi
    return 1
  fi
  local report
  report="$(find_new_crash_report)"
  if [[ -n "$report" ]]; then
    echo "New crash report detected: $report"
    return 1
  fi
}

open "$app_path"
for _ in {1..30}; do
  pid="$(pgrep -f "$app_path/Contents/MacOS/" | head -n 1 || true)"
  if [[ -n "$pid" ]]; then break; fi
  sleep 1
done
if [[ -z "$pid" ]]; then
  echo "App process did not start"
  exit 1
fi

# A live process is insufficient: verify that WindowServer reports a sizeable,
# on-screen layer-zero window for this exact process.
swift - "$pid" <<'SWIFT'
import CoreGraphics
import Foundation

let expectedPid = Int(CommandLine.arguments[1])!
for _ in 0..<30 {
  let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
  ) as? [[String: Any]] ?? []
  let visible = windows.contains { window in
    let ownerPid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.intValue
    let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue
    guard ownerPid == expectedPid, layer == 0,
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let width = (bounds["Width"] as? NSNumber)?.doubleValue,
          let height = (bounds["Height"] as? NSNumber)?.doubleValue else { return false }
    return width >= 400 && height >= 300
  }
  if visible { exit(0) }
  Thread.sleep(forTimeInterval: 1)
}
fputs("No visible application window found\n", stderr)
exit(1)
SWIFT

diagnostics=""
ready=false
for _ in {1..30}; do
  assert_process_healthy
  diagnostics="$(find "$HOME/Library/Logs" "$HOME/Library/Application Support" -name startup-diagnostics.jsonl -type f -print -quit 2>/dev/null || true)"
  first_new_line=1
  if [[ "$diagnostics" == "$existing_diagnostics" ]]; then
    first_new_line=$((baseline_lines + 1))
  fi
  if [[ -n "$diagnostics" ]] && tail -n "+$first_new_line" "$diagnostics" | grep -q '"phase":"frontend-ready"'; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo "Frontend readiness marker was not written"
  if [[ -n "$diagnostics" ]]; then tail -n 20 "$diagnostics"; fi
  exit 1
fi

# A frontend-ready marker is only meaningful if the native process remains
# healthy afterwards. Catch immediate post-start crashes before accepting it.
survival_seconds=10
for ((second = 0; second < survival_seconds; second += 1)); do
  assert_process_healthy
  sleep 1
done
assert_process_healthy

echo "macOS startup smoke passed: visible window, frontend-ready, and ${survival_seconds}s survival"
