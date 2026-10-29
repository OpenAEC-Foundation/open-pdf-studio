// Generic per-annotation-type STYLE TYPES (voorgedefinieerde typen).
//
// One concept, reused across annotation kinds: a "type" is a named preset of
// style properties shown in a selector at the top of the properties panel.
// Picking one applies all its props in a single action and persists them as
// the default for newly drawn annotations of that kind.
//
//   measureDistance → dimension types (text height/pen/colour/unit)
//   line / arrow    → NL pen types (pen width ↔ colour pairing)
//   filledArea      → NL material hatches (beton, metselwerk, …)
//
// Adding a preset list for another annotation type = add an entry here; the
// selector (StyleTypeSection) and apply/persist plumbing are fully generic.

import { DIMENSION_TYPES, dimensionTypeProps } from './dimension-types.js';

const MM_TO_PT = 72 / 25.4;

// Line types: the main colours (zwart/rood/blauw/groen) in three weights,
// plus black Grid (chain / streep-stippel) and black Dashed variants.
function pen(name, mm, color, borderStyle = 'solid') {
  return {
    id: `${name.toLowerCase()}-${mm.toFixed(2)}${borderStyle !== 'solid' ? '-' + borderStyle : ''}`,
    label: `${name} ${mm.toFixed(2)} mm`,
    color,
    props: {
      lineWidth: Math.round(mm * MM_TO_PT * 100) / 100,
      color,
      strokeColor: color,
      borderStyle,
    },
  };
}

const _PEN_WEIGHTS = [0.18, 0.35, 0.70];
const PEN_TYPES = [
  ..._PEN_WEIGHTS.map(mm => pen('Zwart', mm, '#000000')),
  ..._PEN_WEIGHTS.map(mm => pen('Rood', mm, '#D32F2F')),
  ..._PEN_WEIGHTS.map(mm => pen('Blauw', mm, '#1565C0')),
  ..._PEN_WEIGHTS.map(mm => pen('Groen', mm, '#2E7D32')),
  { id: 'grid-zwart', label: 'Grid (streep-stippel)', color: '#000000',
    props: { lineWidth: Math.round(0.18 * MM_TO_PT * 100) / 100, color: '#000000', strokeColor: '#000000', borderStyle: 'dash-dot' } },
  { id: 'dashed-zwart', label: 'Dashed (gestreept)', color: '#000000',
    props: { lineWidth: Math.round(0.25 * MM_TO_PT * 100) / 100, color: '#000000', strokeColor: '#000000', borderStyle: 'dashed' } },
];

// Translatable type names live in the 'properties' namespace under
// styleTypeNames.filledArea.<id>. `label` stays the Dutch source name and is
// the fallback when a key is absent (and what a user rename overrides).
export const STYLE_TYPE_LABEL_PREFIX = 'styleTypeNames.filledArea.';

// Generic (non-NEN47, non-material-variant) imported hatches whose names are
// translated per locale. The NEN 47 entries and the Dutch material variants
// keep their Dutch standard names.
export const TRANSLATED_INB_HATCH_IDS = new Set([
  'inb-sloop', 'inb-staal',
  'inb-diagonaal-smal', 'inb-diagonaal-midden', 'inb-diagonaal-breed',
  'inb-raster-fijn', 'inb-raster-midden', 'inb-raster-grof',
  'inb-raster-liggend-1', 'inb-raster-liggend-2', 'inb-raster-liggend-3',
  'inb-raster-staand-1', 'inb-raster-staand-2', 'inb-raster-staand-3',
  'inb-tegels-fijn', 'inb-tegels-midden', 'inb-tegels-grof',
  'inb-planken-fijn', 'inb-planken-midden', 'inb-planken-grof',
  'inb-kruis-fijn', 'inb-kruis-midden', 'inb-kruis-grof',
  'inb-baksteen', 'inb-grond', 'inb-glas', 'inb-vloeistof', 'inb-gras',
  'inb-honingraat', 'inb-hout', 'inb-zand', 'inb-beton',
  'inb-verticaal-smal', 'inb-verticaal-breed', 'inb-horizontaal-breed',
]);

