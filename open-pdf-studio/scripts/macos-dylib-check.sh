#!/usr/bin/env bash
# Fails when a macOS binary loads a library that is not part of macOS or of
# the app bundle itself.
#
# The macOS runner has Homebrew. A crate that finds a library there through
# pkg-config links it dynamically, and the shipped app then only starts on a
# Mac with that exact Homebrew package: 2026.42 crashed at launch with
# "Library not loaded: /opt/homebrew/*/liblcms2.2.dylib" (#750, #361). The
# startup smoke test on the runner cannot catch this, because there the
# library is present.
#
# Usage: macos-dylib-check.sh <App.app | Mach-O file>...
# Every Mach-O file (all architectures of a universal binary) is checked:
#   - each load command (otool -L) must be under /usr/lib/ or /System/, or
#     relative to the bundle (@rpath, @executable_path, @loader_path);
#   - no LC_RPATH may point into /opt/homebrew, /usr/local or /opt/local.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: macos-dylib-check.sh <App.app | Mach-O file>..." >&2
  exit 2
fi

is_macho() {
  local magic
  magic=$(od -An -tx1 -N4 "$1" 2>/dev/null | tr -d ' \n')
  case "$magic" in
    feedface|feedfacf|cefaedfe|cffaedfe|cafebabe|bebafeca) return 0 ;;
    *) return 1 ;;
  esac
}

files=()
for arg in "$@"; do
  if [[ -d "$arg" ]]; then
    while IFS= read -r -d '' f; do
      if is_macho "$f"; then files+=("$f"); fi
    done < <(find "$arg" -type f -print0)
  elif [[ -f "$arg" ]]; then
    if ! is_macho "$arg"; then
      echo "not a Mach-O file: $arg" >&2
      exit 1
    fi
    files+=("$arg")
  else
    echo "not found: $arg" >&2
    exit 1
  fi
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "no Mach-O files found in: $*" >&2
  exit 1
fi

failed=0
for f in "${files[@]}"; do
  # A dylib lists its own install name too; that is not a dependency.
  own_id=$(otool -D "$f" 2>/dev/null | sed -n '2p' | sed 's/^[[:space:]]*//' || true)
  echo "== $f"
  while IFS= read -r line; do
    case "$line" in
      [[:space:]]*) ;;
      *) continue ;; # "<file> (architecture x86_64):" header
    esac
    lib=$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]+//; s/ \(compatibility version.*$//')
    [[ -z "$lib" ]] && continue
    [[ -n "$own_id" && "$lib" == "$own_id" ]] && continue
    case "$lib" in
      /usr/lib/*|/System/*|@rpath/*|@executable_path/*|@loader_path/*)
        echo "   ok   $lib" ;;
      *)
        echo "   BAD  $lib" >&2
        failed=1 ;;
    esac
  done < <(otool -arch all -L "$f")

  rpaths=$(otool -arch all -l "$f" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' || true)
  while IFS= read -r rpath; do
    [[ -z "$rpath" ]] && continue
    case "$rpath" in
      /opt/homebrew*|/usr/local*|/opt/local*)
        echo "   BAD  LC_RPATH $rpath" >&2
        failed=1 ;;
      *)
        echo "   ok   LC_RPATH $rpath" ;;
    esac
  done <<< "$rpaths"
done

if [[ $failed -ne 0 ]]; then
  echo "macOS binaries reference libraries outside macOS and the app bundle (#750)." >&2
  echo "Link them statically (see lcms2 in open-pdf-cmyk/Cargo.toml)." >&2
  exit 1
fi

echo "OK: ${#files[@]} Mach-O file(s) only load system or bundled libraries"
