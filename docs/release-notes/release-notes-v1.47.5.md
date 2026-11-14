## 🇳🇱 Nederlands

### Belangrijkste verbeteringen in v1.47.5

- **CAD-pariteit**: scale region, hatch patterns, parametrische symbolen, vergelijken-tool en uitgebreide snap-modi (eindpunten, middens, perpendiculair, intersecties).
- **Polyline-tool**: vertex-drag, close-contour-snap met visuele indicator, plugin snapHook met `priorPoints`, plugin-types blijven actief na voltooien.
- **Plugin API**: `getAnnotations` en `getPageCount` voor dashboard-plugins, generieke `applyMove` / `applyResize` voor plugin annotation-types met `{x,y,w,h}`.
- **Rendering**: dichtere dashed-patronen, butt line caps, krappere textbox padding — visueel afgestemd op gangbare PDF-editors.
- **Compare**: oude pagina niet meer dubbel renderen, detectie-raster gecached → merkbaar sneller.
- **Linux**: vriendelijkere `xdg-mime`-foutmeldingen bij instellen default PDF-handler, fix voor custom `<select>` op Chromium dark-theme, Linux Mint compatibiliteit.
- **Installer**: `WebView2Loader.dll` correct gebundeld in NSIS-installer (system + user variant).
- **Nightly builds**: dagelijkse rolling prerelease via GitHub Actions.

### Bug fixes

- Callout dotted-border crash (TDZ) opgelost.
- Dispatcher dubbelklik wordt nu doorgestuurd met `detail=2`.
- Thumbnails: generation-token guard + overlay-render errors gelogd.
- Polyline + contextmenu: eerste rechtermuisklik sluit polyline zonder menu.

---

## 🇬🇧 English

### Highlights in v1.47.5

- **CAD parity**: scale-region tool, hatch patterns, parametric symbols, compare tool, and expanded snapping (endpoints, midpoints, perpendicular, intersections).
- **Polyline tool**: vertex drag, close-contour snap with visual indicator, plugin `snapHook` receives `priorPoints`, plugin types stay active after finishing.
- **Plugin API**: `getAnnotations` and `getPageCount` exposed to dashboard plugins, generic `applyMove` / `applyResize` for plugin annotation types using `{x,y,w,h}`.
- **Rendering polish**: denser dashed patterns, butt line caps, tighter textbox padding — visually aligned with mainstream PDF editors.
- **Compare**: dropped redundant OLD-page render and cached detection rasters → noticeably faster.
- **Linux**: friendlier `xdg-mime` errors when setting the default PDF handler, custom `<select>` rendering fix on Chromium dark theme, Linux Mint compatibility.
- **Installer**: `WebView2Loader.dll` correctly bundled into the NSIS installer (system + user variants).
- **Nightly builds**: daily rolling prerelease via GitHub Actions.

### Bug fixes

- Callout dotted-border crash (TDZ) resolved.
- Dispatcher now forwards double-clicks with `detail=2`.
- Thumbnails: generation-token guard + overlay-render errors are logged.
- Polyline + context menu: first right-click closes polyline without showing menu.

### Downloads

- **Windows (System)**: `*_x64-setup.exe` — system-wide install, requires admin.
- **Windows (User)**: `*_x64_user-setup.exe` — current user only, no admin.
- **macOS**: `.dmg` — universal (Intel + Apple Silicon).
- **Linux**: `.deb`, `.AppImage`, `.snap` (also on the [Snap Store](https://snapcraft.io/open-pdf-studio)).
