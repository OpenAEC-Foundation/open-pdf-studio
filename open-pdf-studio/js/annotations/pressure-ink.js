// Drukgevoelige inkt met gladde streken (#385).
//
// Pure geometrie, zonder app-imports: onder node te testen en door het
// scherm (rendering.js), de saver (appearance-stream) en het gereedschap
// (draw-tool.js) gedeeld, zodat het scherm en het bestand dezelfde streek
// tonen.
//
// Het model van een vrije-handstreek ('draw'):
// - path            de middellijn zoals hij ingevoerd is (ook /InkList);
// - pressures       optioneel: de pendruk 0..1 per punt van path (alleen bij
//                   een pen; een muis of vinger geeft een vaste breedte);
// - lineWidth       de grootste breedte (bij volle druk);
// - inkMinWidth     de breedte bij druk 0, in procenten van lineWidth;
// - inkSmoothing    gladheid 0..100 (0 = de oude kale polylijn);
// - inkPressure     false zet de druk uit zonder hem weg te gooien.
//
// De breedte per punt: lineWidth × (min + (1 − min) × druk). Gladmaken:
// eerst een fasevrij exponentieel filter (voor- én achteruit, zodat de streek
// niet achter de pen aanloopt en begin en eind blijven liggen), dan een
// centripetale Catmull-Rom-spline door de gefilterde punten. Een streek met
// variabele breedte wordt een gevulde omtrek: ringen met ronde kappen, alle
// met dezelfde omloop, zodat de nonzero-vulregel ze samenvoegt. Een scherpe
// hoek en een stuk waar de binnenkant zou omslaan (een krappe bocht smaller
// dan de streek) worden een eigen ring, zodat er nooit gaten of uitschieters
// ontstaan.

export const INK_STANDAARD = Object.freeze({
  minBreedtePct: 30,
  gladheid: 50,
});

const EPS = 1e-6;

/** Druk naar 0..1; een ontbrekende of ongeldige waarde is de helft (de waarde die een browser zonder druk meldt). */
export function klemDruk(p) {
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5;
}

/** Minimale breedte in procenten, 5..100 (geheel getal). */
export function klemMinBreedte(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return INK_STANDAARD.minBreedtePct;
  return Math.round(Math.min(100, Math.max(5, n)));
}

/** Gladheid 0..100 (geheel getal). */
export function klemGladheid(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return INK_STANDAARD.gladheid;
  return Math.round(Math.min(100, Math.max(0, n)));
}

/** De breedte bij een druk: lineWidth × (min + (1 − min) × druk). */
export function breedteUitDruk(druk, maxBreedte, minPct = INK_STANDAARD.minBreedtePct) {
  const max = Number.isFinite(maxBreedte) && maxBreedte > 0 ? maxBreedte : 2;
  const min = klemMinBreedte(minPct) / 100;
  return max * (min + (1 - min) * klemDruk(druk));
}

/** Heeft deze streek een bruikbare druk per punt (en staat de druk aan)? */
export function heeftDruk(ann) {
  return !!ann && ann.inkPressure !== false
    && Array.isArray(ann.path) && Array.isArray(ann.pressures)
    && ann.path.length > 0 && ann.pressures.length === ann.path.length;
}

/** Tekent deze streek anders dan de oude kale polylijn? */
export function isGladdeInkt(ann) {
  return heeftDruk(ann) || klemGladheid(ann?.inkSmoothing ?? 0) > 0;
}

/**
 * De drukreeks zoals hij in het model komt: null als er niets te variëren
 * valt (een muis meldt 0,5 of 0, een pen zonder druksensor steeds hetzelfde),
 * anders afgerond op drie decimalen.
 */
export function drukReeksVoorOpslag(pressures, aantalPunten) {
  if (!Array.isArray(pressures) || pressures.length === 0) return null;
  if (aantalPunten !== undefined && pressures.length !== aantalPunten) return null;
  let min = Infinity, max = -Infinity;
  const uit = pressures.map((p) => {
    const k = Math.round(klemDruk(p) * 1000) / 1000;
    if (k < min) min = k;
    if (k > max) max = k;
    return k;
  });
  return max - min < 0.02 ? null : uit;
}

/**
 * De inkt-eigenschappen van een nieuwe streek: gladheid altijd; druk en
 * minimale breedte alleen bij een pen met echte drukvariatie (een muis en
 * een pen zonder druksensor houden een vaste breedte).
 * @param {object} prefs  state.preferences
 * @param {{metDruk:boolean, drukken:number[]}|null} streek
 * @param {number} aantalPunten  het aantal punten van path
 */
