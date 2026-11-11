// Parametrisch WAPENINGSNET in plattegrond — tekenwijze volgens ISO 3766: de
// netomtrek op ware grootte met één diagonaal, een kort haaks streepje aan het
// begin van de diagonaal (linksonder) en langs de diagonaal het netlabel
// "Ø8-150/Ø8-150" plus de netmaat en de laag. Een bovennet wordt gestreept
// getekend, een onder-net doorgetrokken.
//
// Een RIJ gelijke netten (aantalNetten > 1) ligt naast elkaar in de
// lengterichting met een overlap: de omtrek van de hele rij, op elke overlap
// de randen van de twee netten als twee evenwijdige lijnen, en één doorgaande
// diagonaal met het label "3× Ø8-150/Ø8-150".
//
// Het net levert twee staafposities aan de buigstaat (quantities/wapening.js):
// de staven in de lengterichting (aantal over de breedte) en die in de
// breedterichting (aantal over de lengte), × het aantal netten.

import { STAALKWALITEITEN, aantalOverBreedte, staafNotatie } from '../../quantities/wapening.js';
import {
  getal, geheelGetal, pasIn, tekstBreedte, tekstMetDiameter, staafnummerBol,
  staafnummerStraal, bboxSnapPunten,
} from './wapening-tekst.js';

export const NET_STANDAARD_KWALITEIT = 'B500A';
export const NET_STANDAARD_OVERLAP = 300;

export function wapeningsnetParams(params = {}) {
  const p = params || {};
  const kw = String(p.staalkwaliteit || NET_STANDAARD_KWALITEIT).toUpperCase();
  const lengte = getal(p.lengte, 5000, 100);
  return {
    lengte,
    breedte: getal(p.breedte, 2150, 100),
    diameterL: getal(p.diameterL, 8, 1),
    afstandL: getal(p.afstandL, 150, 10),
    diameterB: getal(p.diameterB, 8, 1),
    afstandB: getal(p.afstandB, 150, 10),
    laag: p.laag === 'boven' ? 'boven' : 'onder',
    aantalNetten: geheelGetal(p.aantalNetten, 1, 1),
    // Overlap tussen twee netten in de rij; hooguit de halve netlengte, zodat
    // elk net de rij nog verlengt.
    overlap: Math.min(getal(p.overlap, NET_STANDAARD_OVERLAP, 0), lengte / 2),
    staafnummerL: String(p.staafnummerL ?? '').trim(),
    staafnummerB: String(p.staafnummerB ?? '').trim(),
    staalkwaliteit: STAALKWALITEITEN.includes(kw) ? kw : NET_STANDAARD_KWALITEIT,
  };
}

/** Netnotatie "Ø8-150/Ø8-150" (lengterichting / breedterichting). */
export function netNotatie(params) {
  const p = wapeningsnetParams(params);
  const l = staafNotatie({ diameter: p.diameterL, afstand: p.afstandL });
  const b = staafNotatie({ diameter: p.diameterB, afstand: p.afstandB });
  return `${p.aantalNetten > 1 ? `${p.aantalNetten}× ` : ''}${l}/${b}`;
}

/** Tweede labelregel: "5000×2150 onder B500A". */
export function netOnderschrift(params) {
  const p = wapeningsnetParams(params);
  return `${Math.round(p.lengte)}×${Math.round(p.breedte)} ${p.laag} ${p.staalkwaliteit}`;
}

/** Staafaantallen en -lengtes van één net. */
export function netStaven(params) {
  const p = wapeningsnetParams(params);
  return {
    lengterichting: { aantal: aantalOverBreedte(p.breedte, p.afstandL), lengteMm: Math.round(p.lengte) },
    breedterichting: { aantal: aantalOverBreedte(p.lengte, p.afstandB), lengteMm: Math.round(p.breedte) },
  };
}

/** Totale lengte van de rij: aantal × lengte − (aantal − 1) × overlap. */
export function rijLengte(params) {
  const p = wapeningsnetParams(params);
  return p.aantalNetten * p.lengte - (p.aantalNetten - 1) * p.overlap;
}

/**
 * Opmaak in lokale mm (y omlaag): label, diagonaal met onderbreking, het
 * streepje aan het begin van de diagonaal en de netranden op de overlappen.
 */
