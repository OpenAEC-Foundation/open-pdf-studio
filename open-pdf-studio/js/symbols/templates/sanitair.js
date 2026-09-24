// Parametrische sanitair-symbolen (#478): wandcloset, staand closet, fontein
// en hoekfontein — in plattegrond, op werkelijke maat.
//
// Tekenwijze zoals op een Nederlandse bouwkundige plattegrond: de omtrek van
// het toestel met de pot/bak erin, de kraan als klein rondje. Elk toestel
// staat met zijn ACHTERKANT (wandzijde) aan de bovenrand van het ongedraaide
// symbool; draaien gaat via de rotatie van de annotatie (90 = wand rechts,
// 180 = wand onder, 270 = wand links).
//
// De geometrie is per toestel een pure functie in millimeters (zie
// mm-tekening.js); render() zet die op het symboolvak.

import {
  maatWaarde, rondAf, rechthoek, ellipsPunten, ellips, spiegel, naarVak,
} from './mm-tekening.js';

const CATEGORIE = 'NL Sanitair';

// Grenzen per maat, gedeeld door de parameterlijst en de geometrie: een half
// ingetypt getal (3 van 360) mag geen piepklein symbool opleveren.
const GRENS = {
  wandcloset: { breedte: [250, 600], diepte: [350, 800] },
  'staand-closet': { breedte: [250, 600], diepte: [450, 900] },
  fontein: { breedte: [200, 800], diepte: [150, 500] },
  hoekfontein: { breedte: [200, 600], diepte: [200, 600] },
};

const STANDAARD = {
  wandcloset: { breedte: 360, diepte: 530 },
  'staand-closet': { breedte: 380, diepte: 680 },
  fontein: { breedte: 380, diepte: 250 },
  hoekfontein: { breedte: 330, diepte: 330 },
};

function maatVan(id, params = {}) {
  const g = GRENS[id];
  const s = STANDAARD[id];
  return {
    breedte: maatWaarde(params.breedte, s.breedte, g.breedte[0], g.breedte[1]),
    diepte: maatWaarde(params.diepte, s.diepte, g.diepte[0], g.diepte[1]),
  };
}

function maatParams(id, labelDiepte, labelDiepteEn) {
  const g = GRENS[id];
  const s = STANDAARD[id];
  return [
    { key: 'breedte', label: 'Breedte', labelEn: 'Width', type: 'number', unit: 'mm',
      default: s.breedte, min: g.breedte[0], max: g.breedte[1], step: 10 },
    { key: 'diepte', label: labelDiepte, labelEn: labelDiepteEn, type: 'number', unit: 'mm',
      default: s.diepte, min: g.diepte[0], max: g.diepte[1], step: 10 },
  ];
}

const SPIEGELEN = { key: 'spiegelen', label: 'Spiegelen', labelEn: 'Mirror', type: 'boolean', default: false };

// ── Geometrie (mm) ───────────────────────────────────────────────────────

/**
 * Wandcloset: de pot hangt aan de wand. Recht achterstuk over de volle
 * breedte, daarna een halve ellips naar voren; de brilopening als ellips.
 */
export function wandclosetGeometrie(params = {}) {
  const maat = maatVan('wandcloset', params);
  const B = maat.breedte, D = maat.diepte;
  const schouder = 0.3 * D;
  const pot = {
    kind: 'polyline', close: true, rol: 'pot',
    points: [
      { x: 0, y: 0 }, { x: B, y: 0 },
      ...ellipsPunten(B / 2, schouder, B / 2, D - schouder, 0, Math.PI, 24),
    ],
  };
  const bril = { ...ellips(B / 2, 0.55 * D, 0.32 * B, 0.3 * D), rol: 'bril' };
  return { maat, vormen: [pot, bril] };
}

/**
 * Staand closet met duoblok: reservoir tegen de wand, de pot ervoor, de
 * brilopening als ellips en de spoelknop op het reservoir.
 */
export function staandClosetGeometrie(params = {}) {
  const maat = maatVan('staand-closet', params);
  const B = maat.breedte, D = maat.diepte;
  const resD = 0.26 * D;
  const a = 0.46 * B;
  const schouder = 0.4 * D;
  const reservoir = { kind: 'polyline', close: true, rol: 'reservoir', points: rechthoek(0, 0, B, resD) };
  const pot = {
    kind: 'polyline', close: true, rol: 'pot',
    points: [
      { x: B / 2 - a, y: resD }, { x: B / 2 + a, y: resD },
      ...ellipsPunten(B / 2, schouder, a, D - schouder, 0, Math.PI, 24),
    ],
  };
  const bril = { ...ellips(B / 2, 0.66 * D, 0.3 * B, 0.24 * D), rol: 'bril' };
  const knop = { kind: 'circle', cx: B / 2, cy: resD / 2, r: Math.min(0.05 * B, resD * 0.3), rol: 'spoelknop' };
  return { maat, vormen: [reservoir, pot, bril, knop] };
}

/**
 * Fontein: rechthoekig blad met een ovale bak, kraan achter de bak (in het
 * midden of opzij) en de afvoer in de bak. `spiegelen` zet een zijkraan links.
 */
