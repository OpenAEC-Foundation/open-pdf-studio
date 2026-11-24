// Het nulpunt van de coördinaatlabels (Coördinaat, tab Tekenen), per pagina.
//
// Zonder nulpunt tellen de labels vanaf de linkerbovenhoek van het blad met
// y naar beneden. Met een nulpunt (een punt op het blad, in app-ruimte) tellen
// ze vanaf dat punt, met y naar boven zoals in CAD. Het punt hoeft geen (0, 0)
// te zijn: `wx` en `wy` zijn de waarden van dat punt in meeteenheden (bijv.
// een RD-coördinaat); de labels tellen daar vanaf. Puur: geen app-state.

/**
 * Een geldig nulpunt of null.
 * @param {*} v
 * @returns {{x:number, y:number, yUp:boolean, wx:number, wy:number} | null}
 */
export function normaliseerNulpunt(v) {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return {
    x: Number(v.x), y: Number(v.y), yUp: v.yUp !== false,
    wx: Number.isFinite(v.wx) ? Number(v.wx) : 0,
    wy: Number.isFinite(v.wy) ? Number(v.wy) : 0,
  };
}

/** Het nulpunt van een pagina uit `doc.coordOrigins`, of null (dan telt de oude regel). */
export function paginaNulpunt(doc, pageNum) {
  return normaliseerNulpunt(doc?.coordOrigins?.[pageNum]);
}

/**
 * Plek op het blad naar coördinaten ten opzichte van het nulpunt, in
 * paginapunten (delen door de schaal geeft meeteenheden).
 * @param {number} x  app-ruimte
 * @param {number} y  app-ruimte
 * @param {{x:number, y:number, yUp:boolean} | null} nulpunt
 */
export function coordinaatTovNulpunt(x, y, nulpunt) {
  const n = normaliseerNulpunt(nulpunt);
  if (!n) return { x, y };
  return { x: x - n.x, y: n.yUp ? n.y - y : y - n.y };
}

/** Nulpunt linksonder van een pagina met deze hoogte (app-ruimte). */
export function nulpuntLinksonder(paginaHoogte) {
  return Number.isFinite(paginaHoogte) && paginaHoogte > 0 ? normaliseerNulpunt({ x: 0, y: paginaHoogte, yUp: true }) : null;
}

/**
 * Het nulpunt van het model uit de viewports van een pagina (de CAD-import
 * schrijft het in `/OPS_ModelMatrix`), of null als de onderlegger er geen
 * heeft.
 * @param {Array<{modelNulpunt?: {x:number, y:number}}> | undefined} viewports
 */
export function nulpuntUitOnderlegger(viewports) {
  const v = (viewports || []).find((vp) => vp?.modelNulpunt
    && Number.isFinite(vp.modelNulpunt.x) && Number.isFinite(vp.modelNulpunt.y));
  return v ? normaliseerNulpunt({ x: v.modelNulpunt.x, y: v.modelNulpunt.y, yUp: true }) : null;
}

/** Nulpunt in JSON `[x, y, yUp, wx, wy]` voor het bestand; null als er geen is. */
export function nulpuntNaarJson(nulpunt) {
  const n = normaliseerNulpunt(nulpunt);
  return n ? JSON.stringify([n.x, n.y, n.yUp ? 1 : 0, n.wx, n.wy]) : null;
}

/** Het omgekeerde van nulpuntNaarJson; null bij onleesbare tekst. */
export function nulpuntUitJson(tekst) {
  try {
    const a = JSON.parse(String(tekst ?? ''));
    return Array.isArray(a) && a.length >= 2 ? normaliseerNulpunt({ x: a[0], y: a[1], yUp: a[2] !== 0, wx: a[3], wy: a[4] }) : null;
  } catch {
    return null;
  }
}

/**
 * De nulpunten verhuizen mee als pagina's van plek wisselen (zoals de
 * schaalcontroles). `mapping`: oud paginanummer naar nieuw (of null).
 */
export function herschikNulpunten(nulpunten, mapping) {
  if (!nulpunten) return nulpunten;
  const uit = {};
  for (const [oud, waarde] of Object.entries(nulpunten)) {
    const nieuw = mapping?.[oud];
    if (nieuw != null && waarde) uit[nieuw] = waarde;
  }
  return uit;
}