export function wapeningsnetLayout(params) {
  const p = wapeningsnetParams(params);
  const r1 = netNotatie(p);
  const r2 = netOnderschrift(p);
  const nr = p.staafnummerL || p.staafnummerB;
  const totaal = rijLengte(p);
  // Tekengrootte: past in 85 % van de rijlengte en hooguit 9 % van de breedte.
  const perFont = Math.max(tekstBreedte(r1, 1) + (nr ? 2 * staafnummerStraal(nr, 1) + 0.6 : 0), tekstBreedte(r2, 1));
  const font = Math.max(1, Math.min(p.breedte * 0.09, (totaal * 0.85) / perFont));
  const cx = totaal / 2, cy = p.breedte / 2;
  const hw = (perFont * font) / 2 + font * 0.4;
  const hh = font * 1.5;
  const g = Math.min(hw / totaal, hh / p.breedte);
  const t0 = 0.5 - g;
  // Haaks streepje aan het begin van de diagonaal (linksonder → rechtsboven).
  // Het ligt net zo ver op de diagonaal dat het binnen de omtrek blijft, en
  // krimpt als het anders in de onderbreking voor het label zou komen.
  const dLen = Math.hypot(totaal, p.breedte);
  const ux = totaal / dLen, uy = -p.breedte / dLen;
  let half = Math.min(font * 0.6, Math.min(totaal, p.breedte) * 0.06);
  let s = half * Math.max(totaal / p.breedte, p.breedte / totaal);
  const sMax = t0 * dLen * 0.6;
  if (s > sMax) { half *= sMax / s; s = sMax; }
  const mx = ux * s, my = p.breedte + uy * s;
  // Randen van de netten op elke overlap: begin van het volgende net en eind
  // van het vorige. Zonder overlap vallen ze samen tot één naad.
  const overlappen = [];
  for (let i = 1; i < p.aantalNetten; i++) {
    const begin = i * (p.lengte - p.overlap);
    overlappen.push(begin);
    if (p.overlap > 0) overlappen.push(begin + p.overlap);
  }
  return {
    p, r1, r2, nr, font,
    label: { cx, cy, hw, hh },
    diagonaal: { t0, t1: 0.5 + g },
    beginstreep: { x1: mx + uy * half, y1: my - ux * half, x2: mx - uy * half, y2: my + ux * half },
    overlappen,
    footprint: { width: totaal, height: p.breedte },
  };
}

function rebarItems(params) {
  const p = wapeningsnetParams(params);
  const s = netStaven(p);
  return [
    {
      staafnummer: p.staafnummerL, diameter: p.diameterL, afstand: p.afstandL,
      aantal: s.lengterichting.aantal * p.aantalNetten, lengteMm: s.lengterichting.lengteMm,
      vormcode: '00', staalkwaliteit: p.staalkwaliteit, omschrijving: 'net',
    },
    {
      staafnummer: p.staafnummerB, diameter: p.diameterB, afstand: p.afstandB,
      aantal: s.breedterichting.aantal * p.aantalNetten, lengteMm: s.breedterichting.lengteMm,
      vormcode: '00', staalkwaliteit: p.staalkwaliteit, omschrijving: 'net',
    },
  ];
}