export function inktEigenschappen(prefs, streek, aantalPunten) {
  const uit = { inkSmoothing: klemGladheid(prefs?.drawSmoothing ?? INK_STANDAARD.gladheid) };
  const drukken = streek?.metDruk ? drukReeksVoorOpslag(streek.drukken, aantalPunten) : null;
  if (drukken) {
    uit.pressures = drukken;
    uit.inkMinWidth = klemMinBreedte(prefs?.drawPressureMinWidth ?? INK_STANDAARD.minBreedtePct);
  }
  return uit;
}

/**
 * Of een aanwijzer druk meldt die de breedte mag sturen. Alleen een pen:
 * een muis is altijd constant (de browser meldt 0,5 bij ingedrukte knop) en
 * een vinger meldt meestal een vaste of geen druk.
 */
export function aanwijzerMetDruk(pointerType) {
  return pointerType === 'pen';
}

/**
 * De monsters van één pointermove: met getCoalescedEvents alle tussenliggende
 * metingen (een pen meet 120–240 keer per seconde, de browser bundelt ze per
 * beeldframe), anders het event zelf.
 * @returns {{clientX:number, clientY:number, pressure:number}[]}
 */
export function monstersVanEvent(e) {
  let lijst = null;
  try {
    if (e && typeof e.getCoalescedEvents === 'function') lijst = e.getCoalescedEvents();
  } catch (_) { lijst = null; }
  if (!lijst || lijst.length === 0) lijst = [e];
  return lijst.map((m) => ({ clientX: m.clientX, clientY: m.clientY, pressure: m.pressure }));
}

// ── Palmafwijzing ───────────────────────────────────────────────────────────

/**
 * Palmafwijzing: zolang een pen in de buurt is (zweven of schrijven, tot
 * `nawerking` ms na het laatste pen-event), telt een aanraking niet mee voor
 * het tekenen; met `alleenPen` nooit. Een tweede aanwijzer tijdens een streek
 * wordt altijd genegeerd.
 */
export function maakPalmFilter({ nawerking = 600 } = {}) {
  let laatstePen = -Infinity;
  return {
    noteer(e, nu) {
      if (e && e.pointerType === 'pen') laatstePen = nu;
    },
    weiger(e, nu, { alleenPen = false } = {}) {
      if (!e || e.pointerType !== 'touch') return false;
      if (alleenPen) return true;
      return nu - laatstePen <= nawerking;
    },
    reset() { laatstePen = -Infinity; },
  };
}

// ── Gladmaken ───────────────────────────────────────────────────────────────

/** Punten (met hun waarde) zonder (bijna) dubbele opvolgers. */
export function zonderDubbele(punten, waarden, minAfstand = 1e-3) {
  const p = [], w = [];
  for (let i = 0; i < punten.length; i++) {
    const q = punten[i];
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    const vorige = p[p.length - 1];
    if (vorige && Math.hypot(q.x - vorige.x, q.y - vorige.y) < minAfstand) {
      // Dezelfde plek: de grootste breedte blijft.
      w[w.length - 1] = Math.max(w[w.length - 1], waarden[i]);
      continue;
    }
    p.push({ x: q.x, y: q.y });
    w.push(waarden[i]);
  }
  return { punten: p, waarden: w };
}

/**
 * Fasevrij exponentieel filter: één keer vooruit, één keer achteruit, het
 * gemiddelde. Begin- en eindpunt blijven liggen. Sterkte 0..100.
 */
export function gladFilter(reeks, sterkte) {
  const n = reeks.length;
  const k = (klemGladheid(sterkte) / 100) * 0.85; // gewicht van het vorige punt
  if (n < 3 || k <= 0) return reeks.slice();
  const vooruit = new Array(n), achteruit = new Array(n);
  vooruit[0] = reeks[0];
  for (let i = 1; i < n; i++) vooruit[i] = vooruit[i - 1] + (reeks[i] - vooruit[i - 1]) * (1 - k);
  achteruit[n - 1] = reeks[n - 1];
  for (let i = n - 2; i >= 0; i--) achteruit[i] = achteruit[i + 1] + (reeks[i] - achteruit[i + 1]) * (1 - k);
  const uit = new Array(n);
  uit[0] = reeks[0];
  uit[n - 1] = reeks[n - 1];
  for (let i = 1; i < n - 1; i++) uit[i] = (vooruit[i] + achteruit[i]) / 2;
  return uit;
}

