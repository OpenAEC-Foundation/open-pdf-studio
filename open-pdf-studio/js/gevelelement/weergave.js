// Weergave van een gevelelement in de plattegrond: tekenopdrachten voor het
// parametrische symbool, de vlakken voor het oplichten van een geselecteerd
// onderdeel, en de omrekening tussen paginapunten en de assen van het
// element.
//
// Puur: geen canvas, geen app-state. De tekenopdrachten zijn dezelfde als
// die van elk parametrisch symbool (line, polyline, …; zie de
// parametricSymbol-tak in annotations/rendering.js) en liggen in het
// ONGEDRAAIDE vak van de annotatie — de renderer draait ze om het midden.
//
// Assen in mm: u langs het element (0 = beginpunt), v dwars: v = 0 op het
// BUITENvlak, v = D (de elementdiepte = grootste stijldiepte) op het
// binnenvlak. De elementlijn ligt op v = D/2. Welke kant binnen is volgt uit
// `binnenzijde`: 'rechts' (standaard) = rechts van de tekenrichting, dezelfde
// afspraak als spouwmuurLagen in annotations/wand-geometrie.js.
//
// Vormen-formaat voor uitbreidingen (paneeltype.vormen):
//   { soort: 'vlak', rol?, punten: [{u, v}], vulling?: true|kleur }
//   { soort: 'lijn', rol?, van: {u, v}, tot: {u, v}, streep?: [a, b] }
//   { soort: 'boog', rol?, midden: {u, v}, straal, vanRad, totRad, tegenKlok?, streep? }
// Hoeken van een boog in het (u, v)-vlak: 0 = +u, π/2 = +v; zonder
// `tegenKlok` loopt de hoek van vanRad OP naar totRad, met `tegenKlok` AF
// (zelfde afspraak als canvas arc()).

import { preset as presetVan, stijlType, paneelType } from './catalogus.js';
import { indeling } from './indeling.js';

const BOOG_STAPPEN = 24;

/** Maten van het element in mm: lengte, diepte en de hoogte van het vak. */
export function elementMaat(params, presetId) {
  const lay = indeling(params, presetId);
  let zwaai = 0;
  for (const v of lay.velden) {
    const w = paneelType(v.paneel.type)?.weergave;
    if (w === 'deur' || w === 'draairaam') zwaai = Math.max(zwaai, v.dagMm);
  }
  // Het vak ligt symmetrisch om de elementlijn en omvat de draaicirkel van
  // de breedste deur, zodat ook de opgeslagen weergave (/AP) hem toont.
  return { lengteMm: lay.lengteMm, diepteMm: lay.diepteMm, bandMm: lay.diepteMm + 2 * zwaai };
}

/** Omrekening (u, v) in mm → punt in het ongedraaide vak. */
export function vakAfbeelding(lay, bbox) {
  const k = bbox.width / lay.lengteMm;
  const cy = bbox.y + bbox.height / 2;
  const s = lay.binnenzijde === 'links' ? -1 : 1;
  const D = lay.diepteMm;
  return {
    k,
    punt: (u, v) => ({ x: bbox.x + u * k, y: cy + s * (v - D / 2) * k }),
  };
}

/** Diagonale arcering (45°) van een rechthoek in (u, v): lijnstukken. */
export function arceerRechthoek(u0, u1, v0, v1, stap) {
  const uit = [];
  if (!(stap > 0) || !(u1 > u0) || !(v1 > v0)) return uit;
  // Lijnen u - v = c, van linksonder naar rechtsboven.
  const cMin = u0 - v1, cMax = u1 - v0;
  const eerste = Math.ceil(cMin / stap) * stap;
  for (let c = eerste; c <= cMax + 1e-9; c += stap) {
    const pA = { u: Math.max(u0, c + v0), v: 0 };
    pA.v = pA.u - c;
    const pB = { u: Math.min(u1, c + v1), v: 0 };
    pB.v = pB.u - c;
    if (pB.u - pA.u > 1e-9) uit.push([pA, pB]);
  }
  return uit;
}

/** Punten van een boog in (u, v) van hoek a0 naar a1 (radialen). */
export function boogPunten(midden, straal, a0, a1, stappen = BOOG_STAPPEN) {
  const uit = [];
  for (let i = 0; i <= stappen; i++) {
    const a = a0 + ((a1 - a0) * i) / stappen;
    uit.push({ u: midden.u + straal * Math.cos(a), v: midden.v + straal * Math.sin(a) });
  }
  return uit;
}

