// Plakken bij de muis (#928): rekenwerk zonder DOM, zodat het in Node
// testbaar is. clipboard.js levert de muispositie op de pagina en de
// kaders van de geplakte kopieen; dit bestand rekent uit waar ze heen gaan.

/**
 * Omhullend kader van een lijst kaders {x, y, width, height}. Ongeldige
 * kaders (null, NaN) tellen niet mee. null als er geen geldig kader is.
 */
export function omhullendKader(kaders) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of kaders || []) {
    if (!b) continue;
    const { x, y, width, height } = b;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + width); y2 = Math.max(y2, y + height);
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Verschuiving die het midden van `kader` op `punt` legt. */
export function centreerVerschuiving(kader, punt) {
  if (!kader || !punt) return { dx: 0, dy: 0 };
  return {
    dx: punt.x - (kader.x + kader.width / 2),
    dy: punt.y - (kader.y + kader.height / 2),
  };
}

/** Ligt `punt` (paginaruimte) binnen een pagina van `maat` {breedte, hoogte}? */
export function puntOpPagina(punt, maat) {
  if (!punt || !maat) return false;
  if (!Number.isFinite(punt.x) || !Number.isFinite(punt.y)) return false;
  return punt.x >= 0 && punt.y >= 0 && punt.x <= maat.breedte && punt.y <= maat.hoogte;
}
