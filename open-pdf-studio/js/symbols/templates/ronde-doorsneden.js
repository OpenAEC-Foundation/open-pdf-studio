// Editable circular construction sections and a pile-plan marker (#936).
// Dimensions describe drawing geometry, not structural capacity.
import { steelCatalogTemplates } from '../steel-catalog.js';
import { NL_STAAL_GROEP, schaalOf } from './staalprofiel.js';
import { ellipsPunten, maatWaarde } from './mm-tekening.js';
import { HOUTSOORTEN } from './hout-balk.js';

const CHS_SIZES = [
  ['CHS 48.3x3.2', 48.3, 3.2], ['CHS 60.3x3.2', 60.3, 3.2],
  ['CHS 76.1x3.6', 76.1, 3.6], ['CHS 88.9x4', 88.9, 4],
  ['CHS 114.3x5', 114.3, 5], ['CHS 139.7x5', 139.7, 5],
  ['CHS 168.3x6.3', 168.3, 6.3], ['CHS 193.7x6.3', 193.7, 6.3],
  ['CHS 219.1x8', 219.1, 8], ['CHS 273x8', 273, 8],
  ['CHS 323.9x10', 323.9, 10],
];

// Reuse the pipe renderer (including the hollow PDF appearance and hidden
// wall lines in elevation) already used by downloaded steel catalogs.
const [pipe] = steelCatalogTemplates('nl', {
  label: { nl: 'NL Constructie', en: 'NL Construction' },
  families: [{ id: 'chs', name: { nl: 'CHS (ronde buis)', en: 'CHS (circular hollow section)' },
    shape: 'pipe', defaultSize: 'CHS 114.3x5', sizes: CHS_SIZES }],
});
export const chsTemplate = {
  ...pipe,
  id: 'staal-chs',
  profielGroep: NL_STAAL_GROEP,
  snapPoints(params, bbox) {
    return params?.aanzicht === 'boven' || params?.aanzicht === 'zij'
      ? pipe.snapPoints(params, bbox) : circleSnaps(params, bbox);
  },
  zoektermen: ['CHS', 'ronde buis', 'circular hollow section', ...CHS_SIZES.map(r => r[0])],
};

function circle(bbox) {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const r = Math.min(bbox.width, bbox.height) / 2;
  return { cx, cy, r, loop: ellipsPunten(cx, cy, r, r, 0, 2 * Math.PI, 64) };
}

function circleSnaps(_params, bbox) {
  const { cx, cy, r } = circle(bbox);
  return [{ kind: 'center', x: cx, y: cy },
    { kind: 'midpoint', x: cx - r, y: cy }, { kind: 'midpoint', x: cx + r, y: cy },
    { kind: 'midpoint', x: cx, y: cy - r }, { kind: 'midpoint', x: cx, y: cy + r }];
}

function solidSection(id, name, nameEn, timber) {
  return {
    id, name, nameEn, category: 'NL Constructie', fixedSize: true,
    defaultSize: { width: 60, height: 60 },
    zoektermen: ['rond', 'doorsnede', 'paal', 'round', 'section'],
    params: [
      { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 300, min: 1, step: 10 },
      ...(timber ? [{ key: 'houtsoort', label: 'Houtsoort', labelEn: 'Timber type', type: 'enum',
        options: HOUTSOORTEN.map(s => ({ value: s.id, label: s.label })), default: 'vuren' }] : []),
      { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
      { key: 'toonLabel', label: 'Maat tonen', labelEn: 'Show size', type: 'boolean', default: true },
    ],
    realSizeMm(params) {
      const d = maatWaarde(params?.diameter, 300, 1) * schaalOf(params);
      return { width: d, height: d };
    },
    freeAxis() { return null; },
    snapPoints: circleSnaps,
    render(params, bbox) {
      const { cx, cy, loop } = circle(bbox);
      const material = timber ? HOUTSOORTEN.find(s => s.id === params?.houtsoort) || HOUTSOORTEN[0]
        : { bg: '#dcdcdc', fg: '#777777' };
      const cmds = [
        { kind: 'hatch', loops: [loop], pattern: 'solid', color: material.bg, scale: 100, angle: 0 },
        { kind: 'hatch', loops: [loop], pattern: 'diagonal-left', color: material.fg, scale: 60, angle: 0 },
        { kind: 'polyline', points: loop, close: true },
      ];
      if (params?.toonLabel !== false) cmds.push({ kind: 'text', x: cx, y: cy,
        text: `Ø ${maatWaarde(params?.diameter, 300, 1)}`, size: Math.max(8, Math.min(22, bbox.width * 0.15)) });
      return cmds;
    },
  };
}

export const betonRondTemplate = solidSection('beton-rond', 'Beton rond (doorsnede)', 'Round concrete section', false);
export const houtRondTemplate = solidSection('hout-rond', 'Hout rond (doorsnede)', 'Round timber section', true);

function pileLayout(bbox) {
  return { cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2,
    r: Math.min(bbox.width, bbox.height) * 0.34 };
}

export const paalPlattegrondTemplate = {
  id: 'paal-plattegrond', name: 'Paalpositie (palenplan)', nameEn: 'Pile position (plan)',
  category: 'NL Constructie', defaultSize: { width: 40, height: 40 },
  params: [
    { key: 'nummer', label: 'Paalnummer', labelEn: 'Pile number', type: 'string', default: '1' },
    { key: 'toonLabel', label: 'Nummer tonen', labelEn: 'Show number', type: 'boolean', default: true },
  ],
  snapPoints(_params, bbox) {
    const { cx, cy } = pileLayout(bbox);
    return [{ kind: 'center', x: cx, y: cy }];
  },
  render(params, bbox) {
    const { cx, cy, r } = pileLayout(bbox);
    // Symbolic, freely resizable marker. Circle with a centre cross; the
    // number sits above it rather than obscuring the surveyed position.
    const cmds = [
      { kind: 'circle', cx, cy, r: r * 0.7 },
      { kind: 'line', x1: cx - r, y1: cy, x2: cx + r, y2: cy },
      { kind: 'line', x1: cx, y1: cy - r, x2: cx, y2: cy + r },
    ];
    if (params?.toonLabel !== false) cmds.push({ kind: 'text', x: cx, y: bbox.y + bbox.height * 0.13,
      text: String(params?.nummer ?? '1'), size: Math.min(18, bbox.height * 0.22) });
    return cmds;
  },
};