/**
 * Centripetale Catmull-Rom door de punten, met de waarden lineair mee.
 * `stap` is de gewenste afstand tussen twee uitvoerpunten (paginapunten).
 */
export function catmullRom(punten, waarden, { stap = 1, maxPerSegment = 16 } = {}) {
  const n = punten.length;
  if (n < 3) return { punten: punten.map((p) => ({ x: p.x, y: p.y })), waarden: waarden.slice() };
  const P = (i) => {
    if (i < 0) return { x: 2 * punten[0].x - punten[1].x, y: 2 * punten[0].y - punten[1].y };
    if (i >= n) return { x: 2 * punten[n - 1].x - punten[n - 2].x, y: 2 * punten[n - 1].y - punten[n - 2].y };
    return punten[i];
  };
  const tj = (ti, a, b) => ti + Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), EPS);
  const lerp = (a, b, t0, t1, t) => {
    const d = t1 - t0;
    if (d < EPS) return { x: a.x, y: a.y };
    const u = (t - t0) / d;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  const uitP = [{ x: punten[0].x, y: punten[0].y }];
  const uitW = [waarden[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const delen = Math.max(1, Math.min(maxPerSegment, Math.ceil(len / stap)));
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let s = 1; s <= delen; s++) {
      const u = s / delen;
      let q;
      if (s === delen) q = { x: p2.x, y: p2.y };
      else {
        const t = t1 + (t2 - t1) * u;
        const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
        const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
        q = lerp(b1, b2, t1, t2, t);
      }
      uitP.push(q);
      uitW.push(waarden[i] + (waarden[i + 1] - waarden[i]) * u);
    }
  }
  return { punten: uitP, waarden: uitW };
}

/**
 * De middellijn zoals hij getekend wordt, met de breedte per punt.
 * @param {{x:number,y:number}[]} path
 * @param {number[]} breedtes  breedte per punt van path
 * @param {number} gladheid    0..100
 */
export function gladdeStreek(path, breedtes, gladheid, { stap = 1 } = {}) {
  const schoon = zonderDubbele(path || [], breedtes || []);
  const sterkte = klemGladheid(gladheid);
  if (sterkte <= 0 || schoon.punten.length < 3) return schoon;
  const xs = gladFilter(schoon.punten.map((p) => p.x), sterkte);
  const ys = gladFilter(schoon.punten.map((p) => p.y), sterkte);
  // De breedte iets minder glad dan de lijn: een drukaccent mag blijven.
  const ws = gladFilter(schoon.waarden, sterkte / 2);
  const gefilterd = zonderDubbele(xs.map((x, i) => ({ x, y: ys[i] })), ws);
  return catmullRom(gefilterd.punten, gefilterd.waarden, { stap });
}

/** De breedte per punt van de streek (vast als er geen druk is). */
export function breedtesVan(ann, { breedteFactor = 1 } = {}) {
  const max = (Number.isFinite(ann?.lineWidth) && ann.lineWidth > 0 ? ann.lineWidth : 2) * breedteFactor;
  const n = ann?.path?.length || 0;
  if (!heeftDruk(ann)) return new Array(n).fill(max);
  const minPct = ann.inkMinWidth ?? INK_STANDAARD.minBreedtePct;
  return ann.pressures.map((p) => breedteUitDruk(p, max, minPct));
}

// ── Omtrek ──────────────────────────────────────────────────────────────────

function cirkelRing(c, r, stappen) {
  const ring = [];
  for (let i = 0; i < stappen; i++) {
    const a = -(i / stappen) * Math.PI * 2; // zelfde omloop als de streekringen
    ring.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return ring;
}

function normalenVan(P, s, e) {
  const normalen = [];
  for (let i = s; i <= e; i++) {
    let tx = 0, ty = 0;
    if (i > s) {
      const d = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y) || 1;
      tx += (P[i].x - P[i - 1].x) / d; ty += (P[i].y - P[i - 1].y) / d;
    }
    if (i < e) {
      const d = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y) || 1;
      tx += (P[i + 1].x - P[i].x) / d; ty += (P[i + 1].y - P[i].y) / d;
    }
    let l = Math.hypot(tx, ty);
    if (l < EPS && i > s) {
      // Haarspeld: de inkomende richting.
      tx = P[i].x - P[i - 1].x; ty = P[i].y - P[i - 1].y; l = Math.hypot(tx, ty) || 1;
    }
    if (l < EPS) { tx = 1; ty = 0; l = 1; }
    normalen.push({ x: -ty / l, y: tx / l });
  }
  return normalen;
}