// NL material hatches for filled areas.
function hatch(id, label, color, pattern, extra = {}) {
  return {
    id,
    label,
    labelKey: STYLE_TYPE_LABEL_PREFIX + id,
    color,
    props: {
      hatchPattern: pattern,
      hatchColor: color,
      hatchScale: 100,
      strokeColor: color,
      color,
      lineWidth: 0.7,
      fillColor: null,
      ...extra,
    },
  };
}

const HATCH_TYPES = [
  hatch('beton', 'Beton', '#6E6E6E', 'concrete'),
  hatch('metselwerk', 'Metselwerk', '#B23B3B', 'brick-running'),
  hatch('isolatie', 'Isolatie', '#2E7D32', 'crosshatch'),
  hatch('zand', 'Zand/cement', '#C2A14D', 'dots'),
  hatch('algemeen', 'Algemeen (diagonaal)', '#000000', 'diagonal-left'),
];

// Hatches imported from the bundled drawing-template pattern library
// (drawings/assets/patterns.svg). One entry per unique pattern family — the
// print-scale variants of the source (suffixes _200…_1) collapse into the
// hatchScale property, which is tuned per entry so the rendered spacing
// matches the source tile's paper-mm dimensions (1 mm ≈ 2.835 pt).
//
// Row format: [id, label, enginePatternId, lineColor, hatchScale, fillColor?]
// fillColor carries the background tint of the coloured ("CUST_") source
// patterns; line geometry stays on the mapped engine pattern.
const INB_HATCH_DEFS = [
  // -- generic patterns --
  ['inb-sloop',              'Sloop',                       'diagonal-left',    '#FF0000', 28],
  ['inb-staal',              'Staal (dubbele lijn)',        'staal-dubbel',     '#000000', 142],
  ['inb-diagonaal-smal',     'Diagonaal smal',              'diagonal-left',    '#000000', 28],
  ['inb-diagonaal-midden',   'Diagonaal midden',            'diagonal-left',    '#000000', 57],
  ['inb-diagonaal-breed',    'Diagonaal breed',             'diagonal-left',    '#000000', 85],
  ['inb-raster-fijn',        'Raster fijn',                 'grid',             '#000000', 28],
  ['inb-raster-midden',      'Raster midden',               'grid',             '#000000', 57],
  ['inb-raster-grof',        'Raster grof',                 'grid',             '#000000', 85],
  ['inb-raster-liggend-1',   'Raster liggend fijn',         'raster-liggend',   '#000000', 57],
  ['inb-raster-liggend-2',   'Raster liggend midden',       'raster-liggend',   '#000000', 113],
  ['inb-raster-liggend-3',   'Raster liggend grof',         'raster-liggend',   '#000000', 170],
  ['inb-raster-staand-1',    'Raster staand fijn',          'raster-staand',    '#000000', 57],
  ['inb-raster-staand-2',    'Raster staand midden',        'raster-staand',    '#000000', 113],
  ['inb-raster-staand-3',    'Raster staand grof',          'raster-staand',    '#000000', 170],
  ['inb-tegels-fijn',        'Tegels fijn',                 'tegel-halfsteens', '#000000', 28],
  ['inb-tegels-midden',      'Tegels midden',               'tegel-halfsteens', '#000000', 57],
  ['inb-tegels-grof',        'Tegels grof',                 'tegel-halfsteens', '#000000', 85],
  ['inb-planken-fijn',       'Planken fijn',                'plank-halfsteens', '#000000', 28],
  ['inb-planken-midden',     'Planken midden',              'plank-halfsteens', '#000000', 57],
  ['inb-planken-grof',       'Planken grof',                'plank-halfsteens', '#000000', 85],
  ['inb-kruis-fijn',         'Kruisarcering fijn',          'crosshatch',       '#000000', 28],
  ['inb-kruis-midden',       'Kruisarcering midden',        'crosshatch',       '#000000', 57],
  ['inb-kruis-grof',         'Kruisarcering grof',          'crosshatch',       '#000000', 85],
  ['inb-baksteen',           'Baksteen',                    'staal-dubbel',     '#000000', 142, '#FFFFFF'],
  ['inb-grond',              'Grond',                       'grond-blokjes',    '#000000', 142, '#FFFFFF'],
  ['inb-glas',               'Glas (gevel)',                'glas-strepen',     '#000000', 142],
  ['inb-vloeistof',          'Vloeistof',                   'vloeistof-strepen','#000000', 142],
  ['inb-gras',               'Gras',                        'gras-pollen',      '#000000', 142],
  ['inb-honingraat',         'Honingraat',                  'honingraat',       '#000000', 142, '#FFFFFF'],
  ['inb-hout',               'Hout (kops)',                 'wood-grain',       '#000000', 200],
  ['inb-zand',               'Zand',                        'sand',             '#000000', 100, '#FFFFFF'],
  ['inb-beton',              'Beton (gespikkeld)',          'concrete',         '#000000', 200, '#FFFFFF'],
  ['inb-verticaal-smal',     'Verticaal smal',              'vertical',         '#000000', 28,  '#FFFFFF'],
  ['inb-verticaal-breed',    'Verticaal breed',             'vertical',         '#000000', 142, '#FFFFFF'],
  ['inb-horizontaal-breed',  'Horizontaal breed',           'horizontal',       '#000000', 142, '#FFFFFF'],
  // -- NEN 47 material hatches (line work only) --
  // No background tint here: the coloured twins follow in the next block
  // (they used to carry the same tint, which made both lists identical).
  ['inb-nen47-01-metselwerk-baksteen',  'NEN47-1 Metselwerk baksteen',          'nen47-metselwerk-baksteen',     '#000000', 213],
  ['inb-nen47-02-steenachtig',          'NEN47-2 Speciale steenachtige mat.',   'nen47-speciale-steenachtige',   '#000000', 142],
  ['inb-nen47-03-kunststeen',           'NEN47-3 Metselwerk kunststeen',        'nen47-metselwerk-kunststeen',   '#000000', 106],
  ['inb-nen47-04-scheidingswand',       'NEN47-4 Lichte scheidingswand',        'lijnen-groep-verticaal',        '#000000', 142],
  ['inb-nen47-05-gewapend-beton',       'NEN47-5 Gewapend beton (t.p.g.)',      'nen47-gewapend-beton',          '#000000', 100, '#C0C0C0'],
  ['inb-nen47-06-beton-prefab',         'NEN47-6 Gewapend beton prefab',        'nen47-beton-prefab',            '#000000', 106],
  ['inb-nen47-07-ongewapend-beton',     'NEN47-7 Ongewapend beton',             'nen47-ongewapend-beton',        '#000000', 213],
  ['inb-nen47-08-sierbeton',            'NEN47-8 Sierbeton',                    'nen47-sierbeton',               '#000000', 213],
  ['inb-nen47-09-natuursteen',          'NEN47-9 Natuursteen',                  'nen47-natuursteen',             '#000000', 106],
  ['inb-nen47-10-enkele-afwerking',     'NEN47-10 Enkele wand-/vloerafwerking', 'nen47-enkele-afwerking',        '#000000', 213],
  ['inb-nen47-11-samengestelde-afwerking', 'NEN47-11 Samengestelde afwerking',  'nen47-samengestelde-afwerking', '#000000', 213],
  ['inb-nen47-12-naaldhout',            'NEN47-12 Naaldhout',                   'nen47-naaldhout',               '#000000', 53],
  ['inb-nen47-13-loofhout',             'NEN47-13 Loofhout',                    'nen47-loofhout',                '#000000', 80],
  ['inb-nen47-14-hout-langs',           'NEN47-14 Hout langsarcering',          'nen47-hout-langs',              '#000000', 106],
  ['inb-nen47-16-bekledingsplaat',      'NEN47-16 Bekledingsplaat',             'nen47-bekledingsplaat',         '#000000', 106],
  ['inb-nen47-17-isolatie',             'NEN47-17 Isolatie',                    'crosshatch',                    '#000000', 25],
  ['inb-nen47-18-staal',                'NEN47-18 Staal',                       'nen47-staal',                   '#000000', 100],
  ['inb-nen47-19-aluminium',            'NEN47-19 Aluminium/brons/koper',       'nen47-aluminium',               '#000000', 100, '#C0C0C0'],
  ['inb-nen47-20-lood',                 'NEN47-20 Lood',                        'lood-blokken',                  '#000000', 142],
  ['inb-nen47-21-zink',                 'NEN47-21 Zink',                        'solid',                         '#000000', 100],
  ['inb-nen47-22-kunststof',            'NEN47-22 Kunststof',                   'nen47-kunststof',               '#000000', 106],
  ['inb-nen47-23-afdichtingsmiddel',    'NEN47-23 Afdichtingsmiddel',           'nen47-afdichtingsmiddel',       '#000000', 180],
  ['inb-nen47-24-bitumen',              'NEN47-24 Bitumen',                     'solid',                         '#000000', 100],
  ['inb-nen47-25-maaiveld',             'NEN47-25 Maaiveld',                    'nen47-maaiveld',                '#000000', 75],
  ['inb-nen47-26-zand',                 'NEN47-26 Zand',                        'sand',                          '#000000', 280],
  ['inb-nen47-27-grind',                'NEN47-27 Grind',                       'gravel',                        '#000000', 300],
  ['inb-nen47-28-water',                'NEN47-28 Water',                       'water',                         '#000000', 95],
  ['inb-nen47-29-glas',                 'NEN47-29 Glas',                        'glas-doorsnede',                '#000000', 142],
  // -- NEN 47 hatches with material background colour --
  ['inb-nen47-01-baksteen-gekleurd',    'NEN47-1 Metselwerk baksteen (kleur)',  'nen47-metselwerk-baksteen',     '#000000', 213, '#CD7C61'],
  ['inb-nen47-03-kunststeen-gekleurd',  'NEN47-3 Metselwerk kunststeen (kleur)','nen47-metselwerk-kunststeen',   '#000000', 106, '#C0C0C0'],
  ['inb-nen47-04-scheidingswand-gekleurd', 'NEN47-4 Lichte scheidingswand (kleur)', 'lijnen-groep-verticaal',    '#000000', 142, '#C0C0C0'],
  ['inb-nen47-06-beton-prefab-gekleurd','NEN47-6 Beton prefab (kleur)',         'nen47-beton-prefab',            '#000000', 106, '#C0C0C0'],
  ['inb-nen47-07-ongewapend-gekleurd',  'NEN47-7 Ongewapend beton (kleur)',     'nen47-ongewapend-beton',        '#000000', 213, '#808080'],
  ['inb-nen47-12-naaldhout-gekleurd',   'NEN47-12 Naaldhout (kleur)',           'nen47-naaldhout',               '#000000', 53,  '#E6BE9B'],
  ['inb-nen47-13-loofhout-gekleurd',    'NEN47-13 Loofhout (kleur)',            'nen47-loofhout',                '#000000', 80,  '#D2AF87'],
  ['inb-nen47-14-hout-langs-gekleurd',  'NEN47-14 Hout langs (kleur)',          'nen47-hout-langs',              '#000000', 106, '#E6BE9B'],
  ['inb-nen47-16-bekledingsplaat-gekleurd', 'NEN47-16 Bekledingsplaat (kleur)', 'nen47-bekledingsplaat',         '#000000', 106, '#C0C0C0'],
  ['inb-nen47-17-isolatie-gekleurd',    'NEN47-17 Isolatie (kleur)',            'crosshatch',                    '#000000', 25,  '#FFF0A0'],
  ['inb-nen47-25-maaiveld-gekleurd',    'NEN47-25 Maaiveld (kleur)',            'nen47-maaiveld',                '#000000', 75,  '#DFE6D0'],
  ['inb-nen47-26-zand-gekleurd',        'NEN47-26 Zand (kleur)',                'sand',                          '#000000', 280, '#C9B89C'],
  ['inb-nen47-28-water-gekleurd',       'NEN47-28 Water (kleur)',               'water',                         '#000000', 95,  '#CDE6ED'],
  ['inb-nen47-29-glas-gekleurd',        'NEN47-29 Glas (kleur)',                'glas-doorsnede',                '#000000', 142, '#ECF0EF'],
  // -- material variants (background colour per material) --
  ['inb-baksteen-poriso',     'Baksteen poriso',          'nen47-metselwerk-baksteen', '#000000', 213, '#753E39'],
  ['inb-baksteen-rood',       'Baksteen rood',            'nen47-metselwerk-baksteen', '#000000', 213, '#CD7C61'],
  ['inb-baksteen-cement',     'Baksteen cementsteen',     'nen47-metselwerk-baksteen', '#000000', 213, '#CD7C61'],
  ['inb-baksteen-tras',       'Baksteen trasraam',        'nen47-metselwerk-baksteen', '#000000', 213, '#515151'],
  ['inb-baksteen-kalk',       'Baksteen kalkzandsteen',   'nen47-metselwerk-baksteen', '#000000', 213, '#515151'],
  ['inb-natuursteen-hardsteen','Natuursteen hardsteen',   'nen47-natuursteen',         '#000000', 106, '#403E48'],
  ['inb-natuursteen-zandsteen','Natuursteen zandsteen',   'nen47-natuursteen',         '#000000', 106, '#B8A38A'],
  ['inb-natuursteen-kalksteen','Natuursteen kalksteen',   'nen47-natuursteen',         '#000000', 106, '#ECEDE6'],
  ['inb-natuursteen-tuf',     'Natuursteen tufsteen',     'nen47-natuursteen',         '#000000', 106, '#939B94'],
  ['inb-natuursteen-mergel',  'Natuursteen mergel',       'nen47-natuursteen',         '#000000', 106, '#E2C2A4'],
  ['inb-hout-vuren',          'Hout vuren',               'nen47-naaldhout',           '#000000', 53, '#F0DCB9'],
  ['inb-hout-vuren-gewolmaniseerd', 'Hout vuren (gewolmaniseerd)', 'nen47-naaldhout',  '#000000', 53, '#CDC476'],
  ['inb-hout-eiken',          'Hout eiken',               'nen47-naaldhout',           '#000000', 53, '#D2AF87'],
  ['inb-hout-lariks',         'Hout lariks',              'nen47-naaldhout',           '#000000', 53, '#E0D3B9'],
  ['inb-hout-merbau',         'Hout merbau',              'nen47-naaldhout',           '#000000', 53, '#9B4B41'],
  ['inb-hout-meranti',        'Hout meranti',             'nen47-naaldhout',           '#000000', 53, '#B4734B'],
  ['inb-hout-jatoba',         'Hout jatoba',              'nen47-naaldhout',           '#000000', 53, '#C6885E'],
  ['inb-hout-mahonie',        'Hout mahonie',             'nen47-naaldhout',           '#000000', 53, '#CE9364'],
  ['inb-hout-douglas',        'Hout douglas',             'nen47-naaldhout',           '#000000', 53, '#FFB496'],
  ['inb-hout-grenen',         'Hout grenen',              'nen47-naaldhout',           '#000000', 53, '#FAA064'],
  ['inb-hout-red-cedar',      'Hout red cedar',           'nen47-naaldhout',           '#000000', 53, '#965A32'],
  ['inb-hout-iroko',          'Hout iroko',               'nen47-naaldhout',           '#000000', 53, '#824B23'],
  ['inb-hout-niove',          'Hout niové',               'nen47-naaldhout',           '#000000', 53, '#784623'],
  ['inb-hout-bangkirai',      'Hout bangkirai',           'nen47-naaldhout',           '#000000', 53, '#A05F28'],
  ['inb-hout-azobe',          'Hout azobé',               'nen47-naaldhout',           '#000000', 53, '#6E3223'],
  ['inb-hout-bamboe',         'Hout bamboe',              'nen47-naaldhout',           '#000000', 53, '#E4CE94'],
  ['inb-hout-vuren-clt',      'Hout vuren CLT',           'nen47-naaldhout',           '#000000', 53, '#F0DCB9'],
  ['inb-plaat-multiplex',     'Bekledingsplaat multiplex','nen47-bekledingsplaat',     '#000000', 106, '#DCC8A0'],
  ['inb-plaat-osb',           'Bekledingsplaat OSB',      'nen47-bekledingsplaat',     '#000000', 106, '#DCC8A0'],
  ['inb-plaat-mdf',           'Bekledingsplaat MDF',      'nen47-bekledingsplaat',     '#000000', 106, '#AA7814'],
  ['inb-plaat-watervast',     'Bekledingsplaat watervast','nen47-bekledingsplaat',     '#000000', 106, '#B29B7D'],
  ['inb-plaat-okoume',        'Bekledingsplaat okoumé',   'nen47-bekledingsplaat',     '#000000', 106, '#7DA687'],
  ['inb-plaat-rode-spaan',    'Bekledingsplaat rode spaan',  'nen47-bekledingsplaat',  '#000000', 106, '#C39D94'],
  ['inb-plaat-groene-spaan',  'Bekledingsplaat groene spaan','nen47-bekledingsplaat',  '#000000', 106, '#738A6B'],
  ['inb-plaat-underlayment',  'Bekledingsplaat underlayment','nen47-bekledingsplaat',  '#000000', 106, '#C29C95'],
  ['inb-isolatie-glaswol',    'Isolatie glaswol',         'crosshatch',                '#000000', 25, '#FFF0A0'],
  ['inb-isolatie-steenwol',   'Isolatie steenwol',        'crosshatch',                '#000000', 25, '#BE6B69'],
  ['inb-isolatie-pir',        'Isolatie PIR',             'crosshatch',                '#000000', 25, '#F5EBC3'],
  ['inb-isolatie-resol',      'Isolatie resolschuim',     'crosshatch',                '#000000', 25, '#DC9B8C'],
  ['inb-isolatie-pur',        'Isolatie PUR',             'crosshatch',                '#000000', 25, '#D9D3B4'],
  ['inb-isolatie-eps',        'Isolatie EPS',             'crosshatch',                '#000000', 25, '#DCDCE1'],
  ['inb-isolatie-eps100',     'Isolatie EPS 100',         'crosshatch',                '#000000', 25, '#DCDCE1'],
  ['inb-isolatie-cellulair-glas', 'Isolatie cellulair glas', 'crosshatch',             '#000000', 25, '#000000'],
  ['inb-maaiveld-grond',      'Maaiveld grond',           'nen47-maaiveld',            '#000000', 75, '#3E393D'],
  ['inb-maaiveld-asfalt',     'Maaiveld asfalt',          'nen47-maaiveld',            '#000000', 75, '#3E393D'],
  ['inb-maaiveld-klei',       'Maaiveld klei',            'nen47-maaiveld',            '#000000', 75, '#5A5150'],
  ['inb-maaiveld-veen',       'Maaiveld veen',            'nen47-maaiveld',            '#000000', 75, '#866943'],
  ['inb-zand-gekleurd',       'Zand (gekleurd)',          'sand',                      '#000000', 280, '#C9B89C'],
  ['inb-water-gekleurd',      'Water (gekleurd)',         'water',                     '#000000', 95, '#CDE6ED'],
  ['inb-glas-helder',         'Glas helder',              'glas-doorsnede',            '#000000', 142, '#ECF0EF'],
  ['inb-glas-mat',            'Glas mat',                 'glas-doorsnede',            '#000000', 142, '#ECF0EF'],
];

