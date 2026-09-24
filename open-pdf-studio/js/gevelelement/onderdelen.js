// Selectiemodel van een gevelelement: welke onderdelen er zijn, in welke
// volgorde Tab ze afloopt, en welk onderdeel onder de aanwijzer ligt.
//
// Een klik selecteert het element als geheel (onderdeel = null). Tab loopt
// daarna door de onderdelen — eerst alle stijlen van begin tot eind (het
// beginkader, de tussenstijlen, het eindkader), dan alle panelen — en na het
// laatste weer terug naar het geheel. Shift+Tab loopt dezelfde ring achteruit.
// Staat de aanwijzer boven het element, dan begint de eerste Tab bij het
// onderdeel onder de aanwijzer.
//
// Een onderdeel is { soort: 'stijl' | 'paneel', index }; stijl 0 is het
// beginkader, stijl n het eindkader, paneel i zit in veld i (zie indeling.js).
//
// Puur: werkt op de indeling uit indeling.js.

/** Alle onderdelen in Tab-volgorde. */
export function onderdelen(lay) {
  const uit = [];
  for (const s of lay.stijlen) uit.push({ soort: 'stijl', index: s.index });
  for (const v of lay.velden) uit.push({ soort: 'paneel', index: v.index });
  return uit;
}

export function zelfdeOnderdeel(a, b) {
  if (!a || !b) return !a && !b;
  return a.soort === b.soort && a.index === b.index;
}

/** Het onderdeel als het (nog) bestaat in deze indeling, anders null. */
export function geldigOnderdeel(lay, sub) {
  if (!sub || (sub.soort !== 'stijl' && sub.soort !== 'paneel')) return null;
  const lijst = sub.soort === 'stijl' ? lay.stijlen : lay.velden;
  return Number.isInteger(sub.index) && sub.index >= 0 && sub.index < lijst.length
    ? { soort: sub.soort, index: sub.index } : null;
}

/**
 * Het volgende onderdeel voor Tab (`richting` 1) of Shift+Tab (-1).
 * `huidig` null = het geheel is geselecteerd; `onderAanwijzer` is het
 * onderdeel onder de muis (of null) en geldt alleen vanuit het geheel.
 * Geeft null terug als de ring weer bij het geheel uitkomt.
 */
export function volgendOnderdeel(lay, huidig, richting = 1, onderAanwijzer = null) {
  const lijst = onderdelen(lay);
  if (!lijst.length) return null;
  const stap = richting < 0 ? -1 : 1;
  const nu = geldigOnderdeel(lay, huidig);
  if (!nu) {
    const start = geldigOnderdeel(lay, onderAanwijzer);
    if (start) return start;
    return stap > 0 ? lijst[0] : lijst[lijst.length - 1];
  }
  const i = lijst.findIndex((o) => zelfdeOnderdeel(o, nu));
  const j = i + stap;
  return j < 0 || j >= lijst.length ? null : lijst[j];
}

/**
 * Het onderdeel op positie `uMm` langs het element (0 = begin). Een stijl
 * wint binnen zijn eigen breedte, met `marge` mm speling (bij een dunne stijl
 * op een kleine schaal wil je hem toch kunnen raken); daarbuiten het paneel
 * van het veld. Buiten het element: null.
 */
export function onderdeelOp(lay, uMm, marge = 0) {
  if (!(uMm >= -marge) || uMm > lay.lengteMm + marge) return null;
  let beste = null;
  for (const s of lay.stijlen) {
    const afstand = uMm < s.vanMm ? s.vanMm - uMm : (uMm > s.totMm ? uMm - s.totMm : 0);
    if (afstand <= marge && (!beste || afstand < beste.afstand)) beste = { afstand, index: s.index };
  }
  if (beste) return { soort: 'stijl', index: beste.index };
  const v = lay.velden.find((f) => uMm >= f.dagVanMm && uMm <= f.dagTotMm);
  return v ? { soort: 'paneel', index: v.index } : null;
}

/** Wat kun je met dit onderdeel? Stuurt menu's en het eigenschappenpaneel. */
export function mogelijkheden(lay, sub) {
  const o = geldigOnderdeel(lay, sub);
  if (!o) return { verschuiven: false, verwijderen: false, wisselStijl: false, wisselPaneel: false };
  if (o.soort === 'paneel') return { verschuiven: false, verwijderen: false, wisselStijl: false, wisselPaneel: true };
  const tussen = o.index > 0 && o.index < lay.stijlen.length - 1;
  return { verschuiven: tussen, verwijderen: tussen, wisselStijl: true, wisselPaneel: false };
}