function stijlContour(stijl, D) {
  const t = stijlType(stijl.type);
  const onder = (D - stijl.diepteMm) / 2;
  let contour = null;
  if (typeof t?.contour === 'function') {
    try { contour = t.contour({ positie: stijl.rol }); } catch (_) { contour = null; }
  }
  if (!Array.isArray(contour) || contour.length < 3) {
    const h = stijl.breedteMm / 2;
    contour = [{ u: -h, v: 0 }, { u: h, v: 0 }, { u: h, v: stijl.diepteMm }, { u: -h, v: stijl.diepteMm }];
  }
  return contour.map((p) => ({ u: stijl.posMm + p.u, v: onder + p.v }));
}

/**
 * De vormen van één veld in (u, v). Deur en draairaam: het scharnier zit op
 * het vlak aan de draaikant, aan de kant van `scharnier`; het blad staat
 * open (90°) en de boog loopt van de dichte naar de open stand.
 */
export function paneelVormen(lay, veld) {
  const pr = presetVan(lay.preset);
  const type = paneelType(veld.paneel.type);
  const D = lay.diepteMm;
  const a = veld.dagVanMm, b = veld.dagTotMm, w = veld.dagMm;
  if (!(w > 0) || !type) return [];
  if (typeof type.vormen === 'function') {
    try {
      const v = type.vormen({ vanU: a, totU: b, dagMm: w, diepteMm: D, paneel: veld.paneel });
      if (Array.isArray(v)) return v;
    } catch (_) { /* terugval op de standaardweergave */ }
  }
  const glas = () => {
    const g = pr.glasDikteMm / 2;
    return [
      { soort: 'lijn', rol: 'glas', van: { u: a, v: D / 2 - g }, tot: { u: b, v: D / 2 - g } },
      { soort: 'lijn', rol: 'glas', van: { u: a, v: D / 2 + g }, tot: { u: b, v: D / 2 + g } },
    ];
  };
  const draaiend = (streep) => {
    const beginKant = veld.paneel.scharnier !== 'eind';
    const uh = beginKant ? a : b;
    const binnen = veld.paneel.draaiNaar !== 'buiten';
    const vh = binnen ? D : 0;
    const sd = binnen ? 1 : -1;
    const richting = beginKant ? 1 : -1;
    // Boog van de dichte stand (langs u) naar de open stand (langs v), een
    // kwartslag. Hoeken zoals canvas: 0 = +u, π/2 = +v; tegenKlok = afnemend.
    const a0 = beginKant ? 0 : Math.PI;
    const a1 = beginKant ? sd * (Math.PI / 2) : Math.PI - sd * (Math.PI / 2);
    const boog = {
      soort: 'boog', rol: 'draaicirkel', midden: { u: uh, v: vh }, straal: w,
      vanRad: a0, totRad: a1, tegenKlok: a1 < a0,
    };
    if (streep) boog.streep = [3, 2];
    const vormen = [boog];
    if (streep) {
      vormen.push({ soort: 'lijn', rol: 'blad', van: { u: uh, v: vh }, tot: { u: uh, v: vh + sd * w }, streep: [3, 2] });
    } else {
      const t = Math.min(pr.deurDikteMm, w / 4);
      vormen.push({
        soort: 'vlak', rol: 'blad',
        punten: [
          { u: uh, v: vh }, { u: uh + richting * t, v: vh },
          { u: uh + richting * t, v: vh + sd * w }, { u: uh, v: vh + sd * w },
        ],
      });
    }
    return vormen;
  };
  switch (type.weergave) {
    case 'glas': return glas();
    case 'dicht': {
      const t = pr.paneelDikteMm / 2;
      const v0 = D / 2 - t, v1 = D / 2 + t;
      const vormen = [{
        soort: 'vlak', rol: 'paneel',
        punten: [{ u: a, v: v0 }, { u: b, v: v0 }, { u: b, v: v1 }, { u: a, v: v1 }],
      }];
      for (const [p, q] of arceerRechthoek(a, b, v0, v1, pr.paneelDikteMm)) {
        vormen.push({ soort: 'lijn', rol: 'arcering', van: p, tot: q });
      }
      return vormen;
    }
    case 'deur': return draaiend(false);
    case 'draairaam': return [...glas(), ...draaiend(true)];
    default: return [];
  }
}

