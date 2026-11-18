// Krommen op een polylijn of veelhoek (#1169): de ene plek waar tekenen,
// raken, grepen, snappen en opslaan het pad van zo'n vorm vandaan halen, en
// waar een bewerking van dat pad terug in het model komt.
//
// - Een polylijn draagt zijn knopen rechtstreeks in `points` (paginaruimte)
//   en is open.
// - Een veelhoek draagt de ONGEDRAAIDE vorm in `points`, afgebeeld op zijn
//   vak en gedraaid om het midden daarvan (veelhoek-punten.js), en is
//   gesloten.
//
// Beide krijgen hun krommen in `curves` (zie curve-path.js). Meetvormen,
// wolken en vlakvullingen doen hier niet aan mee: die hebben hun eigen
// boogsegmenten (arc-points.js).
//
// Puur: geen DOM, geen state.

import {
  hasCurves, normalizeCurves, segmentCount, flattenPath, pathBounds,
  nearestOnPath, setSegmentCurve, bendSegment, insertNode, deleteNode,
  moveHandle, isSmoothNode, rotateCurves, transformCurves,
} from './curve-path.js';
import {
  isBewerkbareVeelhoek, veelhoekPunten, veelhoekKrommen, veelhoekPuntenOpScherm,
  veelhoekKrommenOpScherm, zetVeelhoekOpScherm, VEELHOEK_MIN_PUNTEN,
} from './veelhoek-punten.js';

const isPunt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Kan deze vorm krommen dragen? Een polylijn of een veelhoek met hoekpunten. */
export function kanKrommen(ann) {
  if (!ann) return false;
  if (ann.type === 'polyline') {
    return Array.isArray(ann.points) && ann.points.length >= 2 && ann.points.every(isPunt);
  }
  return isBewerkbareVeelhoek(ann);
}

/** Heeft deze vorm minstens een kromme? */
export function heeftKrommen(ann) {
  return kanKrommen(ann) && hasCurves(ann.curves);
}

/**
 * Het pad zoals het op de pagina staat: { points, curves, closed }. Voor een
 * veelhoek met zijn vak, spiegeling en draaiing verwerkt. Null voor een vorm
 * die geen krommen kan dragen.
 */
export function padOpScherm(ann) {
  if (!kanKrommen(ann)) return null;
  if (ann.type === 'polyline') {
    return {
      points: ann.points,
      curves: normalizeCurves(ann.curves, segmentCount(ann.points.length, false)),
      closed: false,
    };
  }
  return { points: veelhoekPuntenOpScherm(ann), curves: veelhoekKrommenOpScherm(ann), closed: true };
}

/**
 * Het pad in de eigen, ONGEDRAAIDE ruimte van de vorm: wat het scherm tekent
 * voordat het de vorm om zijn midden draait. Voor een polylijn gelijk aan
 * padOpScherm().
 */
export function padOngedraaid(ann) {
  if (!kanKrommen(ann)) return null;
  if (ann.type === 'polyline') return padOpScherm(ann);
  return { points: veelhoekPunten(ann), curves: veelhoekKrommen(ann), closed: true };
}

/** De modelvelden voor een vorm waarvan het pad op de pagina zo moet lopen. */
export function padNaarModel(ann, points, curves) {
  if (ann.type === 'polyline') {
    const pts = points.map((p) => ({ ...p }));
    const uit = { points: pts };
    const schoon = normalizeCurves(curves, segmentCount(pts.length, false));
    if (schoon || hasCurves(ann.curves)) uit.curves = schoon;
    return uit;
  }
  return zetVeelhoekOpScherm(ann, points, curves);
}

/**
 * Een patch op de vorm zetten; een leeg `curves`-veld verdwijnt, zodat een
 * vorm zonder krommen het model van voorheen houdt.
 */
export function pasPadToe(ann, patch) {
  if (!ann || !patch) return ann;
  Object.assign(ann, patch);
  if (!hasCurves(ann.curves)) delete ann.curves;
  return ann;
}

/** Het pad als punten binnen `tolerance` (paginaruimte), of null. */
export function vlakPadOpScherm(ann, tolerance = 0.25) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  return flattenPath(pad.points, pad.curves, { closed: pad.closed, tolerance });
}

