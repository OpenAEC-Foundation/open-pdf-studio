// Wandgeometrie voor plattegronden — puur, zonder app-state.
//
// Drie vragen die de wandtools stellen:
//   1. Aansluiten: waar landt het eindpunt van een (binnen)wand die naar een
//      andere wand toe getekend wordt? Op het dichtstbijzijnde VLAK van die
//      wand (niet op de hartlijn), zodat de aansluiting bouwkundig klopt —
//      bij een spouwmuur dus op het binnenblad.
//   2. Spouwmuur: één getekende lijn wordt drie evenwijdige wanden
//      (buitenblad, spouw/isolatie, binnenblad). Opeenvolgende segmenten
//      krijgen per laag een verstek: de eindpunten van dezelfde laag worden
//      op het snijpunt van hun hartlijnen gelegd, zodat de bestaande
//      hoekverbinding (samenvallende eindpunten) ze netjes sluit.
//   3. Sparingen: welke stukken van de wandband zijn open (deur, kozijn,
//      vliesgevel)? Intervallen langs de as, in paginapunten vanaf het
//      beginpunt.
//
// Alle maten in paginapunten tenzij anders vermeld; `pxPerMm` rekent
// werkelijke mm om (schaal/schaalgebied van het blad).

export function wandAs(w) {
  const dx = w.endX - w.startX, dy = w.endY - w.startY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const u = { x: dx / len, y: dy / len };
  return { u, n: { x: -u.y, y: u.x }, len };
}

/** Projectie van p op de as van w: { t (langs, pt), d (dwars, pt, +n-zijde positief) }. */
export function projecteer(p, w) {
  const as = wandAs(w);
  if (!as) return null;
  const rx = p.x - w.startX, ry = p.y - w.startY;
  return { t: rx * as.u.x + ry * as.u.y, d: rx * as.n.x + ry * as.n.y, as };
}

/**
 * Laat een eindpunt op het dichtstbijzijnde vlak van een andere wand landen.
 * `halfW(w)` geeft de halve dikte in pt. Kandidaten: het punt ligt binnen de
 * band van de wand of er hooguit `tol` pt buiten (dwars), en binnen de
 * lengte (met `tol` uitloop). Retourneert { x, y, wand, zijde } of null.
 */
export function naarWandvlak(p, wanden, halfW, opties = {}) {
  const tol = opties.tol ?? 8;
  const uitsluiten = opties.uitsluiten || null;
  let beste = null;
  for (const w of wanden) {
    if (!w || w === uitsluiten || (uitsluiten && w.id === uitsluiten.id)) continue;
    const pr = projecteer(p, w);
    if (!pr) continue;
    const h = halfW(w);
    if (pr.t < -tol || pr.t > pr.as.len + tol) continue;
    const buiten = Math.abs(pr.d) - h;          // < 0: in de band
    if (buiten > tol) continue;
    const zijde = pr.d >= 0 ? 1 : -1;
    const afstandTotVlak = Math.abs(Math.abs(pr.d) - h);
    if (!beste || afstandTotVlak < beste.afstand) {
      const t = Math.max(0, Math.min(pr.as.len, pr.t));
      beste = {
        afstand: afstandTotVlak,
        x: w.startX + pr.as.u.x * t + pr.as.n.x * zijde * h,
        y: w.startY + pr.as.u.y * t + pr.as.n.y * zijde * h,
        wand: w, zijde,
      };
    }
  }
  return beste;
}

/**
 * Hartlijnen van de lagen van een spouwmuur uit één getekende lijn. De
 * getekende lijn is de BUITENZIJDE van het pakket; de lagen liggen aan de
 * binnenzijde daarvan. `binnenzijde`: 'rechts' (standaard; rechts van de
 * tekenrichting — bij een met de klok mee getekende omtrek is dat de
 * binnenkant) of 'links'.
 * lagen: [{ dikteMm, ... }] van buiten naar binnen.
 * Retourneert per laag { startX, startY, endX, endY, dikteMm, ...laag }.
 */
