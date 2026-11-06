# Managed deployments

When the app runs in a centrally managed environment, such as one container per
user, start it with the environment variable `OPENAEC_BEHEERD=1` (`true`, `yes`
and `on` work too). The app then starts without one-time prompts:

- no "make Open PDF Studio the default PDF app" bar (and no registry or
  `xdg-mime` lookup for it);
- no "What's new" dialog after an update, and no request for the release notes;
- no update check or update dialog; *Check for Updates* and *Previous version*
  only say that updates are managed centrally. The updater plugin is not even
  registered.

Without the variable, or with any other value, nothing changes. The recovery
offer after an unexpected shutdown stays, because it protects unsaved work.

## Environment variables

All optional; without them nothing changes.

| Variable | Effect |
|---|---|
| `OPENAEC_MAP=/openaec` | Open and save dialogs start in this existing, absolute folder. A relative start argument (`AppRun file.pdf`) falls back to it. |
| `OPENAEC_MCP_POORT`, `OPENAEC_MCP_GEHEIM` | Start the MCP server (AI connection) on that port. Every request needs `Authorization: Bearer <secret>` (at least 16 characters); requests with an `Origin` header (browsers) are refused. The secret is removed from the environment at startup, so child processes do not inherit it. |
| `OPENAEC_MCP_ADRES` | Bind address of that server. Default `0.0.0.0` in managed mode (the internal container network), otherwise `127.0.0.1`. |
| `OPENAEC_SOFTWARE_RENDERING=1` / `0` | Force or forbid the WebKitGTK software-rendering settings. Without it the app sets them only on Linux without a GPU render node (`/dev/dri/renderD*`). |
| `OPDS_GDK_BACKEND` | GDK backend to use from the AppImage (its GTK hook overwrites `GDK_BACKEND`). In managed mode, or without an X display, the AppImage prefers Wayland. |

## Shutdown and FUSE

In a container or in managed mode, `SIGTERM` writes recovery files for unsaved
work (at most 5 seconds) and then exits cleanly. The extracted AppImage
(`--appimage-extract`, then `squashfs-root/AppRun [file.pdf]`) runs without FUSE.

## More

- The full contract for OpenAEC Linux, including host libraries and the
  verification in CI: [docs/openaec-linux.md](openaec-linux.md).
- Every network connection the app can make: [PRIVACY.md](../PRIVACY.md).
- Windows: silent install switches and winget manifests in
  [docs/windows-distribution.md](windows-distribution.md); the portable version in
  [docs/portable-windows.md](portable-windows.md).
- The web bundle for hosting the app on your own platform is attached to every
  release as `open-pdf-studio-web-<version>.tar.gz`.