/** Het eerste segment (index k: k→k+1) waar een zijde van [s..e] terugloopt, of -1. */
function eersteOmslag(P, R, N, s, e) {
  for (let k = s; k < e; k++) {
    const dx = P[k + 1].x - P[k].x, dy = P[k + 1].y - P[k].y;
    const a = N[k - s], b = N[k + 1 - s];
    const lx = (P[k + 1].x + b.x * R[k + 1]) - (P[k].x + a.x * R[k]);
    const ly = (P[k + 1].y + b.y * R[k + 1]) - (P[k].y + a.y * R[k]);
    const rx = (P[k + 1].x - b.x * R[k + 1]) - (P[k].x - a.x * R[k]);
    const ry = (P[k + 1].y - b.y * R[k + 1]) - (P[k].y - a.y * R[k]);
    if (lx * dx + ly * dy <= 0 || rx * dx + ry * dy <= 0) return k;
  }
  return -1;
}

function streekRing(P, R, N, s, e, kapStappen) {
  const links = [], rechts = [];
  for (let i = s; i <= e; i++) {
    const n = N[i - s];
    links.push({ x: P[i].x + n.x * R[i], y: P[i].y + n.y * R[i] });
    rechts.push({ x: P[i].x - n.x * R[i], y: P[i].y - n.y * R[i] });
  }
  const ring = links.slice();
  // Eindkap: van links naar rechts om het eindpunt, door de looprichting.
  const ne = N[e - s], ae = Math.atan2(ne.y, ne.x);
  for (let j = 1; j < kapStappen; j++) {
    const a = ae - Math.PI * j / kapStappen;
    ring.push({ x: P[e].x + Math.cos(a) * R[e], y: P[e].y + Math.sin(a) * R[e] });
  }
  for (let i = rechts.length - 1; i >= 0; i--) ring.push(rechts[i]);
  // Beginkap: van rechts terug naar links om het beginpunt.
  const ns = N[0], as = Math.atan2(ns.y, ns.x);
  for (let j = 1; j < kapStappen; j++) {
    const a = as + Math.PI - Math.PI * j / kapStappen;
    ring.push({ x: P[s].x + Math.cos(a) * R[s], y: P[s].y + Math.sin(a) * R[s] });
  }
  return ring;
}

/**
 * De gevulde omtrek van een streek met variabele breedte: een lijst ringen
 * (gesloten veelhoeken) die samen, met de nonzero-regel gevuld, de streek
 * vormen. Elke ring heeft ronde kappen; alle ringen hebben dezelfde omloop.
 * @param {{x:number,y:number}[]} punten  middellijn
 * @param {number[]} breedtes             volle breedte per punt
 * @param {{scherpeHoek?:number, kapStappen?:number}} [opties]
 *   scherpeHoek: draaiing in graden waarboven de streek in twee ringen breekt
 * @returns {{x:number,y:number}[][]}
 */
export function omtrekRingen(punten, breedtes, { scherpeHoek = 100, kapStappen = 8 } = {}) {
  const schoon = zonderDubbele(punten || [], (breedtes || []).map((w) => (Number.isFinite(w) && w > 0 ? w : 0)));
  const P = schoon.punten;
  const R = schoon.waarden.map((w) => w / 2);
  const n = P.length;
  if (n === 0) return [];
  if (n === 1) return R[0] > 0 ? [cirkelRing(P[0], R[0], kapStappen * 2)] : [];

  // Breek bij scherpe hoeken: beide stukken eindigen rond in de hoek.
  const grens = Math.cos((scherpeHoek * Math.PI) / 180);
  const stukken = [];
  let begin = 0;
  for (let i = 1; i < n - 1; i++) {
    const ax = P[i].x - P[i - 1].x, ay = P[i].y - P[i - 1].y;
    const bx = P[i + 1].x - P[i].x, by = P[i + 1].y - P[i].y;
    const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    if (cos < grens) { stukken.push([begin, i]); begin = i; }
  }
  stukken.push([begin, n - 1]);

  const ringen = [];
  const werk = stukken.reverse();
  while (werk.length) {
    const [s, e] = werk.pop();
    if (e <= s) continue;
    const N = normalenVan(P, s, e);
    const k = e - s >= 2 ? eersteOmslag(P, R, N, s, e) : -1;
    if (k < 0) {
      let maxR = 0;
      for (let i = s; i <= e; i++) if (R[i] > maxR) maxR = R[i];
      if (maxR <= 0) continue;
      const len = e - s === 1 ? Math.hypot(P[e].x - P[s].x, P[e].y - P[s].y) : Infinity;
      // Twee punten waarvan de ene cirkel de andere omvat: alleen de grote.
      if (Math.abs(R[e] - R[s]) >= len) ringen.push(cirkelRing(R[e] > R[s] ? P[e] : P[s], maxR, kapStappen * 2));
      else ringen.push(streekRing(P, R, N, s, e, kapStappen));
      continue;
    }
    // Een omslaande zijde: dat segment apart (een ring van twee punten slaat
    // nooit om), de rest links en rechts ervan opnieuw.
    werk.push([k + 1, e]);
    werk.push([k, k + 1]);
    if (k > s) werk.push([s, k]);
  }
  return ringen;
}

