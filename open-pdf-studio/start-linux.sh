#!/bin/bash
# Start script for Linux - handles running as root

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -eq 0 ]; then
    # Running as root - add --no-sandbox flag
    "$DIR/web-pdf-editor" --no-sandbox "$@"
else
    # Running as normal user
    "$DIR/web-pdf-editor" "$@"
fi
