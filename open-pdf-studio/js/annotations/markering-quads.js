// Gedraaide quads van een markering (#944, #927, #946).
//
// Een quad is [begin-boven, eind-boven, begin-onder, eind-onder], elk punt
// {x, y} in de paginaruimte van de app (100% zoom, y omlaag). Zo schrijft de
// saver ze ook als /QuadPoints (p1 -> p2 is de leesrichting).
//
// - Een gedraaide vlakmarkering (gereedschap 'highlight' met `rotation`) is
//   haar vak, om het midden gedraaid zoals ctx.rotate dat op het scherm doet.
// - Een tekstmarkering op schuine tekst heeft eigen `quads` die de tekst
//   volgen; `rects` blijven de assen-uitgelijnde vakken (raken, culling).
//
// Puur: geen pdf-lib, geen DOM.

import { draaiPunt } from '../pdf/saver/vorm-draaiing.js';

const TOL_HOEK = 1; // graden: binnen 1 graad van een veelvoud van 90 is recht

/** Het gedraaide vak van een vlakmarkering als quad, of null zonder draaiing. */
export function vlakQuad(ann) {
  if (!ann || !ann.rotation || ![ann.x, ann.y, ann.width, ann.height].every(Number.isFinite)) return null;
  const c = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
  const x1 = ann.x, y1 = ann.y, x2 = ann.x + ann.width, y2 = ann.y + ann.height;
  return [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x1, y: y2 }, { x: x2, y: y2 },
  ].map((p) => draaiPunt(p, c, ann.rotation));
}

/** Is dit een bruikbare quad: vier eindige punten? */
export function isQuad(q) {
  return Array.isArray(q) && q.length === 4
    && q.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Hoek van p1 -> p2 in graden (app-ruimte, met de klok mee), 0..360. */
export function quadHoek(q) {
  const h = (Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI;
  return ((h % 360) + 360) % 360;
}

/** Schuin: de leesrichting ligt niet (binnen 1 graad) liggend of staand. */
export function isSchuin(q) {
  if (!isQuad(q)) return false;
  if (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) === 0) return false;
  const rest = quadHoek(q) % 90;
  return rest > TOL_HOEK && rest < 90 - TOL_HOEK;
}

/**
 * Het ongedraaide vak en de draaiing van een vlakmarkering uit haar quad
 * (het omgekeerde van vlakQuad). Null als de quad geen rechthoek is.
 * @param {number} [bekendeHoek]  bv. /OPS_Rotation; wint als hij binnen
 *   0,01 graad met de quad samenvalt (geen afrondingsruis in het model)
 */
export function vakUitVlakQuad(q, bekendeHoek) {
  if (!isQuad(q)) return null;
  const [p1, p2, p3, p4] = q;
  const ux = p2.x - p1.x, uy = p2.y - p1.y;
  const vx = p3.x - p1.x, vy = p3.y - p1.y;
  const w = Math.hypot(ux, uy), h = Math.hypot(vx, vy);
  if (!(w > 0) || !(h > 0)) return null;
  const tol = Math.max(w, h) * 1e-3 + 1e-3;
  // Rechthoek, niet gespiegeld: p3 - p1 staat haaks op p2 - p1 (met de klok
  // mee in app-ruimte) en p4 = p2 + p3 - p1.
  if (Math.abs((ux * vx + uy * vy) / w) > tol) return null;
  if (ux * vy - uy * vx <= 0) return null;
  if (Math.hypot(p4.x - (p2.x + vx), p4.y - (p2.y + vy)) > tol) return null;
  // 0..360, zoals de app een draaiing bewaart (applyRotateGeneric).
  let rotation = quadHoek(q);
  if (Number.isFinite(bekendeHoek)) {
    const verschil = ((((rotation - bekendeHoek) % 360) + 540) % 360) - 180;
    if (Math.abs(verschil) < 0.01) rotation = bekendeHoek;
  }
  const cx = (p1.x + p4.x) / 2, cy = (p1.y + p4.y) / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rotation };
}

/**
 * Quads uit /QuadPoints van het bestand (8 getallen per quad, PDF-ruimte),
 * met convertPoint naar de app-ruimte. Null als de getallen niet kloppen.
 * @param {number[]} getallen
 * @param {(x:number,y:number)=>number[]|{x:number,y:number}} convertPoint
 */
export function quadsUitQuadPoints(getallen, convertPoint) {
  if (!Array.isArray(getallen) || getallen.length < 8 || getallen.length % 8 !== 0) return null;
  if (!getallen.every(Number.isFinite)) return null;
  const uit = [];
  for (let i = 0; i < getallen.length; i += 8) {
    uit.push([0, 2, 4, 6].map((k) => {
      const p = convertPoint(getallen[i + k], getallen[i + k + 1]);
      return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };
    }));
  }
  return uit;
}

/** Assen-uitgelijnd vak van één quad. */
export function quadVak(q) {
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * De geometrie van een tekstmarkering uit haar quads: de quads zelf, per
 * quad een assen-uitgelijnd vak (`rects`), de vlakke `quadPoints` en het
 * omhullende vak. Zo maakt ook de selectie een markering op schuine tekst.
 */
export function markeringUitQuads(quads) {
  const qs = quads.map((q) => q.map((p) => ({ x: p.x, y: p.y })));
  const rects = qs.map(quadVak);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    quads: qs,
    rects,
    quadPoints: qs.map((q) => q.flatMap((p) => [p.x, p.y])),
    x, y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}

/**
 * Wat de lader van een tekstmarkering uit het bestand terugzet (#944, #927).
 * pdf.js geeft /QuadPoints als rechte vakken; de eigen quads van het bestand
 * (rawQuadPoints, via color-extraction.js) houden de draaiing.
 * - Een /Highlight met /OPS_Rotation en één rechthoekige quad is een
 *   gedraaide vlakmarkering: { vlak: {x, y, width, height, rotation} }.
 * - Een /Highlight met schuine quads: { quads } (zoals de selectie ze maakt).
 * - Anders null: de lader blijft bij de rechte vakken.
 * @param {{ subtype: string, rawQuadPoints?: number[], rotatie?: number,
 *   convertPoint: (x:number,y:number)=>number[] }} invoer
 */
export function gedraaideMarkeringUitBestand({ subtype, rawQuadPoints, rotatie, convertPoint }) {
  if (subtype !== 'Highlight') return null;
  const quads = quadsUitQuadPoints(rawQuadPoints, convertPoint);
  if (!quads) return null;
  if (Number.isFinite(rotatie) && rotatie !== 0 && quads.length === 1) {
    const vlak = vakUitVlakQuad(quads[0], rotatie);
    if (vlak) return { vlak };
  }
  return quads.some(isSchuin) ? { quads } : null;
}