/** De omhullende van het pad op de pagina: { x, y, width, height }, of null. */
export function padOmhullende(ann) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  const g = pathBounds(pad.points, pad.curves, { closed: pad.closed });
  return g ? { x: g.minX, y: g.minY, width: g.maxX - g.minX, height: g.maxY - g.minY } : null;
}

/**
 * Welk deel van het pad ligt bij het paginapunt (x, y): een knoop
 * ({ kind: 'vertex', nodeIndex }), een segment ({ kind: 'edge', edgeIndex,
 * t, punt, curve }) of niets (null). Een knoop wint van de segmenten.
 */
export function padDeelBij(ann, x, y, tol) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  let beste = -1, besteD = Infinity;
  pad.points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < besteD) { beste = i; besteD = d; }
  });
  if (beste >= 0) return { kind: 'vertex', nodeIndex: beste };
  const r = nearestOnPath(pad.points, pad.curves, x, y, { closed: pad.closed });
  if (!r || r.distance > tol) return null;
  return { kind: 'edge', edgeIndex: r.segment, t: r.t, punt: { x: r.x, y: r.y }, curve: r.curve };
}

/** Is segment `i` van deze vorm een kromme? */
export function isKrommeZijde(ann, i) {
  const pad = padOpScherm(ann);
  return !!pad && !!pad.curves && !!pad.curves[i];
}

/**
 * Segment `i` omzetten naar een kromme (`krom` waar) of een recht segment.
 * Een nieuwe kromme krijgt meteen een lichte buiging, zodat te zien is dat
 * het segment is omgezet en de stuurpunten naast de lijn te pakken zijn.
 * @returns de nieuwe modelvelden, of null bij een onbekend segment
 */
export function zetZijdeKrom(ann, i, krom) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  let curves = setSegmentCurve(pad.points, pad.curves, i, pad.closed, krom);
  if (curves === null) return null;
  if (krom && !(pad.curves && pad.curves[i])) {
    const a = pad.points[i], b = pad.points[(i + 1) % pad.points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    // Een achtste van de koorde opzij, loodrecht op het segment.
    curves = bendSegment(pad.points, curves, i, pad.closed, 0.5, dy / 8, -dx / 8);
  }
  return padNaarModel(ann, pad.points, curves);
}

/**
 * Segment `i` buigen: het punt bij parameter `t` verschuift over (dx, dy) op
 * de pagina. Een recht segment wordt een kromme.
 */
export function buigZijde(ann, i, t, dx, dy) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  const curves = bendSegment(pad.points, pad.curves, i, pad.closed, t, dx, dy);
  if (curves === null) return null;
  return padNaarModel(ann, pad.points, curves);
}

/** Een knoop invoegen op segment `i` bij parameter `t`; de vorm blijft gelijk. */
export function voegKnoopIn(ann, i, t) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  const uit = insertNode(pad.points, pad.curves, i, Math.max(0.02, Math.min(0.98, Number.isFinite(t) ? t : 0.5)), pad.closed);
  return uit ? padNaarModel(ann, uit.points, uit.curves) : null;
}

/** Het kleinste aantal knopen van deze vorm. */
export function minKnopen(ann) {
  return ann?.type === 'polyline' ? 2 : VEELHOEK_MIN_PUNTEN;
}

/** Knoop `index` weghalen; null als er dan te weinig overblijven. */
export function verwijderKnoop(ann, index) {
  const pad = padOpScherm(ann);
  if (!pad) return null;
  const uit = deleteNode(pad.points, pad.curves, index, pad.closed, minKnopen(ann));
  return uit ? padNaarModel(ann, uit.points, uit.curves) : null;
}

/**
 * De stuurpunten van de vorm op de pagina, een per krom uiteinde:
 * [{ segment, which, node, x, y, nodeX, nodeY }].
 */