export function spouwmuurLagen(start, end, lagen, pxPerMm, binnenzijde = 'rechts') {
  const as = wandAs({ startX: start.x, startY: start.y, endX: end.x, endY: end.y });
  if (!as) return [];
  // n = (-u.y, u.x) wijst in schermcoördinaten (y omlaag) naar RECHTS van de
  // tekenrichting.
  const s = binnenzijde === 'links' ? -1 : 1;
  let offset = 0;
  return lagen.map((laag) => {
    const dikte = (laag.dikteMm || 100) * pxPerMm;
    const mid = offset + dikte / 2;
    offset += dikte;
    const ox = as.n.x * s * mid, oy = as.n.y * s * mid;
    return {
      ...laag,
      startX: start.x + ox, startY: start.y + oy,
      endX: end.x + ox, endY: end.y + oy,
    };
  });
}

// Snijpunt van twee oneindige lijnen (p+d·t); null bij evenwijdig.
export function lijnSnijpunt(p1, d1, p2, d2) {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Verstek tussen het vorige en het nieuwe spouwmuursegment: per laag worden
 * het eindpunt van de vorige en het beginpunt van de nieuwe laag op het
 * snijpunt van hun hartlijnen gelegd. Muteert beide arrays. Evenwijdige
 * lagen (doorlopende wand) blijven ongemoeid.
 */
export function verstekLagen(vorige, nieuwe) {
  const n = Math.min(vorige.length, nieuwe.length);
  for (let i = 0; i < n; i++) {
    const a = vorige[i], b = nieuwe[i];
    const da = { x: a.endX - a.startX, y: a.endY - a.startY };
    const db = { x: b.endX - b.startX, y: b.endY - b.startY };
    const s = lijnSnijpunt({ x: a.startX, y: a.startY }, da, { x: b.startX, y: b.startY }, db);
    if (!s) continue;
    a.endX = s.x; a.endY = s.y;
    b.startX = s.x; b.startY = s.y;
  }
  return nieuwe;
}

/**
 * Open intervallen [t0, t1] langs de as van wand `w` (pt vanaf het begin)
 * uit de gehoste sparingen: symbolen met params.hostWallId === w.id, met
 * params.hostAfstandMm (midden, mm) en params.width (mm). Buiten de wand
 * vallende delen worden afgeknipt; lege intervallen vervallen.
 */
export function sparingIntervallen(w, symbolen, pxPerMm) {
  const as = wandAs(w);
  if (!as) return [];
  const uit = [];
  for (const s of symbolen || []) {
    const p = s?.params;
    if (!p || p.hostWallId !== w.id) continue;
    const mid = (Number(p.hostAfstandMm) || 0) * pxPerMm;
    const breedte = (Number(p.width) || 0) * pxPerMm;
    if (!(breedte > 0)) continue;
    const t0 = Math.max(0, mid - breedte / 2);
    const t1 = Math.min(as.len, mid + breedte / 2);
    if (t1 - t0 > 0.01) uit.push({ t0, t1, symbool: s });
  }
  return uit.sort((a, b) => a.t0 - b.t0);
}

/**
 * Plaatsing van een gehost symbool op zijn wand: middelpunt op de hartlijn
 * bij hostAfstandMm, hoogte = wanddikte, rotatie = wandhoek (graden).
 */
export function gehostePlaatsing(w, params, pxPerMm) {
  const as = wandAs(w);
  if (!as) return null;
  const mid = Math.max(0, Math.min(as.len, (Number(params.hostAfstandMm) || 0) * pxPerMm));
  const breedte = Math.max(1, (Number(params.width) || 0) * pxPerMm);
  const hoogte = Math.max(1, (Number(w.dikteMm) || 100) * pxPerMm);
  const cx = w.startX + as.u.x * mid, cy = w.startY + as.u.y * mid;
  return {
    x: cx - breedte / 2, y: cy - hoogte / 2, width: breedte, height: hoogte,
    rotation: Math.atan2(as.u.y, as.u.x) * 180 / Math.PI,
  };
}

/** Afstand (mm) langs wand `w` van de projectie van punt p. */
export function afstandLangsWandMm(p, w, pxPerMm) {
  const pr = projecteer(p, w);
  if (!pr) return 0;
  return Math.max(0, Math.min(pr.as.len, pr.t)) / pxPerMm;
}
