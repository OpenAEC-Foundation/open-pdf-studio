// Parametrische stenenrij voor het uitzetten van metselwerkmodules.
// Lagenmaat stapelt verticaal (steenhoogte + voeg); koppenmaat (steenbreedte +
// voeg) en strekkenmaat (steenlengte + voeg) leggen de rij horizontaal.
// De voeg is onderdeel van de modulemaat en blijft als lege strook zichtbaar.
// Het aantal bepaalt de werkelijke maat van de rij; bij aantal 0 geldt de
// totale maat en wordt de laatste steen daarop afgeknipt.

function positiveNumber(value, fallback, minimum = 0.001) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

const MAX_DETAILED_STONES = 1000;
const MAX_LOD_JOINTS = 250;
const DEFAULT_COUNT = 16;

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

const DIRECTIONS = {
  lagen: { maatType: 'lagenmaat', orientation: 'vertical' },
  koppen: { maatType: 'koppenmaat', orientation: 'horizontal' },
  strekken: { maatType: 'strekkenmaat', orientation: 'horizontal' },
};

function directionOf(params) {
  if (Object.hasOwn(DIRECTIONS, params.richting)) return params.richting;
  if (params.maatType === 'koppenmaat') return 'koppen';
  if (params.maatType === 'strekkenmaat') return 'strekken';
  return 'lagen';
}

// Een ouder symbool legt de modulemaat vast (lagenmaat of koppenmaat) en kent
// geen steenlengte, steenhoogte of aantal. Dat blijft renderen zoals het is
// opgeslagen: steen = modulemaat - voeg, rijdikte = steenbreedte.
function hasFixedModule(params, richting) {
  if (richting === 'strekken') return false;
  if (params.lagenmaat === undefined && params.koppenmaat === undefined) return false;
  return params.steenLengte === undefined && params.steenHoogte === undefined
    && params.aantal === undefined && params.richting === undefined;
}

export function layoutStenenrijMm(params = {}) {
  const richting = directionOf(params);
  const { maatType, orientation } = DIRECTIONS[richting];
  const voeg = nonNegativeNumber(params.voeg, 10);
  const steenbreedte = positiveNumber(params.steenbreedte, 100, 1);
  const steenLengte = positiveNumber(params.steenLengte, 210, 1);
  const fixedModule = hasFixedModule(params, richting);
  const steenHoogte = fixedModule
    ? positiveNumber(params.lagenmaat, 62.5, 1) - voeg
    : positiveNumber(params.steenHoogte, 50, 1);
  const lagenmaat = fixedModule ? positiveNumber(params.lagenmaat, 62.5, 1) : steenHoogte + voeg;
  const koppenmaat = fixedModule ? positiveNumber(params.koppenmaat, 110, 1) : steenbreedte + voeg;
  const strekkenmaat = steenLengte + voeg;
  const module = { lagen: lagenmaat, koppen: koppenmaat, strekken: strekkenmaat }[richting];
  const body = module - voeg;
  // Dwarsmaat van de rij: lagen tonen de steenbreedte, koppen en strekken de
  // steenhoogte (aanzicht).
  const dikte = fixedModule || richting === 'lagen' ? steenbreedte : steenHoogte;
  // Zonder aantal en zonder totale maat geldt het standaardaantal; een symbool
  // dat alleen een totale maat draagt houdt die maat.
  const aantalInvoer = params.aantal === undefined && params.totaleMaat === undefined
    ? DEFAULT_COUNT : Number(params.aantal);
  const aantal = !fixedModule && Number.isFinite(aantalInvoer) && aantalInvoer >= 0.5
    ? Math.round(aantalInvoer) : 0;
  const totaleMaat = aantal > 0 ? aantal * module : positiveNumber(params.totaleMaat, 1000, 1);
  const valid = body > 0;
  const stoneCount = aantal > 0 ? aantal : Math.ceil(totaleMaat / module);
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
    richting,
    orientation,
    totaleMaat,
    aantal,
    lagenmaat,
    koppenmaat,
    strekkenmaat,
    voeg,
    steenbreedte,
    steenLengte,
    steenHoogte,
    module,
    body,
    dikte,
    valid,
    stoneCount,
    lod,
    extent: totaleMaat,
    width: orientation === 'horizontal' ? totaleMaat : dikte,
    height: orientation === 'vertical' ? totaleMaat : dikte,
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
      key: 'maatType', label: 'Richting', labelEn: 'Direction',
      type: 'enum', default: 'lagenmaat',
      options: [
        { value: 'lagenmaat', label: 'Lagen (verticaal, steenhoogte + voeg)' },
        { value: 'koppenmaat', label: 'Koppen (horizontaal, steenbreedte + voeg)' },
        { value: 'strekkenmaat', label: 'Strekken (horizontaal, steenlengte + voeg)' },
      ],
    },
    { key: 'aantal', label: 'Aantal (0 = totale maat)', labelEn: 'Count (0 = total size)', type: 'number', default: DEFAULT_COUNT, min: 0, step: 1 },
    { key: 'steenLengte', label: 'Steenlengte (mm)', labelEn: 'Brick length (mm)', type: 'number', default: 210, min: 1, step: 1 },
    { key: 'steenbreedte', label: 'Steenbreedte (mm)', labelEn: 'Brick width (mm)', type: 'number', default: 100, min: 1, step: 1 },
    { key: 'steenHoogte', label: 'Steenhoogte (mm)', labelEn: 'Brick height (mm)', type: 'number', default: 50, min: 1, step: 1 },
    { key: 'voeg', label: 'Voeg (mm)', labelEn: 'Joint (mm)', type: 'number', default: 10, min: 0, step: 0.5 },
    { key: 'totaleMaat', label: 'Totale maat bij aantal 0 (mm)', labelEn: 'Total size when count is 0 (mm)', type: 'number', default: 1000, min: 1, step: 10 },
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
          layout.dikte * scale,
          stone.index,
          lineWidth,
        );
      }
      // Metselwerk wordt vanaf de onderzijde opgebouwd.
      return rectCommand(
        x0,
        y0 + (layout.totaleMaat - stone.offset - stone.length) * scale,
        layout.dikte * scale,
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
