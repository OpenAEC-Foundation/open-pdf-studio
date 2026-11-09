#!/usr/bin/env bash
# Detached OpenPGP signatures for the Linux release assets (#842).
#
#   sign-linux-release.sh sign    <asset-dir> <public-key.asc>
#   sign-linux-release.sh verify  <asset-dir> <public-key.asc>
#   sign-linux-release.sh release <tag>       <public-key.asc>
#
# sign: signs every .deb, .AppImage and .snap in <asset-dir> with the OpenAEC
# release key (<file>.asc, ASCII-armoured), writes SHA256SUMS over those files
# plus the AppImage updater bundle (.AppImage.tar.gz), signs it as
# SHA256SUMS.asc and then runs `verify` on the result.
#
# verify: checks every package and SHA256SUMS in <asset-dir> with gpgv against
# <public-key.asc> only (a fresh keyring, nothing else trusted), requires a
# signature for every .deb, .AppImage and .snap that is present, and checks
# the SHA256SUMS entries against the files.
#
# release: downloads the Linux assets of the GitHub release <tag> (draft or
# published; gh reads GH_TOKEN and GH_REPO), runs `sign`, uploads the .asc
# files, SHA256SUMS, the public key and its fingerprint with --clobber, then
# downloads them again and runs `verify` on what the release now serves.
#
# Environment for `sign` and `release`:
#   OPENAEC_GPG_PRIVATE_KEY   armoured secret key (the signing subkey is enough)
#   OPENAEC_GPG_PASSPHRASE    its passphrase (optional)
#   OPENAEC_GPG_FINGERPRINT   organisation variable; when set it must equal the
#                             expected fingerprint
#   OPENAEC_GPG_EXPECTED_FINGERPRINT
#                             trusted primary key fingerprint; defaults to the
#                             OpenAEC release key below (tests use their own)
#
# Without OPENAEC_GPG_PRIVATE_KEY, `sign` and `release` sign nothing, print a
# notice and exit 0 (forks, pull requests, local builds). The Tauri updater
# signatures (.sig) and latest.json are never touched.
#
# Results go to $GITHUB_OUTPUT when set: status=signed|skipped,
# signed=<names>, missing=<formats without a file>.
set -euo pipefail

OPENAEC_RELEASE_KEY_FINGERPRINT=13F6D414ADEE4ED4CD09AC60601D86C93C504D29
LINUX_PATTERNS=(--pattern '*.deb' --pattern '*.AppImage' --pattern '*.AppImage.tar.gz' --pattern '*.snap')

usage="usage: sign-linux-release.sh sign|verify <asset-dir> <public-key.asc> | release <tag> <public-key.asc>"
mode=${1:?$usage}
target=${2:?$usage}
pubkey=${3:?$usage}
expected=${OPENAEC_GPG_EXPECTED_FINGERPRINT:-$OPENAEC_RELEASE_KEY_FINGERPRINT}
expected=$(printf '%s' "$expected" | tr -d ' ' | tr '[:lower:]' '[:upper:]')

output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
  printf '%s=%s\n' "$1" "$2"
}

[[ -f "$pubkey" ]] || { echo "public key not found: $pubkey" >&2; exit 1; }
pubkey=$(cd "$(dirname "$pubkey")" && pwd)/$(basename "$pubkey")

