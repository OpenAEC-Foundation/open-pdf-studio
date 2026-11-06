// Ronde doorsnede in beton of hout (#936) — bijvoorbeeld een funderingspaal
// of ronde kolom. Op ware maat via de tekeningschaal (realSizeMm), zoals de
// staalprofielen en de houten balk: de diameter is een parameter, het vak is
// niet grafisch te vergroten.
//
// Beton: grijs gevuld (gewapend beton in doorsnede); hout: de houtkleur met
// fijne nerfarcering, net als de houten balk.

import { HOUTSOORTEN } from './hout-balk.js';
import { cirkelPts, hartlijnCmds } from './staalprofiel.js';

const HOUT_BY_ID = new Map(HOUTSOORTEN.map((s) => [s.id, s]));
export const BETON_GRIJS = '#b3b3b3';

function diameterOf(params) {
  const d = Number(params?.diameter);
  return Number.isFinite(d) && d > 0 ? d : 400;
}

function schaalOf(params) {
  const v = Number(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const rondeDoorsnedeTemplate = {
  id: 'ronde-doorsnede',
  name: 'Ronde doorsnede (beton/hout)',
  nameEn: 'Round section (concrete/timber)',
  category: 'NL Constructie',
  defaultSize: { width: 60, height: 60 },
  fixedSize: true,
  zoektermen: ['paal', 'ronde paal', 'funderingspaal', 'ronde kolom', 'betonpaal', 'houten paal'],
  params: [
    {
      key: 'materiaal', label: 'Materiaal', labelEn: 'Material', type: 'enum',
      options: [
        { value: 'beton', label: 'Beton' },
        { value: 'hout', label: 'Hout' },
      ],
      default: 'beton',
    },
    { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 400, min: 10, step: 10 },
    {
      key: 'houtsoort', label: 'Houtsoort', labelEn: 'Timber type', type: 'enum',
      options: HOUTSOORTEN.map((s) => ({ value: s.id, label: s.label })),
      default: 'vuren',
    },
    { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
    { key: 'hartlijn', label: 'Hartlijnen', labelEn: 'Centre lines', type: 'boolean', default: true },
    { key: 'toonLabel', label: 'Maat tonen', labelEn: 'Show size', type: 'boolean', default: true },
  ],
  realSizeMm(params) {
    const d = diameterOf(params) * schaalOf(params);
    return { width: d, height: d };
  },
  freeAxis() { return null; },
  snapPoints(_params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
      { kind: 'endpoint', x: x + w / 2, y }, { kind: 'endpoint', x: x + w / 2, y: y + h },
      { kind: 'endpoint', x, y: y + h / 2 }, { kind: 'endpoint', x: x + w, y: y + h / 2 },
    ];
  },
  render(params = {}, bbox) {
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const r = Math.min(bbox.width, bbox.height) / 2;
    const loop = cirkelPts(cx, cy, r);
    const cmds = [];
    if (params.materiaal === 'hout') {
      const soort = HOUT_BY_ID.get(params.houtsoort) || HOUTSOORTEN[0];
      cmds.push({ kind: 'hatch', loops: [loop], pattern: 'solid', color: soort.bg, scale: 100, angle: 0 });
      cmds.push({ kind: 'hatch', loops: [loop], pattern: 'diagonal-left', color: soort.fg, scale: 60, angle: 0 });
    } else {
      cmds.push({ kind: 'hatch', loops: [loop], pattern: 'solid', color: BETON_GRIJS, scale: 100, angle: 0 });
    }
    cmds.push({ kind: 'circle', cx, cy, r, role: 'omtrek' });
    if (params.hartlijn !== false) cmds.push(...hartlijnCmds(bbox));
    if (params.toonLabel !== false) {
      cmds.push({
        kind: 'text', x: cx, y: cy, role: 'label',
        text: `Ø${Math.round(diameterOf(params))}`,
        size: Math.max(8, Math.min(22, r * 0.45)),
      });
    }
    return cmds;
  },
};
