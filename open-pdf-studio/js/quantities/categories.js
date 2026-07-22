// Hoeveelheden — element-classificatie + veld-register (pure, geen UI-deps).
// Elk element (annotatie of native pseudo-element) krijgt een categorie en een
// set uitleesbare velden. Eén register, géén per-type code elders.

import { totalBarLengthM } from '../annotations/stavenreeks.js';

export const CATEGORY_LABELS = {
  'text-annotation': 'Tekst (annotatie)',
  'text-built-in': 'Tekst (native)',
  'area': 'Oppervlakte',
  'line-based': 'Lijnvormig',
  'count': 'Telling',
  'symbol': 'Symbool',
  'image': 'Afbeelding',
  'other': 'Overig',
};

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

// Vriendelijke type-namen (parallel aan scheduleStore ELEMENT_TYPE_NAMES).
export const TYPE_NAMES = {
  line: 'Lijn', arrow: 'Pijl', wall: 'Wand', box: 'Rechthoek', mask: 'Maskeer',
  redaction: 'Redactie', circle: 'Cirkel', ellipse: 'Ellips', highlight: 'Markering',
  cloud: 'Wolk', polygon: 'Polygoon', polyline: 'Polylijn', cloudPolyline: 'Wolk-polylijn',
  spline: 'Spline', arc: 'Boog', draw: 'Pen', filledArea: 'Gevuld vlak',
  textbox: 'Tekstvak', callout: 'Tekstballon', comment: 'Notitie', text: 'Tekst',
  stamp: 'Stempel', signature: 'Handtekening', image: 'Afbeelding',
  parametricSymbol: 'Symbool', count: 'Telmarkering',
  measureDistance: 'Afstand', measureArea: 'Oppervlakte', measurePerimeter: 'Omtrek',
  measureAngle: 'Hoek', scaleRegion: 'Schaalgebied', viewport: 'Viewport',
  stavenreeks: 'Stavenreeks',
  scheduleTable: 'Hoeveelheden-tabel', builtinText: 'Tekst',
};

const F = (key, label, kind, get, unit = '', dec) => ({ key, label, kind, unit, get, dec });

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
  F('category', 'Categorie', 'text', el => CATEGORY_LABELS[categoryOf(el)]),
  F('type', 'Type', 'text', el => TYPE_NAMES[el.type] || el.type),
  F('page', 'Pagina', 'number', el => el.page || 1, '', 0),
  F('label', 'Label', 'text', el => el.label || el.subject || ''),
  F('color', 'Kleur', 'text', el => el.color || el.strokeColor || el.fillColor || ''),
  F('ifcCategory', 'IFC-categorie', 'text', el => el.ifcCategory || ''),
  F('count', 'Aantal', 'number', () => 1, '', 0),
];

export const FIELD_REGISTRY = {
  'area': [...COMMON,
    F('area', 'Oppervlakte', 'number', areaValue, 'm²'),
    F('dakhoek', 'Dakhoek', 'number', el => el.dakhoek || 0, '°', 0),
    F('realArea', 'Werkelijk opp.', 'number', realArea, 'm²'),
  ],
  'line-based': [...COMMON,
    F('length', 'Lengte', 'number', lengthValue, 'm'),
    // Wapening (stavenreeks): stuks + strekkende meter. Deze getters geven
    // null voor gewone lijnvormige elementen, zodat die cellen leeg blijven.
    F('barCount', 'Aantal staven', 'number', srField(el => el.count || 0), '', 0),
    F('barDiameter', 'Diameter', 'number', srField(el => el.diameter || 0), 'mm', 0),
    F('barLength', 'Staaflengte', 'number', srField(el => el.barLengthMm || 0), 'mm', 0),
    F('totalBarLength', 'Totale staaflengte', 'number', srField(totalBarLengthM), 'm'),
  ],
  'count': [...COMMON,
    F('countCat', 'Telcategorie', 'text', el => el.__countCatName || el.categoryId || ''),
  ],
  'text-annotation': [...COMMON,
    F('text', 'Inhoud', 'text', el => el.text || ''),
    F('fontSize', 'Grootte', 'number', el => el.fontSize || 0, 'pt', 0),
    F('fontFamily', 'Lettertype', 'text', el => el.fontFamily || ''),
  ],
  'text-built-in': [...COMMON,
    F('text', 'Inhoud', 'text', el => el.text || ''),
    F('fontSize', 'Grootte', 'number', el => Math.round((el.fontSize || 0) * 10) / 10, 'pt', 1),
  ],
  'symbol': [...COMMON,
    F('thumbnail', 'Voorbeeld', 'image', el => el.imageData || null),
    F('symbolId', 'Symbool', 'text', el => el.symbolId || el.stampType || el.stampName || ''),
  ],
  'image': [...COMMON,
    F('thumbnail', 'Voorbeeld', 'image', el => el.imageData || null),
    F('imageName', 'Bestandsnaam', 'text', imageName),
    F('width', 'Breedte', 'number', el => el.originalWidth || el.width || 0, 'px', 0),
    F('height', 'Hoogte', 'number', el => el.originalHeight || el.height || 0, 'px', 0),
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
