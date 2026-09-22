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
// `borderWidth: 0` en `geenRandkleur: true`, maar alleen als er zonder rand
// iets te zien blijft (tekst of een vulling): een onzichtbaar vlak houdt zijn
// hulplijn in de app.
//
// Onzichtbaar vlak (#435): het bestand zegt UITDRUKKELIJK lijndikte 0
// (/BS /W 0 of /Border [.. .. 0]), geeft geen randkleur en geen vulling. Zo
// schrijft een tekenpakket zijn doorzoekbare tekst weg; elke lezer toont niets.
// De app tekent er een dunne hulplijn omheen zodat het vlak vindbaar blijft
// (hierboven: zo'n vlak komt niet randloos terug), maar de saver mag geen
// streek in de appearance zetten — anders is het vlak na opslaan overal
// zichtbaar.
//
// De lijndikte MOET uit het bestand komen: ontbreken /BS en /Border allebei,
// dan meldt de lezer ook lijndikte 0 terwijl de vorm een gewone rand in zijn
// appearance heeft. Daarom `extra.borderWidth === 0` (alleen gezet als het
// bestand het zelf zegt) en niet de lijndikte uit het model.
export function onzichtbaarVlakUitExtra(extra) {
  return !!extra && extra.borderWidth === 0 && extra.randkleurOntbreekt === true && !extra.ic;
}

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
