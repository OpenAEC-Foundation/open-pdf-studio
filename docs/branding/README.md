# Approved application logos

The PNG masters are the approved Snap Store logos. `icons.json` records their source URLs, SHA-256 checksums and all generated application assets. Transparency and the approved artwork are preserved.

Regenerate with Python 3 and Pillow installed:

```sh
python3 scripts/generate-approved-icons.py
```

Do not redraw these logos or replace them with the foundation symbol. Historical screenshots and unrelated third-party branding are not application icon sources.

`generate-approved-icons.py` copies the master unchanged wherever a 512 × 512 PNG is needed (app, Snap Store icon), so those files keep the approved checksum. The Windows installer artwork (`open-pdf-studio/src-tauri/nsis/art/*.bmp`) is drawn from the generated `icons/icon.png`; regenerate it afterwards with `python open-pdf-studio/src-tauri/nsis/art/generate-art.py` (Windows, needs the Segoe UI fonts).

`open-pdf-studio/scripts/goedgekeurd-logo.test.mjs` checks the master checksum, every generated asset, and that the app, installer and Linux packages only reference assets from `icons.json`.
