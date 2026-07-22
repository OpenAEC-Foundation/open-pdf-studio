// Parametrische stenenrij voor het uitzetten van metselwerkmodules.
// Lagenmaat stapelt verticaal; koppenmaat legt dezelfde module horizontaal.
// De voeg is onderdeel van de modulemaat en blijft als lege strook zichtbaar.

function positiveNumber(value, fallback, minimum = 0.001) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

const MAX_DETAILED_STONES = 1000;
const MAX_LOD_JOINTS = 250;

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function layoutStenenrijMm(params = {}) {
  const maatType = params.maatType === 'koppenmaat' ? 'koppenmaat' : 'lagenmaat';
  const totaleMaat = positiveNumber(params.totaleMaat, 1000, 1);
  const lagenmaat = positiveNumber(params.lagenmaat, 62.5, 1);
  const koppenmaat = positiveNumber(params.koppenmaat, 110, 1);
  const steenbreedte = positiveNumber(params.steenbreedte, 100, 1);
  const module = maatType === 'koppenmaat' ? koppenmaat : lagenmaat;
  const voeg = nonNegativeNumber(params.voeg, 10);
  const body = module - voeg;
  const orientation = maatType === 'koppenmaat' ? 'horizontal' : 'vertical';
  const valid = body > 0;
  const stoneCount = Math.ceil(totaleMaat / module);
  const lod = valid && stoneCount > MAX_DETAILED_STONES;
  const stones = [];

  if (valid && !lod) {
    for (let index = 0; index < stoneCount; index++) {
      const offset = index * module;
      const length = Math.min(body, totaleMaat - offset);
      if (length > 0) stones.push({ index, offset, length });
    }
  }

  return {
    maatType,
    orientation,
    totaleMaat,
    lagenmaat,
    koppenmaat,
    voeg,
    steenbreedte,
    module,
    body,
    valid,
    stoneCount,
    lod,
    extent: totaleMaat,
    width: orientation === 'horizontal' ? totaleMaat : steenbreedte,
    height: orientation === 'vertical' ? totaleMaat : steenbreedte,
    stones,
  };
}

function rectCommand(x, y, width, height, index, lineWidth, role = 'steen') {
  const safeLineWidth = Math.max(0.001, Math.min(lineWidth, width * 0.8, height * 0.8));
  const inset = safeLineWidth / 2;
  return {
    kind: 'polyline',
    close: true,
    role,
    index,
    lineWidth: safeLineWidth,
    points: [
      { x: x + inset, y: y + inset },
      { x: x + width - inset, y: y + inset },
      { x: x + width - inset, y: y + height - inset },
      { x: x + inset, y: y + height - inset },
    ],
  };
}

function lineWidthFor(layout, scale) {
  const reference = layout.voeg > 0 ? layout.voeg : layout.module * 0.2;
  return Math.max(0.01, Math.min(1, reference * scale * 0.25));
}

export const stenenrijTemplate = {
  id: 'stenenrij',
  name: 'Stenenrij',
  nameEn: 'Masonry gauge',
  category: 'NL Constructie',
  defaultSize: { width: 100, height: 400 },
  fixedSize: true,
  params: [
    {
      key: 'maatType', label: 'Maatsoort', labelEn: 'Gauge type',
      type: 'enum', default: 'lagenmaat',
      options: [
        { value: 'lagenmaat', label: 'Lagenmaat (verticaal)' },
        { value: 'koppenmaat', label: 'Koppenmaat (horizontaal)' },
      ],
    },
    { key: 'totaleMaat', label: 'Totale maat (mm)', labelEn: 'Total size (mm)', type: 'number', default: 1000, min: 1, step: 10 },
    { key: 'lagenmaat', label: 'Lagenmaat (mm)', labelEn: 'Course gauge (mm)', type: 'number', default: 62.5, min: 1, step: 0.5 },
    { key: 'koppenmaat', label: 'Koppenmaat (mm)', labelEn: 'Header gauge (mm)', type: 'number', default: 110, min: 1, step: 1 },
    { key: 'voeg', label: 'Voeg (mm)', labelEn: 'Joint (mm)', type: 'number', default: 10, min: 0, step: 0.5 },
    { key: 'steenbreedte', label: 'Steenbreedte (mm)', labelEn: 'Brick width (mm)', type: 'number', default: 100, min: 1, step: 1 },
  ],
  layoutMm: layoutStenenrijMm,
  realSizeMm(params) {
    const layout = layoutStenenrijMm(params);
    return { width: layout.width, height: layout.height };
  },
  render(params, bbox) {
    const layout = layoutStenenrijMm(params);
    if (!layout.valid) return [];
    const scale = Math.min(bbox.width / layout.width, bbox.height / layout.height);
    const x0 = bbox.x + (bbox.width - layout.width * scale) / 2;
    const y0 = bbox.y + (bbox.height - layout.height * scale) / 2;
    const lineWidth = lineWidthFor(layout, scale);

    if (layout.lod) {
      const commands = [rectCommand(
        x0, y0, layout.width * scale, layout.height * scale,
        -1, lineWidth, 'stenenrij-lod',
      )];
      const stride = Math.max(1, Math.ceil((layout.stoneCount - 1) / MAX_LOD_JOINTS));
      const half = lineWidth / 2;
      for (let index = stride; index < layout.stoneCount; index += stride) {
        const jointCenter = index * layout.module - layout.voeg / 2;
        if (!(jointCenter > 0 && jointCenter < layout.totaleMaat)) continue;
        if (layout.orientation === 'horizontal') {
          const x = x0 + jointCenter * scale;
          commands.push({
            kind: 'line', role: 'voeg-lod', lineWidth,
            x1: x, y1: y0 + half,
            x2: x, y2: y0 + layout.height * scale - half,
          });
        } else {
          const y = y0 + (layout.totaleMaat - jointCenter) * scale;
          commands.push({
            kind: 'line', role: 'voeg-lod', lineWidth,
            x1: x0 + half, y1: y,
            x2: x0 + layout.width * scale - half, y2: y,
          });
        }
      }
      return commands;
    }

    return layout.stones.map((stone) => {
      if (layout.orientation === 'horizontal') {
        return rectCommand(
          x0 + stone.offset * scale,
          y0,
          stone.length * scale,
          layout.steenbreedte * scale,
          stone.index,
          lineWidth,
        );
      }
      // Metselwerk wordt vanaf de onderzijde opgebouwd.
      return rectCommand(
        x0,
        y0 + (layout.totaleMaat - stone.offset - stone.length) * scale,
        layout.steenbreedte * scale,
        stone.length * scale,
        stone.index,
        lineWidth,
      );
    });
  },
  snapPoints(_params, bbox) {
    const { x, y, width, height } = bbox;
    return [
      { x, y, kind: 'endpoint' },
      { x: x + width, y, kind: 'endpoint' },
      { x, y: y + height, kind: 'endpoint' },
      { x: x + width, y: y + height, kind: 'endpoint' },
      { x: x + width / 2, y: y + height / 2, kind: 'center' },
    ];
  },
};