const INB_HATCH_TYPES = INB_HATCH_DEFS.map(([id, label, pattern, lineColor, scale, bg]) => ({
  id,
  label,
  ...(TRANSLATED_INB_HATCH_IDS.has(id) ? { labelKey: STYLE_TYPE_LABEL_PREFIX + id } : {}),
  // Swatch colour next to the selector: background tint when present,
  // otherwise the line colour.
  color: bg || lineColor,
  props: {
    hatchPattern: pattern,
    hatchColor: lineColor,
    hatchScale: scale,
    strokeColor: lineColor,
    color: lineColor,
    lineWidth: 0.7,
    fillColor: bg || null,
  },
}));

export const STYLE_TYPES = {
  measureDistance: DIMENSION_TYPES.map(t => ({
    id: t.id,
    label: `${t.label} · ${t.unit}`,
    color: t.color,
    props: dimensionTypeProps(t.id),
  })),
  line: PEN_TYPES,
  arrow: PEN_TYPES,
  filledArea: [...HATCH_TYPES, ...INB_HATCH_TYPES],
};

// ── User-editable layer ────────────────────────────────────────────────────
// The "Bewerken…" dialog stores per-id OVERRIDES and fully custom EXTRA
// entries in preferences:
//   preferences.customStyleTypes[annType][id]      → partial {label,color,props}
//   preferences.customStyleTypesExtra[annType]     → full entries (user-made)
// styleTypesFor() merges these on every call, so edits apply immediately.
import { state as _appState } from '../core/state.js';

