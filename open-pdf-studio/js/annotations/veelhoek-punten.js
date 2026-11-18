// Hoekpunten van een veelhoek (#622).
//
// Een veelhoek die de gebruiker tekent, plaatst hij hoek voor hoek; het model
// bewaart die hoekpunten in `points`. Daarnaast staan het vak (x/y/breedte/
// hoogte, de omhullende van de punten) en de draaiing (`rotation`, om het
// midden van het vak, zoals bij een rechthoek):
//
// - `points` is de ONGEDRAAIDE vorm. Het scherm tekent hem in zijn vak en
//   draait dat vak daarna om zijn midden (rendering.js, ctx.rotate).
// - Wijzigt alleen het vak (een greep, het paneel, de maatbadge), dan rekken
//   de punten mee: het scherm beeldt de punten af op het vak
//   (buildPolygonPointsPath). veelhoekPunten() doet precies hetzelfde, zodat
//   opslaan, raken, snappen en grepen dezelfde vorm zien als het scherm.
// - Een hoekpunt verschuiven, toevoegen of verwijderen gebeurt op het scherm
//   (gedraaid); zetVeelhoekOpScherm() rekent terug naar ongedraaide punten
//   waarvan het nieuwe vak zo ligt dat de andere hoekpunten op het scherm
//   blijven staan (dezelfde regel als de lader, saver/vorm-draaiing.js).
//
// Een veelhoek zonder punten (alleen `sides`, uit een oudere sessie) blijft
// de regelmatige n-hoek van zijn vak; die tak blijft ongemoeid.
//
// Puur: geen DOM, geen state.

import { hasBezierHandles, mapContourNode, contourBounds, transformContour, moveContourNode } from './bezier-contour.js';
import { ontdraaiVorm } from '../pdf/saver/vorm-draaiing.js';
import { isVreemdeTelling } from './telling.js';

/** Minimaal aantal hoekpunten van een veelhoek. */
export const VEELHOEK_MIN_PUNTEN = 3;

const isPunt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const kaal = (p) => mapContourNode(p, q => ({ x: q.x, y: q.y }));