# Short path under /tmp: gpg-agent sockets fail on long paths.
work=$(mktemp -d)
cleanup() {
  GNUPGHOME="$work/sign" gpgconf --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir "$work/sign" "$work/verify"
chmod 700 "$work/sign" "$work/verify" 2>/dev/null || true

# Primary key fingerprints in gpg --with-colons output (one per line).
primary_fingerprints() {
  awk -F: '$1 == "pub" || $1 == "sec" { want = 1; next }
           $1 == "fpr" && want { print $10; want = 0 }
           $1 == "sub" || $1 == "ssb" { want = 0 }'
}

check_public_key() {
  local found
  found=$(GNUPGHOME="$work/verify" gpg --batch --with-colons --show-keys "$pubkey" 2>/dev/null | primary_fingerprints)
  if [[ "$found" != "$expected" ]]; then
    echo "::error::$pubkey has primary fingerprint '${found:-none}', expected $expected." >&2
    exit 1
  fi
  GNUPGHOME="$work/verify" gpg --batch --yes --dearmor --output "$work/verify/release-key.gpg" "$pubkey"
}

verify_dir() {
  local dir=$1 count=0 file
  check_public_key
  shopt -s nullglob
  local packages=("$dir"/*.deb "$dir"/*.AppImage "$dir"/*.snap)
  shopt -u nullglob
  for file in "${packages[@]}" "$dir/SHA256SUMS"; do
    if [[ ! -f "$file" || ! -f "$file.asc" ]]; then
      echo "::error::$(basename "$file") or its .asc signature is missing in $dir." >&2
      exit 1
    fi
    GNUPGHOME="$work/verify" gpgv --keyring "$work/verify/release-key.gpg" "$file.asc" "$file"
    echo "verified $(basename "$file").asc"
    count=$((count + 1))
  done
  (cd "$dir" && sha256sum --check --strict SHA256SUMS)
  if (( count < 2 )); then
    echo "::error::No Linux package signature verified in $dir." >&2
    exit 1
  fi
  echo "verified $count OpenPGP signature(s) against $expected"
}

have_secret() {
  if [[ -z "${OPENAEC_GPG_PRIVATE_KEY:-}" ]]; then
    echo "::notice::OPENAEC_GPG_PRIVATE_KEY is not available (fork, pull request or local build): the Linux packages and SHA256SUMS are not OpenPGP-signed."
    output status skipped
    return 1
  fi
}

sign_dir() {
  local dir=$1 org_fpr imported passfile file ext found
  org_fpr=$(printf '%s' "${OPENAEC_GPG_FINGERPRINT:-}" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
  if [[ -n "$org_fpr" && "$org_fpr" != "$expected" ]]; then
    echo "::error::OPENAEC_GPG_FINGERPRINT ($org_fpr) differs from the expected release key $expected." >&2
    exit 1
  fi

  printf '%s\n' "$OPENAEC_GPG_PRIVATE_KEY" | GNUPGHOME="$work/sign" gpg --batch --quiet --import
  imported=$(GNUPGHOME="$work/sign" gpg --batch --with-colons --list-secret-keys | primary_fingerprints | sort -u)
  if [[ "$imported" != "$expected" ]]; then
    echo "::error::The imported secret key has primary fingerprint '${imported:-none}', expected $expected." >&2
    exit 1
  fi

  passfile="$work/passphrase"
  (umask 077 && printf '%s' "${OPENAEC_GPG_PASSPHRASE:-}" > "$passfile")
  sign_file() {
    GNUPGHOME="$work/sign" gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passfile" \
      --local-user "$expected" --armor --detach-sign --output "$1.asc" "$1"
  }

  shopt -s nullglob
  local packages=("$dir"/*.deb "$dir"/*.AppImage "$dir"/*.snap)
  local updater=("$dir"/*.AppImage.tar.gz)
  shopt -u nullglob
  if (( ${#packages[@]} == 0 )); then
    echo "::error::No .deb, .AppImage or .snap in $dir." >&2
    exit 1
  fi

  local missing=() signed=()
  for ext in deb AppImage snap; do
    found=0
    for file in "${packages[@]}"; do
      [[ "$file" == *".$ext" ]] && found=1
    done
    (( found )) || missing+=("$ext")
  done

  for file in "${packages[@]}"; do
    sign_file "$file"
    signed+=("$(basename "$file")")
    echo "signed $(basename "$file")"
  done

  (
    cd "$dir"
    for file in "${packages[@]}" "${updater[@]}"; do
      basename "$file"
    done | LC_ALL=C sort | while IFS= read -r name; do
      # sha256sum writes "hash *name" in binary mode on some platforms; always
      # write the two-space form that `sha256sum --check` reads everywhere.
      hash=$(sha256sum -- "$name" | awk '{ print $1 }' | tr -d '\\')
      printf '%s  %s\n' "$hash" "$name"
    done > SHA256SUMS
  )
  sign_file "$dir/SHA256SUMS"
  signed+=(SHA256SUMS)
  echo "signed SHA256SUMS"

  verify_dir "$dir"

  output status signed
  output signed "${signed[*]}"
  output missing "${missing[*]:-}"
  if (( ${#missing[@]} )); then
    echo "::warning::No ${missing[*]} file was available to sign."
  fi
}

case "$mode" in
  verify)
    [[ -d "$target" ]] || { echo "asset directory not found: $target" >&2; exit 1; }
    verify_dir "$target"
    ;;
  sign)
    [[ -d "$target" ]] || { echo "asset directory not found: $target" >&2; exit 1; }
    have_secret || exit 0
    sign_dir "$target"
    ;;
  release)
    have_secret || exit 0
    assets="$work/assets"
    check="$work/check"
    mkdir "$assets" "$check"
    gh release download "$target" --dir "$assets" "${LINUX_PATTERNS[@]}"
    ls -l "$assets"
    sign_dir "$assets"
    cp "$pubkey" "$assets/openaec-signing-public-key.asc"
    printf '%s\n' "$expected" > "$assets/openaec-signing-fingerprint.txt"
    gh release upload "$target" "$assets"/*.asc "$assets/SHA256SUMS" \
      "$assets/openaec-signing-fingerprint.txt" --clobber
    # Check what the release serves now, not the local copies.
    gh release download "$target" --dir "$check" "${LINUX_PATTERNS[@]}" \
      --pattern '*.asc' --pattern 'SHA256SUMS'
    verify_dir "$check"
    ;;
  *)
    echo "$usage" >&2
    exit 1
    ;;
esac