function _mergeEntry(base, ov) {
  if (!ov) return base;
  return {
    ...base,
    label: ov.label ?? base.label,
    // A user rename wins over the translated built-in name.
    labelKey: ov.label != null ? undefined : base.labelKey,
    color: ov.color ?? base.color,
    props: { ...base.props, ...(ov.props || {}) },
  };
}

// Preset list for an annotation type (built-ins + user overrides/extras), or
// null when the type has none.
export function styleTypesFor(annType) {
  const base = STYLE_TYPES[annType];
  if (!base) return null;
  const prefs = _appState?.preferences || {};
  const overrides = (prefs.customStyleTypes || {})[annType] || {};
  const extras = (prefs.customStyleTypesExtra || {})[annType] || [];
  const merged = base.map((e) => _mergeEntry(e, overrides[e.id]));
  return [...merged, ...extras];
}

// Resolve a preset to the props it applies (always includes styleType so the
// chosen id round-trips on the annotation). Null for unknown ids. Reads the
// MERGED list so user edits apply.
export function styleTypeProps(annType, typeId) {
  const list = styleTypesFor(annType);
  const entry = list && list.find(e => e.id === typeId);
  if (!entry) return null;
  return { ...entry.props, styleType: typeId };
}

// Display name of a style-type entry: the translated name when the entry has a
// labelKey that resolves (i18next returns the key itself when it is missing),
// otherwise its literal label.
export function styleTypeLabel(entry, t) {
  if (!entry) return '';
  if (entry.labelKey && typeof t === 'function') {
    const v = t(entry.labelKey);
    if (v && v !== entry.labelKey) return v;
  }
  return entry.label || entry.id || '';
}