function omhullende(punten) {
  if (hasBezierHandles(punten)) {
    const b = contourBounds(punten, true);
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of punten) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const heeftVak = (ann) => [ann?.x, ann?.y, ann?.width, ann?.height].every(Number.isFinite);

/** Is dit een veelhoek met (minstens drie bruikbare) eigen hoekpunten? */
export function heeftVeelhoekPunten(ann) {
  return !!ann && ann.type === 'polygon' && Array.isArray(ann.points)
    && ann.points.length >= VEELHOEK_MIN_PUNTEN && ann.points.every(isPunt);
}

/**
 * Een veelhoek waarvan de gebruiker de hoekpunten verschuift: met eigen
 * punten, en geen telling van een ander programma (die tekent stippen op de
 * hoekpunten en houdt zijn eigen gedrag, zie telling.js).
 */
export function isBewerkbareVeelhoek(ann) {
  return heeftVeelhoekPunten(ann) && !isVreemdeTelling(ann);
}

/** Het vak (omhullende) van een puntenlijst. */
export function vakVanPunten(punten) {
  const g = omhullende(punten);
  return { x: g.minX, y: g.minY, width: g.maxX - g.minX, height: g.maxY - g.minY };
}

/**
 * De modelvelden van een veelhoek met deze hoekpunten: een kopie van de
 * punten, het vak eromheen en het aantal zijden.
 */
export function veelhoekUitPunten(punten) {
  const pts = punten.map(kaal);
  return { points: pts, ...vakVanPunten(pts), sides: pts.length };
}

/** De ingeschreven regelmatige n-hoek van een vak; hoekpunt 0 bovenaan. */
export function regelmatigeVeelhoekPunten(vak, zijden = 6) {
  const n = Math.max(VEELHOEK_MIN_PUNTEN, Math.round(zijden) || 6);
  const cx = vak.x + vak.width / 2;
  const cy = vak.y + vak.height / 2;
  const rx = vak.width / 2;
  const ry = vak.height / 2;
  const punten = [];
  for (let i = 0; i < n; i++) {
    const hoek = (i * 2 * Math.PI / n) - Math.PI / 2;
    punten.push({ x: cx + rx * Math.cos(hoek), y: cy + ry * Math.sin(hoek) });
  }
  return punten;
}

/**
 * De ongedraaide hoekpunten zoals het scherm ze tekent: de punten afgebeeld
 * op het vak (zie buildPolygonPointsPath in rendering/shapes.js). Null voor
 * een veelhoek zonder eigen punten.
 */
export function veelhoekPunten(ann) {
  if (!heeftVeelhoekPunten(ann)) return null;
  const pts = ann.points;
  if (!heeftVak(ann)) return pts.map(kaal);
  const g = omhullende(pts);
  const spanX = g.maxX - g.minX;
  const spanY = g.maxY - g.minY;
  const sx = spanX > 1e-6 ? ann.width / spanX : 1;
  const sy = spanY > 1e-6 ? ann.height / spanY : 1;
  return pts.map(p => mapContourNode(p, q => ({ x: ann.x + (q.x - g.minX) * sx, y: ann.y + (q.y - g.minY) * sy })));
}

/** Het draaipunt: het midden van het vak, zonder vak dat van de punten. */
function midden(ann, punten) {
  if (heeftVak(ann)) return { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
  const g = omhullende(punten);
  return { x: (g.minX + g.maxX) / 2, y: (g.minY + g.maxY) / 2 };
}

/**
 * De hoekpunten op het scherm: gespiegeld en gedraaid om het midden van het
 * vak, in dezelfde volgorde als het scherm (translate, rotate, scale).
 */
export function veelhoekPuntenOpScherm(ann) {
  const pts = veelhoekPunten(ann);
  if (!pts) return null;
  const graden = Number(ann.rotation) || 0;
  const fx = ann.flipX ? -1 : 1;
  const fy = ann.flipY ? -1 : 1;
  if (!graden && fx === 1 && fy === 1) return pts;
  const c = midden(ann, pts);
  const a = graden * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(node => mapContourNode(node, (p) => {
    const dx = (p.x - c.x) * fx;
    const dy = (p.y - c.y) * fy;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  }));
}

/**
 * De modelvelden voor een veelhoek waarvan de hoekpunten op het scherm op
 * `scherm` moeten staan, met de hoek van `ann`. Een spiegeling gaat daarbij
 * in de punten op.
 */
export function zetVeelhoekOpScherm(ann, scherm) {
  const graden = Number(ann?.rotation) || 0;
  let punten;
  if (graden && hasBezierHandles(scherm)) {
    const a = graden * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const q = transformContour(scherm, [c, -s, s, c, 0, 0], true);
    const b = contourBounds(q, true), mx = b.x + b.width / 2, my = b.y + b.height / 2;
    punten = transformContour(q, [1, 0, 0, 1, mx * c - my * s - mx, mx * s + my * c - my], true);
  } else punten = graden ? ontdraaiVorm(scherm.map(kaal), graden) : scherm.map(kaal);
  const uit = veelhoekUitPunten(punten);
  if (ann?.flipX) uit.flipX = false;
  if (ann?.flipY) uit.flipY = false;
  return uit;
}

/**
 * Hoekpunt `index` over (dx, dy) op het scherm verschuiven.
 * opties.shift: de verschuiving op een veelvoud van 45°;
 * opties.uitlijnTol: binnen deze afstand uitlijnen op de x of y van een
 * ander hoekpunt (op het scherm).
 * @returns de nieuwe modelvelden, of null bij een onbekend hoekpunt
 */
export function verplaatsVeelhoekHoekpunt(ann, index, dx, dy, opties = {}) {
  const scherm = veelhoekPuntenOpScherm(ann);
  if (!scherm || !(index >= 0 && index < scherm.length)) return null;
  const p = scherm[index];
  let ddx = dx, ddy = dy;
  if (opties.shift) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const stap = Math.PI / 4;
      const hoek = Math.round(Math.atan2(dy, dx) / stap) * stap;
      ddx = len * Math.cos(hoek);
      ddy = len * Math.sin(hoek);
    }
  }
  let nx = p.x + ddx, ny = p.y + ddy;
  const tol = opties.uitlijnTol;
  if (tol > 0 && !opties.shift) {
    for (let i = 0; i < scherm.length; i++) {
      if (i === index) continue;
      if (Math.abs(nx - scherm[i].x) < tol) nx = scherm[i].x;
      if (Math.abs(ny - scherm[i].y) < tol) ny = scherm[i].y;
    }
  }
  const nieuw = moveContourNode(scherm, index, nx - p.x, ny - p.y);
  return zetVeelhoekOpScherm(ann, nieuw);
}

