// localStorage-spiegel van de voorkeuren — pure module, geen app-imports.
//
// De spiegel heeft twee lezers met heel verschillende behoeften (#353):
// 1. Het synchrone theme-script in index.html leest vóór de app-boot ALLEEN
//    `theme` (anders flitst het verkeerde thema).
// 2. Buiten Tauri (browser/dev) is localStorage de échte opslag en moet het
//    volledige object erin; binnen Tauri is het bestand de waarheid en is
//    het volledige object spiegelen juist het risico: gedownloade symbool-
//    collecties duwden de spiegel over het ~5 MB-quotum, waarna de worp uit
//    localStorage.setItem ook de bestandsopslag blokkeerde.
export function preferencesMirrorJson(prefs, inTauri) {
  if (inTauri) {
    return JSON.stringify({ theme: prefs?.theme });
  }
  return JSON.stringify(prefs);
}
