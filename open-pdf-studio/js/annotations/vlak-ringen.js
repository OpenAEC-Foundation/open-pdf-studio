// Ringindeling voor vlak-annotaties (measureArea / filledArea).
//
// Een vlak bestaat uit de buitenring `points` plus nul of meer extra ringen in
// `holes`. Die extra ringen telden vroeger allemaal als gat: de vulling ging
// met de even-oneven-regel en de oppervlakte trok elke ring af. Voor een donut
// klopt dat, maar voor een tweede deel naast of over het eerste niet — de
// gedeelde overlap viel uit de vulling en twee gelijke delen naast elkaar
// kwamen op 0 uit (GitHub #457).
//
// DE REGEL — één regel voor scherm, oppervlakte, hoeveelheden, raakvlak en de
// appearance die bij het opslaan in het bestand komt:
//
//   * Een ring die binnen een ONEVEN aantal andere ringen ligt is een gat: hij
//     trekt af.
//   * Elke andere ring is een extra DEEL: hij telt op. Een ring los naast de
//     buitenring hoort daar dus bij in plaats van er een hap uit te nemen.
//   * "Binnen" betekent: elk hoekpunt van de ring ligt binnen of op de andere
//     ring. Een ring die er deels buiten steekt ligt er dus niet in.
//   * Ringen die elkaar overlappen zonder dat de een de ander omsluit zijn
//     losse delen. Op het scherm en in het bestand vullen ze samen hun
//     vereniging (niet-nul-regel, dus de overlap blijft gevuld); de
//     oppervlakte telt de delen bij elkaar op, waardoor een gedeelde overlap
//     één keer per deel meetelt. Laat delen elkaar dus niet overlappen als de
//     oppervlakte exact moet zijn.
//
// De niet-nul-regel werkt alleen als de ringen de goede kant op draaien:
// ringenRichten() geeft alle delen dezelfde draairichting en alle gaten de
// tegengestelde. De tekenlaag en de appearance-bouwer gebruiken die lijst.

import { arcControlPoint, expandArcPoints, hasArcPoints } from './arc-points.js';

/** De ringen van een vlak: buitenring eerst, daarna de bruikbare extra ringen. */
export function vlakRingen(points, holes) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const ringen = [points];
  if (Array.isArray(holes)) {
    for (const h of holes) if (Array.isArray(h) && h.length >= 3) ringen.push(h);
  }
  return ringen;
}

/** Ring met boogsegmenten uitgeklapt tot rechte stukjes (of ongewijzigd). */
function recht(ring) {
  return hasArcPoints(ring) ? expandArcPoints(ring) : ring;
}

/** Getekend oppervlak van één ring (schoenveterformule; teken = draairichting). */
export function ringOppervlak(ring) {
  const p = recht(ring);
  if (!p || p.length < 3) return 0;
  let som = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    som += a.x * b.y - b.x * a.y;
  }
  return som / 2;
}

/** Ligt (x,y) binnen deze ring? Rand telt als binnen (`marge` in px). */
function puntInRing(p, x, y, marge) {
  let binnen = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
    // Op de rand: meteen "binnen", anders valt een gat dat de buitenrand
    // raakt willekeurig de ene of de andere kant op.
    if (marge > 0 && afstandTotLijn(x, y, xi, yi, xj, yj) <= marge) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) {
      binnen = !binnen;
    }
  }
  return binnen;
}

function afstandTotLijn(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Marge waarbinnen een punt nog "op" de ring ligt: schaalt met de ringmaat. */
function randMarge(p) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of p) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  return Math.max(maxX - minX, maxY - minY, 1) * 1e-9;
}

/** Ligt ring `binnen` helemaal binnen ring `buiten` (rand telt als binnen)? */
export function ringOmsluit(buiten, binnen) {
  const b = recht(buiten);
  const i = recht(binnen);
  if (!b || b.length < 3 || !i || i.length < 3) return false;
  const marge = randMarge(b);
  for (const q of i) if (!puntInRing(b, q.x, q.y, marge)) return false;
  return true;
}

