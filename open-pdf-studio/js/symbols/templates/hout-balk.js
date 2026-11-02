// Parametric timber section (houten balk) — dynamic block like the steel
// profiles: pick a STANDARD SIZE (b × h mm) from the list, real-world sized
// via the scale region, fixed (no graphic resize), schaal-param for
// exceptions. Look per the reference: light timber colour, fine diagonal
// grain hatch, size label "45 x 70" centred.

const MATEN = [
  '22 x 45', '22 x 70', '32 x 50', '38 x 89', '44 x 44', '45 x 45',
  '45 x 70', '45 x 95', '45 x 120', '45 x 145', '45 x 170', '45 x 195',
  '45 x 220', '50 x 100', '50 x 150', '63 x 160', '63 x 180', '71 x 171',
  '71 x 196', '75 x 200', '75 x 225',
];

// Houtsoorten — kleur per soort (achtergrond + donkere nerf-tint)
export const HOUTSOORTEN = [
  { id: 'vuren', label: 'Vuren', bg: '#ead9b0', fg: '#b8a37a' },
  { id: 'douglas', label: 'Douglas', bg: '#e2bb8e', fg: '#ab8252' },
  { id: 'eiken', label: 'Eiken', bg: '#d9c49a', fg: '#9b8a64' },
  { id: 'hardhout', label: 'Hardhout', bg: '#c89a6e', fg: '#8d6644' },
];
const _HOUT_BY_ID = new Map(HOUTSOORTEN.map(s => [s.id, s]));

// Effectieve maat: eigen breedte/hoogte-params (>0) winnen van de lijst.
// LIGGEND getekend: '45 x 70' = 45 hoog × 70 lang (b × l).
function _maatOf(params) {
  const m = String(params?.maat || '45 x 70').match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  let b = m ? parseFloat(m[1]) : 45;   // hoogte van het balkje
  let l = m ? parseFloat(m[2]) : 70;   // lengte/breedte op papier
  const cb = parseFloat(params?.eigenHoogte);
  const cl = parseFloat(params?.eigenBreedte);
  if (Number.isFinite(cb) && cb > 0) b = cb;
  if (Number.isFinite(cl) && cl > 0) l = cl;
  return { b, l };
}

function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function _aanzichtOf(params) {
  return ['boven', 'zij'].includes(params?.aanzicht) ? params.aanzicht : 'doorsnede';
}

export const houtBalkTemplate = {
  id: 'hout-balk',
  name: 'Houten balk',
  nameEn: 'Timber section',
  category: 'NL Constructie',
  defaultSize: { width: 45, height: 70 },
  fixedSize: true,
  params: [
    { key: 'maat', label: 'Maat (b x l)', labelEn: 'Size', type: 'enum', options: MATEN, default: '45 x 70' },
    { key: 'eigenBreedte', label: 'Eigen lengte (mm, 0 = lijst)', labelEn: 'Custom length', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'eigenHoogte', label: 'Eigen hoogte (mm, 0 = lijst)', labelEn: 'Custom height', type: 'number', default: 0, min: 0, step: 5 },
    {
      key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum',
      options: [
        { value: 'doorsnede', label: 'Doorsnede' },
        { value: 'boven', label: 'Bovenaanzicht' },
        { value: 'zij', label: 'Zijaanzicht' },
      ],
      default: 'doorsnede',
    },
    {
      key: 'houtsoort', label: 'Houtsoort', labelEn: 'Timber type', type: 'enum',
      options: HOUTSOORTEN.map(s => ({ value: s.id, label: s.label })),
      default: 'vuren',
    },
    { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
    { key: 'toonLabel', label: 'Maat tonen', labelEn: 'Show size', type: 'boolean', default: true },
  ],
  realSizeMm(params) {
    // LIGGEND: lengte (l) horizontaal, hoogte (b) verticaal.
    const { b, l } = _maatOf(params);
    const f = _schaalOf(params);
    // Zelfde assen als de bestaande doorsnede: l horizontaal, b verticaal.
    // Aanzichten houden de getekende balklengte vrij, net als staalprofielen.
    const view = _aanzichtOf(params);
    if (view === 'boven') return { width: null, height: l * f };
    if (view === 'zij') return { width: null, height: b * f };
    return { width: l * f, height: b * f };
  },
  freeAxis(params) { return _aanzichtOf(params) === 'doorsnede' ? null : 'x'; },
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
      { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
    ];
  },
  render(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const soort = _HOUT_BY_ID.get(params?.houtsoort) || HOUTSOORTEN[0];
    const loop = [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ];
    const cmds = [
      // Materiaalkleur blijft zichtbaar; alleen de doorsnede is gearceerd.
      { kind: 'hatch', loops: [loop], pattern: 'solid', color: soort.bg, scale: 100, angle: 0 },
      ...(_aanzichtOf(params) === 'doorsnede'
        ? [{ kind: 'hatch', loops: [loop], pattern: 'diagonal-left', color: soort.fg, scale: 60, angle: 0 }]
        : []),
      { kind: 'polyline', points: loop, close: true },
    ];
    if (params?.toonLabel !== false) {
      const { b, l } = _maatOf(params);
      const size = Math.max(8, Math.min(22, Math.min(w, h) * 0.5));
      cmds.push({
        kind: 'text',
        x: x + w / 2,
        y: y + h / 2,
        text: `${b} x ${l}`,
        size,
      });
    }
    return cmds;
  },
};