// ── Alles samen, met cache ──────────────────────────────────────────────────

const _cache = new WeakMap();

function vingerafdruk(ann, breedteFactor, stap) {
  let som = 0;
  const path = ann.path || [];
  for (let i = 0; i < path.length; i++) som += path[i].x * 31 + path[i].y * 17 + i;
  let drukSom = 0;
  if (heeftDruk(ann)) for (const p of ann.pressures) drukSom += p;
  return [path.length, som, drukSom, ann.lineWidth, ann.inkMinWidth, ann.inkSmoothing,
    ann.inkPressure, heeftDruk(ann), breedteFactor, stap].join('|');
}

/**
 * Wat er van een streek getekend wordt.
 * @returns {{ variabel: boolean, punten: {x,y}[], breedtes: number[], ringen: {x,y}[][] }}
 *   variabel: true → vul de ringen; false → trek de middellijn met breedtes[0].
 */
export function inktGeometrie(ann, { breedteFactor = 1, stap = 1 } = {}) {
  if (!ann || !Array.isArray(ann.path)) return { variabel: false, punten: [], breedtes: [], ringen: [] };
  const sleutel = vingerafdruk(ann, breedteFactor, stap);
  const oud = _cache.get(ann);
  if (oud && oud.sleutel === sleutel) return oud.uit;
  const glad = gladdeStreek(ann.path, breedtesVan(ann, { breedteFactor }), ann.inkSmoothing ?? 0, { stap });
  const variabel = heeftDruk(ann);
  const uit = {
    variabel,
    punten: glad.punten,
    breedtes: glad.waarden,
    ringen: variabel ? omtrekRingen(glad.punten, glad.waarden) : [],
  };
  _cache.set(ann, { sleutel, uit });
  return uit;
}

/** Grootste halve breedte (voor /Rect en de omhullende). */
export function halveMaxBreedte(ann) {
  const w = Number.isFinite(ann?.lineWidth) && ann.lineWidth > 0 ? ann.lineWidth : 2;
  return w / 2;
}

/**
 * Content-stream (absolute PDF-coördinaten) voor de /AP van een gladde of
 * drukgevoelige streek. X en Y zetten app-coördinaten om naar PDF.
 * Variabel: gevulde ringen (f, nonzero). Vast: de gladde middellijn (S) met
 * ronde kappen en hoeken.
 * @returns {string|null}
 */
export function inktAppearanceInhoud(ann, X, Y, rgb) {
  const geo = inktGeometrie(ann);
  if (geo.punten.length === 0) return null;
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const [r, g, b] = rgb.map((c) => f(c));
  const regels = [];
  if (geo.variabel) {
    if (geo.ringen.length === 0) return null;
    regels.push(`${r} ${g} ${b} rg`);
    for (const ring of geo.ringen) {
      ring.forEach((p, i) => regels.push(`${f(X(p.x))} ${f(Y(p.y))} ${i === 0 ? 'm' : 'l'}`));
      regels.push('h');
    }
    regels.push('f');
  } else {
    if (geo.punten.length < 2) return null;
    regels.push(`${f(geo.breedtes[0] ?? ann.lineWidth ?? 2)} w`, '1 J', '1 j', `${r} ${g} ${b} RG`);
    geo.punten.forEach((p, i) => regels.push(`${f(X(p.x))} ${f(Y(p.y))} ${i === 0 ? 'm' : 'l'}`));
    regels.push('S');
  }
  return regels.join('\n') + '\n';
}
