// Paalpositie voor een palenplan (#936): de paal op ware maat in
// bovenaanzicht — vierkant (prefab betonpaal) of rond (schroef-/boorpaal) —
// met een kruis door het hart en het paalnummer rechtsboven.
//
// Het vak is de paal zelf (realSizeMm), zodat het hart en de hoeken snappen;
// het nummer staat er net buiten, zoals het profielnaamlabel bij de
// staalprofielen.

function maatOf(params) {
  const v = Number(params?.maat);
  return Number.isFinite(v) && v > 0 ? v : 290;
}

function schaalOf(params) {
  const v = Number(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const paalpositieTemplate = {
  id: 'paalpositie',
  name: 'Paalpositie (palenplan)',
  nameEn: 'Pile position (pile plan)',
  category: 'NL Constructie',
  defaultSize: { width: 30, height: 30 },
  fixedSize: true,
  zoektermen: ['palenplan', 'paal', 'heipaal', 'paalnummer', 'pile'],
  params: [
    {
      key: 'vorm', label: 'Vorm', labelEn: 'Shape', type: 'enum',
      options: [
        { value: 'vierkant', label: 'Vierkant (prefab)' },
        { value: 'rond', label: 'Rond' },
      ],
      default: 'vierkant',
    },
    { key: 'maat', label: 'Maat / diameter (mm)', labelEn: 'Size / diameter (mm)', type: 'number', default: 290, min: 10, step: 10 },
    { key: 'nummer', label: 'Paalnummer', labelEn: 'Pile number', type: 'string', default: '1' },
    { key: 'toonNummer', label: 'Nummer tonen', labelEn: 'Show number', type: 'boolean', default: true },
    { key: 'kruis', label: 'Kruis door het hart', labelEn: 'Centre cross', type: 'boolean', default: true },
    { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
  ],
  realSizeMm(params) {
    const m = maatOf(params) * schaalOf(params);
    return { width: m, height: m };
  },
  freeAxis() { return null; },
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const punten = [{ kind: 'center', x: x + w / 2, y: y + h / 2 }];
    if (params?.vorm === 'rond') {
      punten.push(
        { kind: 'endpoint', x: x + w / 2, y }, { kind: 'endpoint', x: x + w / 2, y: y + h },
        { kind: 'endpoint', x, y: y + h / 2 }, { kind: 'endpoint', x: x + w, y: y + h / 2 },
      );
    } else {
      punten.push(
        { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
        { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      );
    }
    return punten;
  },
  render(params = {}, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const zijde = Math.min(w, h);
    const cmds = [];
    if (params.vorm === 'rond') {
      const r = zijde / 2;
      cmds.push({ kind: 'circle', cx, cy, r, role: 'paal' });
      if (params.kruis !== false) {
        const d = r * Math.SQRT1_2;
        cmds.push({ kind: 'line', x1: cx - d, y1: cy - d, x2: cx + d, y2: cy + d, role: 'kruis' });
        cmds.push({ kind: 'line', x1: cx - d, y1: cy + d, x2: cx + d, y2: cy - d, role: 'kruis' });
      }
    } else {
      const x0 = cx - zijde / 2, y0 = cy - zijde / 2, x1 = cx + zijde / 2, y1 = cy + zijde / 2;
      cmds.push({
        kind: 'polyline', close: true, role: 'paal',
        points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      });
      if (params.kruis !== false) {
        cmds.push({ kind: 'line', x1: x0, y1: y0, x2: x1, y2: y1, role: 'kruis' });
        cmds.push({ kind: 'line', x1: x0, y1: y1, x2: x1, y2: y0, role: 'kruis' });
      }
    }
    const nummer = String(params.nummer ?? '').trim();
    if (params.toonNummer !== false && nummer) {
      const size = Math.max(8, zijde * 0.7);
      cmds.push({
        kind: 'text', role: 'nummer', text: nummer, size,
        x: cx + zijde / 2 + size * 0.15 + (nummer.length * size * 0.56) / 2,
        y: cy - zijde / 2 - size * 0.45,
      });
    }
    return cmds;
  },
};
