// Hoeveelheden — element-classificatie + veld-register (pure, geen UI-deps).
// Elk element (annotatie of native pseudo-element) krijgt een categorie en een
// set uitleesbare velden. Eén register, géén per-type code elders.

import { totalBarLengthM } from '../annotations/stavenreeks.js';

// --- Vertaalhaak -----------------------------------------------------------
// Deze module blijft puur: hij kent i18next niet. De UI-laag injecteert via
// setQuantityLabelResolver() een resolver die de sleutel opzoekt in de
// 'properties'-namespace. Zonder resolver (tests, pure aanroepen) valt elk
// label terug op de Engelse basistekst.
let translate = (_key, fallback) => fallback;

export function setQuantityLabelResolver(fn) {
  translate = typeof fn === 'function' ? fn : ((_k, f) => f);
}

/** Vertaal één hoeveelheden-sleutel met Engelse fallback. */
export function qLabel(key, fallback) {
  const out = translate(key, fallback);
  return (out == null || out === '') ? fallback : out;
}

// Engelse basisteksten per categorie + de i18n-sleutel die erbij hoort.
const CATEGORY_KEYS = {
  'text-annotation': 'textAnnotation',
  'text-built-in': 'textBuiltIn',
  'area': 'area',
  'line-based': 'lineBased',
  'count': 'count',
  'symbol': 'symbol',
  'image': 'image',
  'other': 'other',
};

export const CATEGORY_FALLBACKS = {
  'text-annotation': 'Text (annotation)',
  'text-built-in': 'Text (native)',
  'area': 'Area',
  'line-based': 'Linear',
  'count': 'Count',
  'symbol': 'Symbol',
  'image': 'Image',
  'other': 'Other',
};

/** Weergavenaam van een categorie in de actieve taal. */
export function categoryLabel(cat) {
  const sub = CATEGORY_KEYS[cat];
  if (!sub) return cat;
  return qLabel(`quantities.cat.${sub}`, CATEGORY_FALLBACKS[cat]);
}

export const CATEGORY_ORDER = [
  'area', 'line-based', 'count', 'text-annotation', 'text-built-in', 'symbol', 'image', 'other',
];

const TYPE_TO_CATEGORY = {
  textbox: 'text-annotation', callout: 'text-annotation', comment: 'text-annotation', text: 'text-annotation',
  measureArea: 'area', filledArea: 'area', box: 'area', circle: 'area', ellipse: 'area',
  polygon: 'area', cloud: 'area', cloudPolyline: 'area', scaleRegion: 'area', redaction: 'area', highlight: 'area',
  measureDistance: 'line-based', measurePerimeter: 'line-based', line: 'line-based', arrow: 'line-based',
  polyline: 'line-based', wall: 'line-based', spline: 'line-based', arc: 'line-based', draw: 'line-based', measureAngle: 'line-based',
  stavenreeks: 'line-based',
  count: 'count', parametricSymbol: 'symbol', stamp: 'symbol', signature: 'symbol', image: 'image',
};

/** Categorie-key van een element (pseudo-elementen kunnen __category forceren). */
export function categoryOf(el) {
  return el.__category || TYPE_TO_CATEGORY[el.type] || 'other';
}

// Vriendelijke type-namen (Engelse basistekst; vertaald via quantities.type.*).
export const TYPE_NAMES = {
  line: 'Line', arrow: 'Arrow', wall: 'Wall', box: 'Rectangle', mask: 'Mask',
  redaction: 'Redaction', circle: 'Circle', ellipse: 'Ellipse', highlight: 'Highlight',
  cloud: 'Cloud', polygon: 'Polygon', polyline: 'Polyline', cloudPolyline: 'Cloud polyline',
  spline: 'Spline', arc: 'Arc', draw: 'Freehand', filledArea: 'Filled area',
  textbox: 'Text box', callout: 'Callout', comment: 'Sticky note', text: 'Text',
  stamp: 'Stamp', signature: 'Signature', image: 'Image',
  parametricSymbol: 'Symbol', count: 'Count marker',
  measureDistance: 'Distance', measureArea: 'Area', measurePerimeter: 'Perimeter',
  measureAngle: 'Angle', scaleRegion: 'Scale region', viewport: 'Viewport',
  stavenreeks: 'Bar series',
  scheduleTable: 'Quantities table', builtinText: 'Text',
};

/** Weergavenaam van een elementtype in de actieve taal. */
export function typeName(type) {
  const fallback = TYPE_NAMES[type];
  if (!fallback) return type;
  return qLabel(`quantities.type.${type}`, fallback);
}

// Velddefinitie. `label` is een getter zodat de tekst bij elke uitlezing in de
// actieve taal komt (en binnen een Solid-memo/render reactief blijft).
const F = (key, fallback, kind, get, unit = '', dec) => ({
  key, kind, unit, get, dec,
  labelKey: `quantities.field.${key}`,
  get label() { return qLabel(`quantities.field.${key}`, fallback); },
});

// Wrapper voor stavenreeks-specifieke velden binnen de gedeelde 'line-based'-
// categorie: geeft null (lege cel) voor elk ander lijnvormig element.
const srField = (get) => (el) => (el.type === 'stavenreeks' ? get(el) : null);

function areaValue(el) {
  return (el.type === 'measureArea' && typeof el.measureValue === 'number') ? el.measureValue : null;
}