/** Vormen in (u, v) → tekenopdrachten in het vak. */
export function vormenNaarOpdrachten(vormen, afb) {
  const cmds = [];
  const P = (p) => afb.punt(p.u, p.v);
  for (const f of vormen || []) {
    if (!f) continue;
    if (f.soort === 'lijn') {
      const p = P(f.van), q = P(f.tot);
      const c = { kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      if (Array.isArray(f.streep)) c.dash = f.streep;
      cmds.push(c);
    } else if (f.soort === 'vlak' && Array.isArray(f.punten) && f.punten.length >= 3) {
      const c = { kind: 'polyline', points: f.punten.map(P), close: true };
      if (f.vulling) c.fill = f.vulling;
      cmds.push(c);
    } else if (f.soort === 'boog') {
      // Canvas-afspraak: zonder tegenKlok loopt de hoek op, met tegenKlok af.
      let a0 = f.vanRad, a1 = f.totRad;
      if (f.tegenKlok && a1 > a0) a1 -= 2 * Math.PI;
      if (!f.tegenKlok && a1 < a0) a1 += 2 * Math.PI;
      const punten = boogPunten(f.midden, f.straal, a0, a1).map(P);
      const c = { kind: 'polyline', points: punten };
      if (Array.isArray(f.streep)) c.dash = f.streep;
      cmds.push(c);
    }
  }
  return cmds;
}

/** Alle tekenopdrachten voor het symbool in vak `bbox`. */
export function tekenOpdrachten(params, presetId, bbox) {
  const lay = indeling(params, presetId);
  if (!(bbox?.width > 0)) return [];
  const afb = vakAfbeelding(lay, bbox);
  const cmds = [];
  for (const v of lay.velden) cmds.push(...vormenNaarOpdrachten(paneelVormen(lay, v), afb));
  // Stijlen als laatste: gevuld, op werkelijke maat, over de panelen heen.
  for (const s of lay.stijlen) {
    cmds.push({ kind: 'polyline', points: stijlContour(s, lay.diepteMm).map((p) => afb.punt(p.u, p.v)), close: true, fill: true });
  }
  return cmds;
}

/** Het vlak (vier hoekpunten in het ongedraaide vak) van een onderdeel. */
export function onderdeelVlak(params, presetId, bbox, sub) {
  const lay = indeling(params, presetId);
  if (!sub || !(bbox?.width > 0)) return null;
  const afb = vakAfbeelding(lay, bbox);
  const D = lay.diepteMm;
  let u0, u1, v0, v1;
  if (sub.soort === 'stijl') {
    const s = lay.stijlen[sub.index];
    if (!s) return null;
    u0 = s.vanMm; u1 = s.totMm; v0 = (D - s.diepteMm) / 2; v1 = (D + s.diepteMm) / 2;
  } else if (sub.soort === 'paneel') {
    const v = lay.velden[sub.index];
    if (!v) return null;
    u0 = v.dagVanMm; u1 = v.dagTotMm; v0 = 0; v1 = D;
  } else return null;
  return [afb.punt(u0, v0), afb.punt(u1, v0), afb.punt(u1, v1), afb.punt(u0, v1)];
}

/** Punt in het ongedraaide vak → paginapunt (draaiing om het vakmidden). */
export function vakNaarPagina(bbox, rotatieGraden, p) {
  const r = ((Number(rotatieGraden) || 0) * Math.PI) / 180;
  if (!r) return { x: p.x, y: p.y };
  const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
  const dx = p.x - cx, dy = p.y - cy;
  return { x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) };
}

/**
 * Paginapunt → positie langs het element. `lijn` = { startX, startY, endX,
 * endY } in paginapunten. Geeft { uMm, dMm }: u langs (0 = begin), d dwars
 * (+ = rechts van de tekenrichting), beide in mm.
 */
export function langsElement(lijn, lengteMm, punt) {
  const dx = lijn.endX - lijn.startX, dy = lijn.endY - lijn.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || !(lengteMm > 0)) return null;
  const ux = dx / len, uy = dy / len;
  const rx = punt.x - lijn.startX, ry = punt.y - lijn.startY;
  const k = len / lengteMm;
  return { uMm: (rx * ux + ry * uy) / k, dMm: (rx * -uy + ry * ux) / k };
}

/** Het paginapunt op de elementlijn op `uMm` vanaf het begin. */
export function puntOpElement(lijn, lengteMm, uMm) {
  const t = lengteMm > 0 ? uMm / lengteMm : 0;
  return { x: lijn.startX + (lijn.endX - lijn.startX) * t, y: lijn.startY + (lijn.endY - lijn.startY) * t };
}
