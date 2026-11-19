// Krommen van een polylijn of veelhoek in het bestand (#1169).
//
// Een /PolyLine of /Polygon kan in /Vertices geen krommen kwijt. Daarom:
//
// - de appearance (/AP) tekent het pad met echte kromme-operatoren (c), zodat
//   elke PDF-lezer de kromme toont;
// - /Vertices krijgt het VLAKGEMAAKTE pad (lijnstukjes binnen een tiende
//   punt van de kromme), zodat een ander programma dat zelf uit /Vertices
//   tekent of meet nog steeds een bruikbare polylijn of veelhoek ziet;
// - de precieze krommen staan in twee eigen sleutels, zodat de app het pad
//   bewerkbaar heropent:
//     /OPS_CurveNodes  [x0 y0 x1 y1 ...]         de knopen
//     /OPS_Curves      [i c1x c1y c2x c2y ...]   per kromme het segmentnummer
//                                                en de twee stuurpunten
//   Alles in paginacoördinaten van het bestand, zoals /Vertices; de
//   stuurpunten zijn hier absoluut (in het model zijn ze relatief aan hun
//   knoop, zie annotations/curve-path.js).
//
// Een vorm zonder krommen krijgt geen van beide sleutels en wordt precies zo
// weggeschreven als voorheen. Een bestand van een ander programma (alleen
// /Vertices) wordt geladen als voorheen.
//
// Puur: geen pdf-lib, geen DOM.

import { flattenPath, segmentCount, isCurve, normalizeCurves } from '../annotations/curve-path.js';

/** De tolerantie (pt) waarmee /Vertices de krommen volgt. */
export const VERTICES_TOLERANTIE = 0.1;

const g = (n) => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * Het pad (in de ruimte van het scherm: { points, curves, closed }) omgezet
 * naar wat het bestand nodig heeft. `naarPdf(punt)` geeft [x, y] in
 * paginacoördinaten van het bestand.
 * @returns {{ nodes: number[], curves: number[], vertices: number[], padOps: string }}
 */
export function krommenNaarPdf(pad, naarPdf, tolerance = VERTICES_TOLERANTIE) {
  const n = pad.points.length;
  const closed = !!pad.closed;
  const segs = segmentCount(n, closed);
  const knopen = pad.points.map((p) => naarPdf(p));
  const nodes = [];
  for (const [x, y] of knopen) nodes.push(x, y);

  const pdfPunten = knopen.map(([x, y]) => ({ x, y }));
  const pdfKrommen = [];
  const curves = [];
  let padOps = `${g(knopen[0][0])} ${g(knopen[0][1])} m\n`;
  for (let i = 0; i < segs; i++) {
    const s = pad.curves?.[i];
    const j = (i + 1) % n;
    const [bx, by] = knopen[j];
    if (isCurve(s)) {
      const a = pad.points[i], b = pad.points[j];
      const c1 = naarPdf({ x: a.x + s.c1x, y: a.y + s.c1y });
      const c2 = naarPdf({ x: b.x + s.c2x, y: b.y + s.c2y });
      curves.push(i, c1[0], c1[1], c2[0], c2[1]);
      pdfKrommen.push({
        c1x: c1[0] - knopen[i][0], c1y: c1[1] - knopen[i][1],
        c2x: c2[0] - bx, c2y: c2[1] - by,
      });
      padOps += `${g(c1[0])} ${g(c1[1])} ${g(c2[0])} ${g(c2[1])} ${g(bx)} ${g(by)} c\n`;
    } else {
      pdfKrommen.push(null);
      // De rechte sluitzijde tekent 'h' zelf.
      if (!(closed && i === segs - 1)) padOps += `${g(bx)} ${g(by)} l\n`;
    }
  }
  if (closed) padOps += 'h\n';

  const vertices = [];
  for (const p of flattenPath(pdfPunten, pdfKrommen, { closed, tolerance })) vertices.push(p.x, p.y);
  return { nodes, curves, vertices, padOps };
}

const isGetallenLijst = (a) => Array.isArray(a) && a.every(Number.isFinite);

/**
 * De knopen en krommen uit de eigen sleutels, in de ruimte van de app:
 * { points, curves }. `convertPoint(x, y)` geeft [x, y] in de app, zoals de
 * lader /Vertices omrekent. Null als de sleutels ontbreken, niet kloppen, of
 * niet meer bij /Vertices horen: staan de knopen niet (in volgorde) tussen de
 * punten van /Vertices, dan heeft een ander programma de vorm verplaatst of
 * vervormd en geldt /Vertices.
 */
export function krommenUitPdf({ nodes, curves, vertices, closed, convertPoint }) {
  if (!isGetallenLijst(nodes) || !isGetallenLijst(curves)) return null;
  const n = nodes.length / 2;
  if (!Number.isInteger(n) || n < (closed ? 3 : 2)) return null;
  if (curves.length === 0 || curves.length % 5 !== 0) return null;
  const segs = segmentCount(n, closed);

  if (isGetallenLijst(vertices) && vertices.length >= 4) {
    let zoek = 0;
    for (let k = 0; k < n; k++) {
      const x = nodes[2 * k], y = nodes[2 * k + 1];
      const tol = 0.01 + 1e-6 * Math.max(Math.abs(x), Math.abs(y));
      let gevonden = -1;
      for (let v = zoek; v + 1 < vertices.length; v += 2) {
        if (Math.abs(vertices[v] - x) <= tol && Math.abs(vertices[v + 1] - y) <= tol) { gevonden = v; break; }
      }
      if (gevonden < 0) return null;
      zoek = gevonden;
    }
  }

  const points = [];
  for (let k = 0; k < n; k++) {
    const [x, y] = convertPoint(nodes[2 * k], nodes[2 * k + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  const lijst = new Array(segs).fill(null);
  for (let k = 0; k < curves.length; k += 5) {
    const i = curves[k];
    if (!Number.isInteger(i) || i < 0 || i >= segs || lijst[i]) return null;
    const [c1x, c1y] = convertPoint(curves[k + 1], curves[k + 2]);
    const [c2x, c2y] = convertPoint(curves[k + 3], curves[k + 4]);
    const a = points[i], b = points[(i + 1) % n];
    lijst[i] = { c1x: c1x - a.x, c1y: c1y - a.y, c2x: c2x - b.x, c2y: c2y - b.y };
  }
  const schoon = normalizeCurves(lijst, segs);
  return schoon ? { points, curves: schoon } : null;
}
