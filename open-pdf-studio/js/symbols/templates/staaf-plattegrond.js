// Parametrische STAAF IN PLATTEGROND — Nederlandse tekenwijze voor een
// staafreeks in een vloer- of wandplattegrond: één representatieve staaf op
// ware lengte (dikke lijn, met eventueel omgezette haken), een verdeellijn
// loodrecht erop over de verdeelbreedte met schuine eindstreepjes, het
// staafnummer in een cirkel en de notatie "12Ø10-150 lg=4580".
//
// Het aantal volgt uit verdeelbreedte / h.o.h. + 1 (of een vast aantal);
// de vorm uit de haken: geen → 00, één → 11, beide → 21. Lengte en aantal
// komen uit quantities/wapening.js, net als in de buigstaat.

import {
  STAALKWALITEITEN, STANDAARD_STAALKWALITEIT, aantalOverBreedte, staafLengte, staafNotatie,
} from '../../quantities/wapening.js';
import {
  getal, geheelGetal, pasIn, tekstBreedte, tekstMetDiameter, staafnummerBol,
  staafnummerStraal, bboxSnapPunten,
} from './wapening-tekst.js';

const HAKEN = ['geen', 'begin', 'eind', 'beide'];

export function staafPlattegrondParams(params = {}) {
  const p = params || {};
  const kw = String(p.staalkwaliteit || STANDAARD_STAALKWALITEIT).toUpperCase();
  return {
    staafnummer: String(p.staafnummer ?? '1').trim(),
    diameter: getal(p.diameter, 10, 1),
    afstand: getal(p.afstand, 150, 1),
    verdeelbreedte: getal(p.verdeelbreedte, 1800, 0),
    aantal: geheelGetal(p.aantal, 0, 0),
    lengte: getal(p.lengte, 4000, 50),
    haken: HAKEN.includes(p.haken) ? p.haken : 'geen',
    haaklengte: getal(p.haaklengte, 300, 0),
    verdeelPositie: Math.max(0, Math.min(100, getal(p.verdeelPositie, 30))),
    labelZijde: p.labelZijde === 'onder' ? 'onder' : 'boven',
    staalkwaliteit: STAALKWALITEITEN.includes(kw) ? kw : STANDAARD_STAALKWALITEIT,
  };
}

/** Vormcode en buitenmaten volgens de haken. */
export function staafPlattegrondVorm(params) {
  const p = staafPlattegrondParams(params);
  switch (p.haken) {
    case 'begin':
    case 'eind': return { vormcode: '11', seg: { a: p.lengte, b: p.haaklengte } };
    case 'beide': return { vormcode: '21', seg: { a: p.haaklengte, b: p.lengte, c: p.haaklengte } };
    default: return { vormcode: '00', seg: { a: p.lengte } };
  }
}

/** Aantal staven: vast aantal, anders verdeelbreedte / h.o.h. + 1. */
export function staafPlattegrondAantal(params) {
  const p = staafPlattegrondParams(params);
  return p.aantal > 0 ? p.aantal : aantalOverBreedte(p.verdeelbreedte, p.afstand);
}

export function staafPlattegrondLengte(params) {
  const p = staafPlattegrondParams(params);
  const v = staafPlattegrondVorm(p);
  return staafLengte(v.vormcode, v.seg, p.diameter);
}

export function staafPlattegrondLabel(params) {
  const p = staafPlattegrondParams(params);
  const n = staafPlattegrondAantal(p);
  return `${staafNotatie({ aantal: n, diameter: p.diameter, afstand: p.afstand })} lg=${staafPlattegrondLengte(p)}`;
}

/** Opmaak in lokale mm (y omlaag). */
export function staafPlattegrondLayout(params) {
  const p = staafPlattegrondParams(params);
  const W = p.lengte;
  const H = Math.max(p.verdeelbreedte, 300);
  const label = staafPlattegrondLabel(p);
  const perFont = tekstBreedte(label, 1) + (p.staafnummer ? 2 * staafnummerStraal(p.staafnummer, 1) + 0.6 : 0);
  const font = Math.max(1, Math.min(H * 0.1, (W * 0.6) / perFont, 250));
  const staafY = H / 2;
  // De schuine eindstreepjes van de verdeellijn moeten binnen de staaf blijven.
  const verdeelX = Math.max(font * 0.5, Math.min(W - font * 0.5, W * p.verdeelPositie / 100));
  const labelW = perFont * font;
  // Label naast de verdeellijn, binnen de staaflengte gehouden.
  let labelX = verdeelX + font * 0.6;
  if (labelX + labelW > W) labelX = Math.max(0, verdeelX - font * 0.6 - labelW);
  const labelY = p.labelZijde === 'onder' ? staafY + font * 1.1 : staafY - font * 1.1;
  const haak = Math.min(p.haaklengte, H * 0.25);
  return {
    p, label, font, W, H, staafY, verdeelX, labelX, labelY, labelW, haak,
    footprint: { width: W, height: H },
  };
}

function rebarItems(params) {
  const p = staafPlattegrondParams(params);
  const v = staafPlattegrondVorm(p);
  return [{
    staafnummer: p.staafnummer,
    diameter: p.diameter,
    aantal: staafPlattegrondAantal(p),
    lengteMm: staafPlattegrondLengte(p),
    vormcode: v.vormcode,
    staalkwaliteit: p.staalkwaliteit,
    afstand: p.afstand,
  }];
}

