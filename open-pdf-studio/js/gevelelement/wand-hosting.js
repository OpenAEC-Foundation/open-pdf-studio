// Wandhosting van een gevelelement — de ENIGE plek waar een gevelelement
// (vliesgevel of kozijn) een wand onderbreekt.
//
// Net als een deur of raam uit app_floorplan (plattegrond/sparing.js) wordt
// de wand niet "doorzichtig gemaakt" maar OPGEKNIPT: de wand-annotatie houdt
// zijn solide stukken, het element zit in het gat. De bestaande
// wandrenderer zet op elk vrij einde een dagkant en stopt de arcering daar.
//
// ── Raakvlak ─────────────────────────────────────────────────────────────
//
// plaatsInWand(wand, plaats, pxPerMm)
//   wand   { id, startX, startY, endX, endY, dikteMm }
//          hartlijn in paginapunten, dikte in werkelijke mm.
//   plaats { vanMm | hartMm, lengteMm, offsetMm? }
//          vanMm    afstand van het beginpunt van de wand tot het BEGIN van
//                   het element, langs de hartlijn (mm);
//          hartMm   idem tot het MIDDEN van het element (alternatief);
//          lengteMm lengte van het element = breedte van het gat;
//          offsetMm plaats van de elementlijn in het wandpakket: afstand tot
//                   de hartlijn van de wand, dwars gemeten, + = rechts van de
//                   wandrichting (de n-zijde uit wand-geometrie.js). 0 = in
//                   het midden van de wand.
//   → { ok, error?,
//       lijn:   { startX, startY, endX, endY }  de elementlijn, in de
//               richting van de wand (paginapunten);
//       gat:    { vanMm, totMm }                 langs de wandhartlijn;
//       stukken:[{ startX, startY, endX, endY, vanPt, totPt, lengteMm }]
//               de solide wandstukken die blijven (0, 1 of 2);
//       host:   { wandId, vanMm, lengteMm, offsetMm, dikteMm } }
//
// Het `host`-object gaat mee in de parameters van het element
// (params.host). Een spouwmuur bestaat uit losse laagwanden; wie per laag
// een sparing wil (aanslag in het buitenblad, dagkant in het binnenblad),
// roept plaatsInWand per laagwand aan met hetzelfde gat.
//
// wandSnedePlan(wandAnnotatie, stukken)
//   → { wijzig: { id, props } | null, nieuw: [props], verwijder: id | null }
//   Wat er met de wand-annotatie moet gebeuren: het eerste stuk hergebruikt
//   de bestaande annotatie (zelfde id, zelfde stijl), een tweede stuk wordt
//   een nieuwe wand met dezelfde eigenschappen; zonder stukken verdwijnt hij.
//
// zoekHostWand(lijn, wanden, pxPerMm, opties)
//   Welke wand draagt een los getekend element? De wand waarvan de hartlijn
//   evenwijdig loopt aan de elementlijn, die binnen de wanddikte ligt en die
//   het element over zijn hele lengte bevat.

import { wandAs, projecteer } from '../annotations/wand-geometrie.js';
import { wandMetSparingen } from '../plattegrond/sparing.js';

const EPS = 1e-6;

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dikte(wand) {
  const d = getal(wand?.dikteMm);
  return d > 0 ? d : 100;
}

export function plaatsInWand(wand, plaats, pxPerMm) {
  const as = wandAs(wand || {});
  if (!as) return { ok: false, error: 'wall has no length' };
  if (!(pxPerMm > 0)) return { ok: false, error: 'no scale' };
  const lengteMm = getal(plaats?.lengteMm);
  if (!(lengteMm > 0)) return { ok: false, error: 'lengthMm must be > 0' };
  const wandMm = as.len / pxPerMm;
  let vanMm = getal(plaats?.vanMm);
  if (vanMm === null) {
    const hart = getal(plaats?.hartMm);
    vanMm = hart === null ? (wandMm - lengteMm) / 2 : hart - lengteMm / 2;
  }
  const totMm = vanMm + lengteMm;
  if (vanMm < -EPS || totMm > wandMm + EPS) {
    return { ok: false, error: `the element (${Math.round(lengteMm)} mm) does not fit in the wall at ${Math.round(vanMm)} mm (wall is ${Math.round(wandMm)} mm)` };
  }
  const offsetMm = getal(plaats?.offsetMm) ?? 0;
  const halveDikte = dikte(wand) / 2;
  if (Math.abs(offsetMm) > halveDikte + EPS) {
    return { ok: false, error: `offsetMm must lie within the wall thickness (±${halveDikte} mm)` };
  }
  const o = offsetMm * pxPerMm;
  const punt = (tMm) => ({
    x: wand.startX + as.u.x * tMm * pxPerMm + as.n.x * o,
    y: wand.startY + as.u.y * tMm * pxPerMm + as.n.y * o,
  });
  const a = punt(vanMm), b = punt(totMm);
  // Het gat is een "sparing" in de zin van sparing.js: zelfde opknipregels.
  const { segmenten } = wandMetSparingen(
    { ...wand, dikteMm: dikte(wand) },
    [{ id: 'gevelelement', soort: 'raam', hartMm: vanMm + lengteMm / 2, dagmaatMm: lengteMm }],
    pxPerMm,
  );
  return {
    ok: true,
    lijn: { startX: a.x, startY: a.y, endX: b.x, endY: b.y },
    gat: { vanMm, totMm },
    stukken: segmenten,
    host: { wandId: wand.id ?? null, vanMm, lengteMm, offsetMm, dikteMm: dikte(wand) },
  };
}