export function fonteinGeometrie(params = {}) {
  const maat = maatVan('fontein', params);
  const B = maat.breedte, D = maat.diepte;
  const blad = { kind: 'polyline', close: true, rol: 'blad', points: rechthoek(0, 0, B, D) };
  const bakCy = 0.6 * D, bakRy = 0.3 * D;
  const bak = { ...ellips(B / 2, bakCy, 0.36 * B, bakRy), rol: 'bak' };
  const kraanR = 0.055 * D;
  const zijkant = params.kraan === 'zijkant';
  const kraan = {
    kind: 'circle', rol: 'kraan', r: kraanR,
    cx: zijkant ? 0.86 * B : B / 2,
    cy: zijkant ? 0.2 * D : 0.19 * D,
  };
  const afvoer = { kind: 'circle', rol: 'afvoer', cx: B / 2, cy: bakCy, r: 0.04 * D };
  return { maat, vormen: spiegel([blad, bak, kraan, afvoer], B, params.spiegelen === true) };
}

/**
 * Hoekfontein: kwartronde bak in een hoek. De hoek ligt linksboven (tegen
 * de achter- en de linkerwand); gespiegeld rechtsboven.
 */
export function hoekfonteinGeometrie(params = {}) {
  const maat = maatVan('hoekfontein', params);
  const B = maat.breedte, D = maat.diepte;
  const blad = {
    kind: 'polyline', close: true, rol: 'blad',
    points: [{ x: 0, y: 0 }, ...ellipsPunten(0, 0, B, D, 0, Math.PI / 2, 20)],
  };
  const bak = { ...ellips(0.45 * B, 0.45 * D, 0.26 * B, 0.26 * D), rol: 'bak' };
  const kraan = { kind: 'circle', rol: 'kraan', cx: 0.16 * B, cy: 0.16 * D, r: 0.045 * Math.min(B, D) };
  const afvoer = { kind: 'circle', rol: 'afvoer', cx: 0.45 * B, cy: 0.45 * D, r: 0.03 * Math.min(B, D) };
  return { maat, vormen: spiegel([blad, bak, kraan, afvoer], B, params.spiegelen === true) };
}

// ── Templates ────────────────────────────────────────────────────────────

function maakTemplate({ id, name, nameEn, params, geometrie, anker }) {
  return {
    id,
    name,
    nameEn,
    category: CATEGORIE,
    defaultSize: { width: 60, height: 80 },
    params,
    realSizeMm(p) {
      const m = maatVan(id, p || {});
      return { width: m.breedte, height: m.diepte };
    },
    // Grepen: het versleepte vak wordt de nieuwe maat (op 10 mm).
    paramsUitMaat(p, { breedteMm, hoogteMm }) {
      return { ...(p || {}), breedte: rondAf(breedteMm), diepte: rondAf(hoogteMm) };
    },
    // Een nieuwe maat groeit vanaf de wand, niet vanuit het midden.
    maatAnker: anker,
    render(p = {}, bbox) {
      const { maat, vormen } = geometrie(p);
      return naarVak(vormen, maat, bbox);
    },
  };
}

export const wandclosetTemplate = maakTemplate({
  id: 'wandcloset',
  name: 'Wandcloset',
  nameEn: 'Wall-hung WC',
  params: maatParams('wandcloset', 'Diepte', 'Depth'),
  geometrie: wandclosetGeometrie,
  anker: () => 'back',
});

export const staandClosetTemplate = maakTemplate({
  id: 'staand-closet',
  name: 'Staand closet',
  nameEn: 'Floor-standing WC',
  params: maatParams('staand-closet', 'Diepte', 'Depth'),
  geometrie: staandClosetGeometrie,
  anker: () => 'back',
});

export const fonteinTemplate = maakTemplate({
  id: 'fontein',
  name: 'Fontein',
  nameEn: 'Hand basin',
  params: [
    ...maatParams('fontein', 'Diepte', 'Depth'),
    { key: 'kraan', label: 'Kraan', labelEn: 'Tap', type: 'enum', options: [
      { value: 'midden', label: 'Midden' },
      { value: 'zijkant', label: 'Zijkant' },
    ], default: 'midden' },
    SPIEGELEN,
  ],
  geometrie: fonteinGeometrie,
  anker: () => 'back',
});

export const hoekfonteinTemplate = maakTemplate({
  id: 'hoekfontein',
  name: 'Hoekfontein',
  nameEn: 'Corner hand basin',
  params: [...maatParams('hoekfontein', 'Diepte (zijwand)', 'Depth (side wall)'), SPIEGELEN],
  geometrie: hoekfonteinGeometrie,
  // De hoek zelf blijft staan: linksboven, gespiegeld rechtsboven.
  anker: (p) => (p?.spiegelen === true ? 'back-right' : 'back-left'),
});

export const SANITAIR_TEMPLATES = Object.freeze([
  wandclosetTemplate, staandClosetTemplate, fonteinTemplate, hoekfonteinTemplate,
]);
