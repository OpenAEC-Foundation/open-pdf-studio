// Parametrische lijnsymbolen voor losse wapeningsstaven en netwapening.
// De ingestelde lengte bepaalt de werkelijke breedte van het symbool; de
// marker kan langs de lijn en naar boven of beneden worden verplaatst, of
// met `aantalMarkeringen` gelijkmatig over de staaf worden herhaald.
// De markering en het diameterteken zijn fijnwerk en dragen een eigen dunne
// pen, los van de instelbare lijndikte van de staaf zelf.

import {
  approxTextWidth,
  diameterSignSegments,
} from '../../annotations/stavenreeks.js';

function positiveNumber(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function integer(value, fallback, minimum = 0) {
  return Math.max(minimum, Math.round(positiveNumber(value, fallback, minimum)));
}

function markerPercentage(value) {
  return Math.min(100, Math.max(0, positiveNumber(value, 25)));
}

const MAX_MARKERINGEN = 5;

/** Aantal markeringsplaatsen op de staaf: geheel, 0 t/m 5, standaard 1. */
function markeringenAantal(value) {
  if (value == null || value === '') return 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(MAX_MARKERINGEN, Math.max(0, Math.round(number)));
}

/** Pen van de markering (driehoekje), uit zijn hoogte in px. */
export function markerLineWidth(markerHeightPx) {
  return Math.max(0.2, Math.min(0.5, 0.06 * markerHeightPx));
}

/** Pen van het diameterteken, uit zijn cirkelstraal in px. */
export function signLineWidth(radiusPx) {
  return Math.max(0.3, Math.min(1.2, 0.16 * radiusPx));
}

function compactNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

export function wapeningsLabel(params = {}) {
  const diameter = compactNumber(positiveNumber(params.diameter, 8, 1));
  const lengte = compactNumber(positiveNumber(params.lengte, 1600, 1));
  if (params.net) {
    const afstand = compactNumber(positiveNumber(params.afstand, 150, 1));
    return `Ø${diameter}-${afstand}, lg=${lengte}`;
  }
  return `${integer(params.aantal, 3, 1)} Ø${diameter}, lg=${lengte}`;
}

function lineLayout(params, bbox, centerLine = false) {
  const { x, y, width, height } = bbox;
  const lineY = y + height * (centerLine ? 0.5 : 0.68);
  const direction = params.markerRichting === 'onder' ? 1 : -1;
  const markerHeight = Math.min(height * 0.14, width * 0.025);
  const markerHalfWidth = markerHeight * 0.9;
  const desiredMarkerX = x + width * markerPercentage(params.markerPositie) / 100;
  const markerX = Math.max(x + markerHalfWidth,
    Math.min(desiredMarkerX, x + width - markerHalfWidth));
  // Tekst anderhalf keer zo hoog als voorheen (0,20 / 0,28 × hoogte en
  // 0,045 × breedte). De steile streep van het diameterteken steekt 0,72 ×
  // de tekengrootte boven het hart uit; de tekst zakt zo ver dat ook die
  // binnen de bbox blijft.
  const textSize = Math.min(height * (centerLine ? 0.30 : 0.42), width * 0.0675);
  return {
    lineY,
    markerX,
    markerTipY: lineY + direction * markerHeight,
    markerBaseY: lineY,
    markerHalfWidth,
    markerLineWidth: markerLineWidth(markerHeight),
    textY: y + Math.max(height * (centerLine ? 0.19 : 0.30), textSize * 0.72),
    textSize,
  };
}

function rebarLabelLayout(params, layout, isNet, bbox) {
  const font = layout.textSize;
  const gap = font * 0.20;
  const signWidth = font * 0.68;
  const left = isNet ? '' : String(integer(params.aantal, 3, 1));
  const diameter = compactNumber(positiveNumber(params.diameter, 8, 1));
  const lengte = compactNumber(positiveNumber(params.lengte, 1600, 1));
  const right = isNet
    ? `${diameter}-${compactNumber(positiveNumber(params.afstand, 150, 1))}, lg=${lengte}`
    : `${diameter}, lg=${lengte}`;
  const leftWidth = left ? approxTextWidth(left, font) : 0;
  const rightWidth = approxTextWidth(right, font);
  const leftGap = left ? gap : 0;
  const totalWidth = leftWidth + leftGap + signWidth + gap + rightWidth;
  const desiredX = layout.markerX - totalWidth / 2;
  const x = Math.max(
    bbox.x,
    Math.min(desiredX, bbox.x + Math.max(0, bbox.width - totalWidth)),
  );
  return {
    font, gap, signWidth, signRadius: font * 0.22,
    left, right, leftWidth, rightWidth, leftGap, totalWidth, x,
  };
}

function rebarLabelCommands(params, layout, isNet, bbox) {
  const metrics = rebarLabelLayout(params, layout, isNet, bbox);
  const {
    font, gap, signWidth, signRadius,
    left, right, leftWidth, rightWidth, leftGap,
  } = metrics;
  let cursor = metrics.x;
  const commands = [];

  if (left) {
    commands.push({
      kind: 'text', x: cursor + leftWidth / 2, y: layout.textY,
      text: left, size: font, role: 'label',
    });
    cursor += leftWidth + leftGap;
  }

  const signX = cursor + signWidth / 2;
  const lineWidth = signLineWidth(signRadius);
  commands.push({
    kind: 'circle', cx: signX, cy: layout.textY, r: signRadius,
    lineWidth, role: 'diameterteken',
  });
  for (const segment of diameterSignSegments(signRadius).segments) {
    commands.push({
      kind: 'line',
      x1: signX + segment.x1,
      y1: layout.textY - segment.y1,
      x2: signX + segment.x2,
      y2: layout.textY - segment.y2,
      lineWidth, role: 'diameterteken',
    });
  }
  cursor += signWidth + gap;
  commands.push({
    kind: 'text', x: cursor + rightWidth / 2, y: layout.textY,
    text: right, size: font, role: 'label',
  });
  return commands;
}

function editableLineLabels(params, bbox, isNet, centerLine) {
  const layout = lineLayout(params, bbox, centerLine);
  const metrics = rebarLabelLayout(params, layout, isNet, bbox);
  return [{
    id: 'label',
    rect: {
      x: metrics.x,
      y: layout.textY - metrics.font * 0.6,
      width: metrics.totalWidth,
      height: metrics.font * 1.2,
    },
    fields: isNet
      ? ['diameter', 'afstand', 'lengte']
      : ['aantal', 'diameter', 'lengte'],
  }];
}

function markerCommands(params, layout, bbox, enabled) {
  const count = enabled
    ? Math.min(4, Math.max(1, Math.round(Number(params.markerAantal) || 1)))
    : 1;
  const gap = layout.markerHalfWidth * 0.35;
  const step = layout.markerHalfWidth * 2 + gap;
  const groupWidth = step * (count - 1) + layout.markerHalfWidth * 2;
  // Eén markeringsplaats staat op de ingestelde markerpositie; meerdere
  // plaatsen worden gelijkmatig over de staaf verdeeld (gelijke tussenruimte,
  // ook tot de einden).
  const places = markeringenAantal(params.aantalMarkeringen);
  const desired = places === 1
    ? [layout.markerX]
    : Array.from({ length: places },
      (_, index) => bbox.x + bbox.width * (index + 1) / (places + 1));
  return desired.flatMap((wanted) => {
    const center = Math.max(
      bbox.x + groupWidth / 2,
      Math.min(wanted, bbox.x + bbox.width - groupWidth / 2),
    );
    return Array.from({ length: count }, (_, index) => {
      const markerX = center + (index - (count - 1) / 2) * step;
      return {
        kind: 'polyline', close: true, fill: true, role: 'marker',
        lineWidth: layout.markerLineWidth,
        points: [
          { x: markerX - layout.markerHalfWidth, y: layout.markerBaseY },
          { x: markerX, y: layout.markerTipY },
          { x: markerX + layout.markerHalfWidth, y: layout.markerBaseY },
        ],
      };
    });
  });
}

function renderLine(params, bbox, isNet, centerLine = false) {
  const layout = lineLayout(params, bbox, centerLine);
  return [
    {
      kind: 'line',
      x1: bbox.x,
      y1: layout.lineY,
      x2: bbox.x + bbox.width,
      y2: layout.lineY,
    },
    ...markerCommands(params, layout, bbox, !isNet),
    ...rebarLabelCommands(params, layout, isNet, bbox),
  ];
}

function snapPoints(_params, bbox) {
  const y = bbox.y + bbox.height * 0.68;
  return [
    { x: bbox.x, y, kind: 'endpoint' },
    { x: bbox.x + bbox.width / 2, y, kind: 'midpoint' },
    { x: bbox.x + bbox.width, y, kind: 'endpoint' },
  ];
}

const markerParams = [
  {
    key: 'aantalMarkeringen', label: 'Aantal markeringen', labelEn: 'Number of markers',
    type: 'number', default: 1, min: 0, max: MAX_MARKERINGEN, step: 1,
  },
  {
    key: 'markerPositie', label: 'Markerpositie (%)', labelEn: 'Marker position (%)',
    type: 'number', default: 25, min: 0, max: 100, step: 1,
  },
  {
    key: 'markerRichting', label: 'Markerzijde', labelEn: 'Marker side',
    type: 'enum', default: 'boven',
    options: [
      { value: 'boven', label: 'Boven' },
      { value: 'onder', label: 'Onder' },
    ],
  },
];

export const wapeningsstaafTemplate = {
  id: 'wapeningsstaaf',
  name: 'Wapeningsstaaf',
  nameEn: 'Reinforcement bar',
  category: 'NL Constructie',
  defaultSize: { width: 320, height: 48 },
  fixedSize: true,
  placement: 'two-point',
  params: [
    { key: 'aantal', label: 'Aantal', labelEn: 'Quantity', type: 'number', default: 3, min: 1, step: 1 },
    { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 8, min: 1, step: 1 },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 1600, min: 1, step: 10 },
    {
      key: 'markerAantal', label: 'Aantal vlaggen', labelEn: 'Marker count',
      type: 'number', default: 1, min: 1, max: 4, step: 1,
    },
    ...markerParams,
  ],
  layout(params, bbox) {
    return lineLayout(params || {}, bbox, true);
  },
  render(params, bbox) {
    return renderLine(params || {}, bbox, false, true);
  },
  editableLabels(params, bbox) {
    return editableLineLabels(params || {}, bbox, false, true);
  },
  // Buigstaat (#312): een rechte staaf, aantal × lengte.
  rebarItems(params) {
    const p = params || {};
    return [{
      aantal: integer(p.aantal, 3, 1),
      diameter: positiveNumber(p.diameter, 8, 1),
      lengteMm: positiveNumber(p.lengte, 1600, 1),
      vormcode: '00',
    }];
  },
  realSizeMm(params) {
    return { width: positiveNumber(params?.lengte, 1600, 1), height: 240 };
  },
  snapPoints,
};

export const netwapeningTemplate = {
  id: 'netwapening',
  name: 'Netwapening',
  nameEn: 'Reinforcement mesh',
  category: 'NL Constructie',
  defaultSize: { width: 320, height: 48 },
  fixedSize: true,
  params: [
    { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 8, min: 1, step: 1 },
    { key: 'afstand', label: 'H.o.h.-afstand (mm)', labelEn: 'Spacing (mm)', type: 'number', default: 150, min: 1, step: 5 },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 1600, min: 1, step: 10 },
    ...markerParams,
  ],
  layout: lineLayout,
  render(params, bbox) {
    return renderLine(params || {}, bbox, true);
  },
  editableLabels(params, bbox) {
    return editableLineLabels(params || {}, bbox, true, false);
  },
  realSizeMm(params) {
    return { width: positiveNumber(params?.lengte, 1600, 1), height: 240 };
  },
  snapPoints,
};