/** Hoekpunt `index` weghalen; null als er dan minder dan drie overblijven. */
export function verwijderVeelhoekHoekpunt(ann, index) {
  const scherm = veelhoekPuntenOpScherm(ann);
  if (!scherm || scherm.length <= VEELHOEK_MIN_PUNTEN) return null;
  if (!(index >= 0 && index < scherm.length)) return null;
  const nieuw = scherm.slice();
  nieuw.splice(index, 1);
  return zetVeelhoekOpScherm(ann, nieuw);
}

/**
 * Een hoekpunt invoegen op zijde `zijde` (van hoekpunt `zijde` naar het
 * volgende; de laatste zijde sluit naar het eerste). Zonder punt: het midden
 * van de zijde. Het punt is een schermpunt.
 */
export function voegVeelhoekHoekpuntIn(ann, zijde, punt = null) {
  const scherm = veelhoekPuntenOpScherm(ann);
  if (!scherm || !(zijde >= 0 && zijde < scherm.length)) return null;
  const a = scherm[zijde];
  const b = scherm[(zijde + 1) % scherm.length];
  const p = isPunt(punt) ? kaal(punt) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nieuw = scherm.slice();
  nieuw.splice(zijde + 1, 0, p);
  return zetVeelhoekOpScherm(ann, nieuw);
}

/**
 * Spiegelen in het eigen vak (as 'x' = links-rechts, 'y' = boven-onder),
 * zoals de spiegelknoppen. De punten zelf spiegelen, zodat de spiegeling in
 * het bestand komt (een spiegelvlag kent /Polygon niet).
 */
export function spiegelVeelhoek(ann, as) {
  const pts = veelhoekPunten(ann);
  if (!pts) return null;
  const c = midden(ann, pts);
  const gespiegeld = pts.map(node => mapContourNode(node, p => (as === 'y' ? { x: p.x, y: 2 * c.y - p.y } : { x: 2 * c.x - p.x, y: p.y })));
  return veelhoekUitPunten(gespiegeld);
}

function projectieOpZijde(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Welk deel van de veelhoek ligt op het schermpunt (x, y): een hoekpunt
 * ({ kind: 'vertex', nodeIndex }), een zijde ({ kind: 'edge', edgeIndex,
 * punt } met het dichtstbijzijnde punt op die zijde) of niets (null).
 * Een hoekpunt wint van de zijden die erop uitkomen.
 */
export function veelhoekDeelBij(ann, x, y, tol) {
  const scherm = veelhoekPuntenOpScherm(ann);
  if (!scherm) return null;
  let besteHoek = -1, besteHoekAfstand = Infinity;
  scherm.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < besteHoekAfstand) { besteHoek = i; besteHoekAfstand = d; }
  });
  if (besteHoek >= 0) return { kind: 'vertex', nodeIndex: besteHoek };
  let besteZijde = -1, besteAfstand = Infinity, bestePunt = null;
  for (let i = 0; i < scherm.length; i++) {
    const q = projectieOpZijde(x, y, scherm[i], scherm[(i + 1) % scherm.length]);
    const d = Math.hypot(q.x - x, q.y - y);
    if (d <= tol && d < besteAfstand) { besteZijde = i; besteAfstand = d; bestePunt = q; }
  }
  return besteZijde >= 0 ? { kind: 'edge', edgeIndex: besteZijde, punt: bestePunt } : null;
}

/**
 * De punten van een getekende veelhoek opgeschoond: een punt dat (binnen
 * `tol`) op het vorige valt — de twee klikken van een dubbelklik — en een
 * laatste punt op het eerste vallen weg.
 */
export function ruimTekenPuntenOp(punten, tol = 0) {
  const uit = [];
  for (const p of punten || []) {
    if (!isPunt(p)) continue;
    const vorige = uit[uit.length - 1];
    if (vorige && Math.hypot(p.x - vorige.x, p.y - vorige.y) <= tol) continue;
    uit.push(kaal(p));
  }
  while (uit.length > 1 && Math.hypot(uit[uit.length - 1].x - uit[0].x, uit[uit.length - 1].y - uit[0].y) <= tol) {
    uit.pop();
  }
  return uit;
}
