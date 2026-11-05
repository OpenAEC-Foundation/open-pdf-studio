// Padcontrole voor api.readAsset (#970): een bestand uit het eigen pakket van
// een extensie. Dezelfde regel als `read_plugin_asset` in src-tauri/src/lib.rs:
// relatief, geen `..`- of `.`-segment, geen absoluut pad, geen stationsletter
// of andere `:`, geen NUL, niet leeg. Zuivere module (draait onder node:test).

export function isVeiligAssetPad(pad) {
  if (typeof pad !== 'string' || !pad || pad.length > 512) return false;
  if (pad.includes('\0') || pad.includes(':')) return false;
  if (pad.startsWith('/') || pad.startsWith('\\')) return false;
  return pad.split(/[\\/]/).every((deel) => deel !== '..' && deel !== '.' && deel !== '');
}