export const wapeningsnetTemplate = {
  id: 'wapeningsnet',
  name: 'Wapeningsnet (plattegrond)',
  nameEn: 'Reinforcement mesh (plan)',
  category: 'NL Constructie',
  defaultSize: { width: 250, height: 108 },
  fixedSize: true,
  zoektermen: ['net', 'wapeningsnet', 'mesh', 'stalen net', 'bovennet', 'ondernet'],
  params: [
    { key: 'lengte', label: 'Netlengte (mm)', labelEn: 'Mesh length (mm)', type: 'number', default: 5000, min: 100, step: 50 },
    { key: 'breedte', label: 'Netbreedte (mm)', labelEn: 'Mesh width (mm)', type: 'number', default: 2150, min: 100, step: 50 },
    { key: 'diameterL', label: 'Ø lengterichting (mm)', labelEn: 'Ø longitudinal (mm)', type: 'number', default: 8, min: 4, step: 1 },
    { key: 'afstandL', label: 'H.o.h. lengterichting (mm)', labelEn: 'Spacing longitudinal (mm)', type: 'number', default: 150, min: 10, step: 25 },
    { key: 'diameterB', label: 'Ø breedterichting (mm)', labelEn: 'Ø transverse (mm)', type: 'number', default: 8, min: 4, step: 1 },
    { key: 'afstandB', label: 'H.o.h. breedterichting (mm)', labelEn: 'Spacing transverse (mm)', type: 'number', default: 150, min: 10, step: 25 },
    {
      key: 'laag', label: 'Laag', labelEn: 'Layer', type: 'enum', default: 'onder',
      options: [{ value: 'onder', label: 'Onder (doorgetrokken)' }, { value: 'boven', label: 'Boven (gestreept)' }],
    },
    { key: 'aantalNetten', label: 'Aantal netten', labelEn: 'Number of meshes', type: 'number', default: 1, min: 1, step: 1 },
    { key: 'overlap', label: 'Overlap (mm)', labelEn: 'Lap (mm)', type: 'number', default: NET_STANDAARD_OVERLAP, min: 0, step: 50 },
    { key: 'staafnummerL', label: 'Staafnummer lengterichting', labelEn: 'Bar mark longitudinal', type: 'string', default: '' },
    { key: 'staafnummerB', label: 'Staafnummer breedterichting', labelEn: 'Bar mark transverse', type: 'string', default: '' },
    {
      key: 'staalkwaliteit', label: 'Staalkwaliteit', labelEn: 'Steel grade', type: 'enum',
      default: NET_STANDAARD_KWALITEIT, options: STAALKWALITEITEN,
    },
  ],
  layout: wapeningsnetLayout,
  rebarItems,
  realSizeMm(params) {
    const p = wapeningsnetParams(params);
    return { width: rijLengte(p), height: p.breedte };
  },
  // De bbox is de omtrek van de hele rij, dus de bbox-punten volgen de rij.
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = wapeningsnetLayout(params);
    const { p } = L;
    const W = L.footprint.width;
    const { S, X, Y } = pasIn(L.footprint.width, L.footprint.height, bbox);
    const f = L.font * S;
    const dash = p.laag === 'boven' ? [Math.max(3, f * 0.6), Math.max(2, f * 0.35)] : undefined;
    const cmds = [];
    const omtrek = {
      kind: 'polyline', close: true, role: 'net',
      points: [
        { x: X(0), y: Y(0) }, { x: X(W), y: Y(0) },
        { x: X(W), y: Y(p.breedte) }, { x: X(0), y: Y(p.breedte) },
      ],
    };
    if (dash) omtrek.dash = dash;
    cmds.push(omtrek);
    // Netranden op de overlappen, over de volle breedte.
    // Een rand die door het label zou lopen (even aantal netten: de overlap
    // ligt midden in de rij) wordt daar onderbroken, net als de diagonaal.
    for (const x of L.overlappen) {
      const doorLabel = Math.abs(x - L.label.cx) < L.label.hw;
      const delen = doorLabel
        ? [[0, L.label.cy - L.label.hh], [L.label.cy + L.label.hh, p.breedte]]
        : [[0, p.breedte]];
      for (const [v0, v1] of delen) {
        if (v1 <= v0) continue;
        const rand = { kind: 'line', x1: X(x), y1: Y(v0), x2: X(x), y2: Y(v1), role: 'overlap' };
        if (dash) rand.dash = dash;
        cmds.push(rand);
      }
    }
    // Eén diagonaal linksonder → rechtsboven over de hele rij, onderbroken
    // rond het label.
    const pt = (t) => ({ x: X(t * W), y: Y(p.breedte - t * p.breedte) });
    for (const [t0, t1] of [[0, L.diagonaal.t0], [L.diagonaal.t1, 1]]) {
      if (t1 <= t0) continue;
      const a = pt(t0), b = pt(t1);
      const lijn = { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, role: 'diagonaal' };
      if (dash) lijn.dash = dash;
      cmds.push(lijn);
    }
    const bs = L.beginstreep;
    cmds.push({ kind: 'line', x1: X(bs.x1), y1: Y(bs.y1), x2: X(bs.x2), y2: Y(bs.y2), role: 'beginstreep' });
    const cx = X(L.label.cx);
    const y1 = Y(L.label.cy) - f * 0.65;
    const y2 = Y(L.label.cy) + f * 0.65;
    const w1 = tekstBreedte(L.r1, f);
    const bolR = L.nr ? staafnummerStraal(L.nr, f) : 0;
    const totaal = w1 + (bolR ? 2 * bolR + f * 0.6 : 0);
    let x = cx - totaal / 2;
    if (bolR) {
      cmds.push(...staafnummerBol(L.nr, x + bolR, y1, f));
      x += 2 * bolR + f * 0.6;
    }
    cmds.push(...tekstMetDiameter(L.r1, x + w1 / 2, y1, f, { role: 'label' }));
    cmds.push({ kind: 'text', x: cx, y: y2, text: L.r2, size: f * 0.85, role: 'onderschrift' });
    return cmds;
  },
};