export const staafPlattegrondTemplate = {
  id: 'staaf-plattegrond',
  name: 'Staaf in plattegrond',
  nameEn: 'Bar in plan',
  category: 'NL Constructie',
  defaultSize: { width: 320, height: 144 },
  fixedSize: true,
  zoektermen: ['staaf', 'staafreeks', 'verdeellijn', 'vloerwapening', 'bar in plan'],
  params: [
    { key: 'staafnummer', label: 'Staafnummer', labelEn: 'Bar mark', type: 'string', default: '1' },
    { key: 'diameter', label: 'Diameter Ø (mm)', labelEn: 'Diameter Ø (mm)', type: 'number', default: 10, min: 4, step: 2 },
    { key: 'afstand', label: 'H.o.h.-afstand (mm)', labelEn: 'Spacing (mm)', type: 'number', default: 150, min: 10, step: 25 },
    { key: 'verdeelbreedte', label: 'Verdeelbreedte (mm)', labelEn: 'Distribution width (mm)', type: 'number', default: 1800, min: 0, step: 50 },
    { key: 'aantal', label: 'Aantal (0 = uit verdeling)', labelEn: 'Number (0 = from distribution)', type: 'number', default: 0, min: 0, step: 1 },
    { key: 'lengte', label: 'Staaflengte recht (mm)', labelEn: 'Straight bar length (mm)', type: 'number', default: 4000, min: 50, step: 50 },
    {
      key: 'haken', label: 'Omgezette einden', labelEn: 'Bent ends', type: 'enum', default: 'geen',
      options: [
        { value: 'geen', label: 'Geen (recht)' },
        { value: 'begin', label: 'Begin' },
        { value: 'eind', label: 'Eind' },
        { value: 'beide', label: 'Beide' },
      ],
    },
    { key: 'haaklengte', label: 'Lengte omzetting (mm)', labelEn: 'Bent leg length (mm)', type: 'number', default: 300, min: 0, step: 10 },
    { key: 'verdeelPositie', label: 'Positie verdeellijn (%)', labelEn: 'Distribution line position (%)', type: 'number', default: 30, min: 0, max: 100, step: 5 },
    {
      key: 'labelZijde', label: 'Labelzijde', labelEn: 'Label side', type: 'enum', default: 'boven',
      options: [{ value: 'boven', label: 'Boven' }, { value: 'onder', label: 'Onder' }],
    },
    {
      key: 'staalkwaliteit', label: 'Staalkwaliteit', labelEn: 'Steel grade', type: 'enum',
      default: STANDAARD_STAALKWALITEIT, options: STAALKWALITEITEN,
    },
  ],
  layout: staafPlattegrondLayout,
  rebarItems,
  realSizeMm(params) {
    const L = staafPlattegrondLayout(params);
    return { width: L.W, height: L.H };
  },
  snapPoints(params, bbox) {
    const L = staafPlattegrondLayout(params);
    const { X, Y } = pasIn(L.W, L.H, bbox);
    return [
      { kind: 'endpoint', x: X(0), y: Y(L.staafY) },
      { kind: 'midpoint', x: X(L.W / 2), y: Y(L.staafY) },
      { kind: 'endpoint', x: X(L.W), y: Y(L.staafY) },
      { kind: 'endpoint', x: X(L.verdeelX), y: Y(0) },
      { kind: 'endpoint', x: X(L.verdeelX), y: Y(L.H) },
      ...bboxSnapPunten(params, bbox).slice(1),
    ];
  },
  render(params, bbox) {
    const L = staafPlattegrondLayout(params);
    const { p } = L;
    const { S, X, Y } = pasIn(L.W, L.H, bbox);
    const f = L.font * S;
    const cmds = [];
    const staafLw = Math.max(0.8, Math.min(3, f * 0.16));
    // Staaf met omgezette einden (korte haak naar beneden in plattegrond).
    const punten = [];
    if (p.haken === 'begin' || p.haken === 'beide') punten.push({ x: X(0), y: Y(L.staafY + L.haak) });
    punten.push({ x: X(0), y: Y(L.staafY) }, { x: X(L.W), y: Y(L.staafY) });
    if (p.haken === 'eind' || p.haken === 'beide') punten.push({ x: X(L.W), y: Y(L.staafY + L.haak) });
    cmds.push({ kind: 'polyline', role: 'staaf', lineWidth: staafLw, points: punten });
    // Verdeellijn met schuine eindstreepjes (45°).
    const vx = X(L.verdeelX);
    const t = f * 0.45;
    cmds.push({ kind: 'line', x1: vx, y1: Y(0), x2: vx, y2: Y(L.H), role: 'verdeellijn' });
    for (const y of [Y(0) + t, Y(L.H) - t]) {
      cmds.push({ kind: 'line', x1: vx - t, y1: y + t, x2: vx + t, y2: y - t, role: 'verdeellijn' });
    }
    // Label: staafnummer + notatie.
    let x = X(L.labelX);
    const ly = Y(L.labelY);
    if (p.staafnummer) {
      const r = staafnummerStraal(p.staafnummer, f);
      cmds.push(...staafnummerBol(p.staafnummer, x + r, ly, f));
      x += 2 * r + f * 0.6;
    }
    const w = tekstBreedte(L.label, f);
    cmds.push(...tekstMetDiameter(L.label, x + w / 2, ly, f, { role: 'label' }));
    return cmds;
  },
};