/**
 * Deelt de ringen in: `true` = deel (telt op), `false` = gat (trekt af).
 * Nestdiepte = het aantal andere ringen dat deze ring omsluit; even diep is
 * een deel, oneven diep een gat.
 */
export function ringenIndelen(ringen) {
  if (ringen.length <= 1) return ringen.map(() => true);
  // De uitgeklapte ringen één keer maken: ringOmsluit() doet dat anders per paar.
  const recht_ = ringen.map(recht);
  const marges = recht_.map(randMarge);
  return ringen.map((_, i) => {
    let diepte = 0;
    for (let j = 0; j < ringen.length; j++) {
      if (j === i) continue;
      const buiten = recht_[j], binnen = recht_[i];
      let omsluit = true;
      for (const q of binnen) {
        if (!puntInRing(buiten, q.x, q.y, marges[j])) { omsluit = false; break; }
      }
      if (omsluit) diepte++;
    }
    return diepte % 2 === 0;
  });
}

/**
 * Een ring in omgekeerde volgorde. Een boogsegment hoort bij het punt waar het
 * eindigt, dus de boogvlag schuift één plek op en de doorbuiging keert om —
 * zo beschrijft de omgekeerde ring exact dezelfde vorm.
 */
export function ringOmkeren(ring) {
  const n = ring.length;
  const om = [];
  for (let j = 0; j < n; j++) om.push(ring[(n - j) % n]);
  return om.map((p, j) => {
    const bron = om[(j - 1 + n) % n];
    const uit = { x: p.x, y: p.y };
    if (bron && bron.arc) {
      uit.arc = true;
      uit.bulge = -(typeof bron.bulge === 'number' ? bron.bulge : 0.3);
    }
    return uit;
  });
}

/**
 * De ringen van een vlak, gericht voor een niet-nul-vulling: alle delen draaien
 * dezelfde kant op, alle gaten de andere. Levert [{ points, additief }].
 * Zonder extra ringen komt de buitenring ongewijzigd terug.
 */
export function ringenRichten(points, holes) {
  const ringen = vlakRingen(points, holes);
  if (ringen.length <= 1) return ringen.map(r => ({ points: r, additief: true }));
  const additief = ringenIndelen(ringen);
  // De buitenring bepaalt welke kant "op" is; de rest volgt.
  const heen = Math.sign(ringOppervlak(ringen[0])) || 1;
  return ringen.map((ring, i) => {
    const wil = additief[i] ? heen : -heen;
    const teken = Math.sign(ringOppervlak(ring));
    return {
      points: (teken === 0 || teken === wil) ? ring : ringOmkeren(ring),
      additief: additief[i],
    };
  });
}

/** Netto oppervlak in px²: delen erbij, gaten eraf, nooit negatief. */
export function nettoVlakOppervlak(points, holes) {
  const ringen = vlakRingen(points, holes);
  if (ringen.length === 0) return 0;
  const additief = ringenIndelen(ringen);
  let opp = 0;
  for (let i = 0; i < ringen.length; i++) {
    opp += (additief[i] ? 1 : -1) * Math.abs(ringOppervlak(ringen[i]));
  }
  return Math.max(0, opp);
}

/**
 * Ligt (x,y) in de vulling van het vlak? Telt precies zoals de niet-nul-regel
 * de vulling schildert: elk omsluitend deel +1, elk omsluitend gat -1.
 */
export function puntInVlak(x, y, points, holes) {
  const ringen = vlakRingen(points, holes);
  if (ringen.length === 0) return false;
  const additief = ringenIndelen(ringen);
  let wikkel = 0;
  for (let i = 0; i < ringen.length; i++) {
    if (puntInRing(recht(ringen[i]), x, y, 0)) wikkel += additief[i] ? 1 : -1;
  }
  return wikkel > 0;
}

/** Omhullende over álle ringen (dus ook de delen buiten de buitenring). */
export function vlakOmhullende(points, holes) {
  const ringen = vlakRingen(points, holes);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of ringen) {
    for (const p of recht(ring)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export { arcControlPoint };