/** Eigenschappen die een wandstuk NIET van de oorspronkelijke wand erft. */
const GEEN_KOPIE = new Set([
  'id', 'startX', 'startY', 'endX', 'endY', 'x', 'y', 'width', 'height',
  'createdAt', 'modifiedAt', 'selectedSub', '_hoverSub',
]);

export function wandSnedePlan(wandAnnotatie, stukken) {
  const lijst = Array.isArray(stukken) ? stukken : [];
  const geom = (s) => ({ startX: s.startX, startY: s.startY, endX: s.endX, endY: s.endY });
  if (!lijst.length) return { wijzig: null, nieuw: [], verwijder: wandAnnotatie?.id ?? null };
  const stijl = {};
  for (const [k, v] of Object.entries(wandAnnotatie || {})) {
    if (!GEEN_KOPIE.has(k) && typeof v !== 'function') stijl[k] = v;
  }
  return {
    wijzig: { id: wandAnnotatie?.id ?? null, props: geom(lijst[0]) },
    nieuw: lijst.slice(1).map((s) => ({ ...JSON.parse(JSON.stringify(stijl)), ...geom(s) })),
    verwijder: null,
  };
}

/**
 * De wand die een los element draagt, of null.
 * @param lijn     { startX, startY, endX, endY } van het element
 * @param wanden   [{ id, startX, startY, endX, endY, dikteMm }]
 * @param opties   { hoekTolGraden = 1 }
 * @returns {null | { wand, vanMm, lengteMm, offsetMm, omgekeerd }}
 *   `omgekeerd`: het element loopt tegen de wandrichting in.
 */
export function zoekHostWand(lijn, wanden, pxPerMm, opties = {}) {
  const el = wandAs(lijn || {});
  if (!el || !(pxPerMm > 0)) return null;
  const tol = Math.sin(((opties.hoekTolGraden ?? 1) * Math.PI) / 180);
  let beste = null;
  for (const w of wanden || []) {
    const as = wandAs(w || {});
    if (!as) continue;
    const kruis = el.u.x * as.u.y - el.u.y * as.u.x;
    if (Math.abs(kruis) > tol) continue;
    const pa = projecteer({ x: lijn.startX, y: lijn.startY }, w);
    const pb = projecteer({ x: lijn.endX, y: lijn.endY }, w);
    const halve = (dikte(w) / 2) * pxPerMm;
    if (Math.abs(pa.d) > halve + EPS || Math.abs(pb.d) > halve + EPS) continue;
    const t0 = Math.min(pa.t, pb.t), t1 = Math.max(pa.t, pb.t);
    const marge = 0.5 * pxPerMm;                  // een halve mm speling
    if (t0 < -marge || t1 > as.len + marge) continue;
    const afstand = Math.abs((pa.d + pb.d) / 2);
    if (!beste || afstand < beste.afstand) {
      beste = {
        afstand,
        wand: w,
        vanMm: Math.max(0, t0) / pxPerMm,
        lengteMm: (Math.min(as.len, t1) - Math.max(0, t0)) / pxPerMm,
        offsetMm: ((pa.d + pb.d) / 2) / pxPerMm,
        omgekeerd: pa.t > pb.t,
      };
    }
  }
  if (!beste) return null;
  const { afstand: _a, ...uit } = beste;
  return uit;
}