// Som van de pixel-lengtes van de segmenten van een element. Ondersteunt zowel
// start/eind-geometrie (line/arrow) als een points-array (polyline/wand/spline/
// arc/pen). Retourneert null als er geen bruikbare geometrie is.
function pixelLength(el) {
  if (typeof el.startX === 'number' && typeof el.endX === 'number'
      && typeof el.startY === 'number' && typeof el.endY === 'number') {
    return Math.hypot(el.endX - el.startX, el.endY - el.startY);
  }
  const pts = Array.isArray(el.points) ? el.points
    : (Array.isArray(el.path) ? el.path : null);
  if (pts && pts.length >= 2) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!a || !b) continue;
      total += Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));
    }
    return total;
  }
  return null;
}

// Lengte in meter (schaal-eenheid) voor een lijnvormig element.
// Meet-annotaties dragen hun waarde al in `measureValue`. Gewone lijnen/pijlen
// (en points-lijnen) hebben die niet: bereken de pixel-lengte uit de coördinaten
// en reken om via de meegegeven schaal (`__pxPerUnit`, in px per schaal-eenheid).
// De store verrijkt elementen met deze schaal, net zoals de meet-tools dat doen
// (zie annotations/measurement.js getMeasureScale). Zonder schaal (bv. in tests
// die 1 px = 1 unit aannemen) valt `__pxPerUnit` terug op 1.
function lengthValue(el) {
  if ((el.type === 'measureDistance' || el.type === 'measurePerimeter')
      && typeof el.measureValue === 'number') {
    return el.measureValue;
  }
  const px = pixelLength(el);
  if (px == null) return null;
  const ppu = (typeof el.__pxPerUnit === 'number' && el.__pxPerUnit > 0) ? el.__pxPerUnit : 1;
  return px / ppu;
}
// Leesbare naam voor een afbeelding/stempel: expliciete stempelnaam, anders de
// bestandsnaam uit een gekoppeld pad, anders het label. Puur (geen IO).
function imageName(el) {
  if (el.stampName) return el.stampName;
  const p = el.linkedPath || el.fileName || '';
  const base = String(p).split(/[\\/]/).pop();
  return base || el.label || el.subject || '';
}
function realArea(el) {
  const a = areaValue(el);
  if (a == null) return null;
  const d = el.dakhoek || 0;
  return d ? a / Math.cos(d * Math.PI / 180) : a;
}

// Gemeenschappelijke velden voor élke categorie. 'count' (=1 per rij) levert
// Revit-stijl tellingen via groeperen + subtotalen.
const COMMON = [
  F('category', 'Category', 'text', el => categoryLabel(categoryOf(el))),
  F('type', 'Type', 'text', el => typeName(el.type)),
  F('page', 'Page', 'number', el => el.page || 1, '', 0),
  F('label', 'Label', 'text', el => el.label || el.subject || ''),
  F('color', 'Color', 'text', el => el.color || el.strokeColor || el.fillColor || ''),
  F('ifcCategory', 'IFC category', 'text', el => el.ifcCategory || ''),
  F('count', 'Count', 'number', () => 1, '', 0),
];

export const FIELD_REGISTRY = {
  'area': [...COMMON,
    F('area', 'Area', 'number', areaValue, 'm²'),
    F('dakhoek', 'Roof pitch', 'number', el => el.dakhoek || 0, '°', 0),
    F('realArea', 'Actual area', 'number', realArea, 'm²'),
  ],
  'line-based': [...COMMON,
    F('length', 'Length', 'number', lengthValue, 'm'),
    // Wapening (stavenreeks): stuks + strekkende meter. Deze getters geven
    // null voor gewone lijnvormige elementen, zodat die cellen leeg blijven.
    F('barCount', 'Bar count', 'number', srField(el => el.count || 0), '', 0),
    F('barDiameter', 'Diameter', 'number', srField(el => el.diameter || 0), 'mm', 0),
    F('barLength', 'Bar length', 'number', srField(el => el.barLengthMm || 0), 'mm', 0),
    F('totalBarLength', 'Total bar length', 'number', srField(totalBarLengthM), 'm'),
  ],
  'count': [...COMMON,
    F('countCat', 'Count category', 'text', el => el.__countCatName || el.categoryId || ''),
  ],
  'text-annotation': [...COMMON,
    F('text', 'Content', 'text', el => el.text || ''),
    F('fontSize', 'Size', 'number', el => el.fontSize || 0, 'pt', 0),
    F('fontFamily', 'Font', 'text', el => el.fontFamily || ''),
  ],
  'text-built-in': [...COMMON,
    F('text', 'Content', 'text', el => el.text || ''),
    F('fontSize', 'Size', 'number', el => Math.round((el.fontSize || 0) * 10) / 10, 'pt', 1),
  ],
  'symbol': [...COMMON,
    F('thumbnail', 'Preview', 'image', el => el.imageData || null),
    F('symbolId', 'Symbol', 'text', el => el.symbolId || el.stampType || el.stampName || ''),
  ],
  'image': [...COMMON,
    F('thumbnail', 'Preview', 'image', el => el.imageData || null),
    F('imageName', 'File name', 'text', imageName),
    F('width', 'Width', 'number', el => el.originalWidth || el.width || 0, 'px', 0),
    F('height', 'Height', 'number', el => el.originalHeight || el.height || 0, 'px', 0),
  ],
  'other': [...COMMON],
};

/** Unie van velddefinities over geselecteerde categorieën, uniek op key (eerste wint). */
export function fieldsForCategories(cats) {
  const m = new Map();
  for (const c of (cats || [])) {
    for (const f of (FIELD_REGISTRY[c] || [])) {
      if (!m.has(f.key)) m.set(f.key, f);
    }
  }
  return [...m.values()];
}

/** Eén velddefinitie op key, binnen de geselecteerde categorieën. */
export function fieldByKey(cats, key) {
  return fieldsForCategories(cats).find(f => f.key === key) || null;
}
