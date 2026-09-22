// Vorm zonder rand na laden (#431).
//
// Eigen bestanden: de saver schrijft een vorm zonder rand ("geen rand" in de
// lijnkleurkiezer) zonder randkleur, met /BS /W 0 en met de eigen sleutel
// /OPS_NoStroke << /W lijndikte /C kleur >> (zie markeerZonderRand in
// saver/utils.js). Daaruit komen de lijndikte-instelling en de eigen kleur
// terug; color-extraction.js zet ze in `opsNoStroke`.
//
// Bestanden uit een andere lezer: /BS /W 0 (of /Border [.. .. 0]) zonder
// randkleur — /C ontbreekt of is leeg, bij FreeText de /IC — betekent dat elke
// lezer de vorm zonder omtrek tekent. color-extraction.js zet dan
// `borderWidth: 0` en `geenRandkleur: true`.
//
// Geeft de velden die het model overneemt, of null als de vorm een rand heeft.
export function randloosUitExtra(extra) {
  if (!extra) return null;
  if (extra.opsNoStroke) {
    const uit = { strokeColor: 'none', lineWidth: extra.opsNoStroke.lijndikte ?? extra.borderWidth ?? 0 };
    if (extra.opsNoStroke.kleur) uit.color = extra.opsNoStroke.kleur;
    return uit;
  }
  if (extra.borderWidth === 0 && extra.geenRandkleur) return { strokeColor: 'none', lineWidth: 0 };
  return null;
}
