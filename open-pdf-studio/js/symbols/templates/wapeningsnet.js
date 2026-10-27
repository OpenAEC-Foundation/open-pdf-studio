// Parametrisch WAPENINGSNET in plattegrond — Nederlandse tekenwijze: de
// netomtrek op ware grootte met één diagonaal en het netlabel
// "Ø8-150/Ø8-150" plus de netmaat en de laag. Een bovennet wordt gestreept
// getekend, een onder-net doorgetrokken.
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

export function wapeningsnetParams(params = {}) {
  const p = params || {};
  const kw = String(p.staalkwaliteit || NET_STANDAARD_KWALITEIT).toUpperCase();
  return {
    lengte: getal(p.lengte, 5000, 100),
    breedte: getal(p.breedte, 2150, 100),
    diameterL: getal(p.diameterL, 8, 1),
    afstandL: getal(p.afstandL, 150, 10),
    diameterB: getal(p.diameterB, 8, 1),
    afstandB: getal(p.afstandB, 150, 10),
    laag: p.laag === 'boven' ? 'boven' : 'onder',
    aantalNetten: geheelGetal(p.aantalNetten, 1, 1),
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

/** Opmaak in lokale mm (y omlaag): label, diagonaal met onderbreking. */
export function wapeningsnetLayout(params) {
  const p = wapeningsnetParams(params);
  const r1 = netNotatie(p);
  const r2 = netOnderschrift(p);
  const nr = p.staafnummerL || p.staafnummerB;
  // Tekengrootte: past in 85 % van de netlengte en hooguit 9 % van de breedte.
  const perFont = Math.max(tekstBreedte(r1, 1) + (nr ? 2 * staafnummerStraal(nr, 1) + 0.6 : 0), tekstBreedte(r2, 1));
  const font = Math.max(1, Math.min(p.breedte * 0.09, (p.lengte * 0.85) / perFont));
  const cx = p.lengte / 2, cy = p.breedte / 2;
  const hw = (perFont * font) / 2 + font * 0.4;
  const hh = font * 1.5;
  const g = Math.min(hw / p.lengte, hh / p.breedte);
  return {
    p, r1, r2, nr, font,
    label: { cx, cy, hw, hh },
    diagonaal: { t0: 0.5 - g, t1: 0.5 + g },
    footprint: { width: p.lengte, height: p.breedte },
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
    return { width: p.lengte, height: p.breedte };
  },
  snapPoints: bboxSnapPunten,
  render(params, bbox) {
    const L = wapeningsnetLayout(params);
    const { p } = L;
    const { S, X, Y } = pasIn(L.footprint.width, L.footprint.height, bbox);
    const f = L.font * S;
    const dash = p.laag === 'boven' ? [Math.max(3, f * 0.6), Math.max(2, f * 0.35)] : undefined;
    const cmds = [];
    const omtrek = {
      kind: 'polyline', close: true, role: 'net',
      points: [
        { x: X(0), y: Y(0) }, { x: X(p.lengte), y: Y(0) },
        { x: X(p.lengte), y: Y(p.breedte) }, { x: X(0), y: Y(p.breedte) },
      ],
    };
    if (dash) omtrek.dash = dash;
    cmds.push(omtrek);
    // Diagonaal linksonder → rechtsboven, onderbroken rond het label.
    const pt = (t) => ({ x: X(t * p.lengte), y: Y(p.breedte - t * p.breedte) });
    for (const [t0, t1] of [[0, L.diagonaal.t0], [L.diagonaal.t1, 1]]) {
      if (t1 <= t0) continue;
      const a = pt(t0), b = pt(t1);
      const lijn = { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, role: 'diagonaal' };
      if (dash) lijn.dash = dash;
      cmds.push(lijn);
    }
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