export function stuurpunten(ann) {
  const pad = padOpScherm(ann);
  if (!pad || !pad.curves) return [];
  const uit = [];
  const n = pad.points.length;
  pad.curves.forEach((s, i) => {
    if (!s) return;
    const a = pad.points[i], b = pad.points[(i + 1) % n];
    uit.push({ segment: i, which: 1, node: i, x: a.x + s.c1x, y: a.y + s.c1y, nodeX: a.x, nodeY: a.y });
    uit.push({ segment: i, which: 2, node: (i + 1) % n, x: b.x + s.c2x, y: b.y + s.c2y, nodeX: b.x, nodeY: b.y });
  });
  return uit;
}

/** De knoop waar stuurpunt (`segment`, `which`) aan vastzit. */
export function knoopVanStuurpunt(ann, segment, which) {
  const pad = padOpScherm(ann);
  if (!pad) return -1;
  return which === 1 ? segment : (segment + 1) % pad.points.length;
}

/** Is knoop `node` vloeiend (stuurpunten in elkaars verlengde)? */
export function isVloeiendeKnoop(ann, node) {
  const pad = padOpScherm(ann);
  return !!pad && isSmoothNode(pad.points, pad.curves, node, pad.closed);
}

/**
 * Stuurpunt (`segment`, `which`) naar het paginapunt (x, y) zetten.
 * opties.vloeiend: het stuurpunt aan de overkant van de knoop draait mee.
 * opties.shift: de richting op een veelvoud van 45° vanaf de knoop.
 */
export function verzetStuurpunt(ann, segment, which, x, y, opties = {}) {
  const pad = padOpScherm(ann);
  if (!pad || !pad.curves || !pad.curves[segment]) return null;
  const knoop = pad.points[which === 1 ? segment : (segment + 1) % pad.points.length];
  let dx = x - knoop.x, dy = y - knoop.y;
  if (opties.shift) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const stap = Math.PI / 4;
      const hoek = Math.round(Math.atan2(dy, dx) / stap) * stap;
      dx = len * Math.cos(hoek);
      dy = len * Math.sin(hoek);
    }
  }
  const curves = moveHandle(pad.points, pad.curves, segment, which, pad.closed, dx, dy, { smooth: !!opties.vloeiend });
  if (curves === null) return null;
  return padNaarModel(ann, pad.points, curves);
}

/**
 * De krommen van een polylijn meedraaien of -schalen als code zijn knopen
 * door een lineaire afbeelding haalt (canvas-volgorde a, b, c, d). Voor een
 * veelhoek niet nodig bij draaien: die draait via zijn hoek.
 */
export function transformeerKrommen(ann, a, b, c, d) {
  if (!ann || !hasCurves(ann.curves)) return ann;
  ann.curves = transformCurves(ann.curves, a, b, c, d);
  return ann;
}

/** De krommen over `graden` draaien (met de klok mee op het scherm). */
export function draaiKrommen(ann, graden) {
  if (!ann || !hasCurves(ann.curves) || !graden) return ann;
  ann.curves = rotateCurves(ann.curves, graden);
  return ann;
}

/**
 * Krommen uit een opgave van buiten (de MCP-brug): een lijst met een plek per
 * segment, elk null (recht) of { c1x, c1y, c2x, c2y }. Geeft
 * { ok: true, curves } (undefined zonder kromme) of { ok: false, error }.
 * Een kortere lijst mag: de ontbrekende segmenten zijn recht.
 */
export function leesKrommenOpgave(curves, aantalKnopen, closed) {
  if (curves === null || curves === undefined) return { ok: true, curves: undefined };
  const segs = segmentCount(aantalKnopen, closed);
  if (!Array.isArray(curves)) {
    return { ok: false, error: 'curves must be an array with one entry per segment: null or {c1x, c1y, c2x, c2y}' };
  }
  if (curves.length > segs) {
    return { ok: false, error: `curves has ${curves.length} entries but the shape has ${segs} segments` };
  }
  for (let i = 0; i < curves.length; i++) {
    const s = curves[i];
    if (s === null || s === undefined) continue;
    const goed = typeof s === 'object'
      && [s.c1x, s.c1y, s.c2x, s.c2y].every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!goed) return { ok: false, error: `curves[${i}] must be null or {c1x, c1y, c2x, c2y} with finite numbers` };
  }
  return { ok: true, curves: normalizeCurves(curves, segs) };
}
