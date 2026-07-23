// Parametrische lijnsymbolen voor losse wapeningsstaven en netwapening.
// De ingestelde lengte bepaalt de werkelijke breedte van het symbool; de
// marker kan langs de lijn en naar boven of beneden worden verplaatst.

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
  return {
    lineY,
    markerX,
    markerTipY: lineY + direction * markerHeight,
    markerBaseY: lineY,
    markerHalfWidth,
    textY: y + height * (centerLine ? 0.22 : 0.30),
    textSize: Math.min(height * (centerLine ? 0.20 : 0.28), width * 0.045),
  };
}

function rebarLabelCommands(params, layout, isNet, bbox) {
  const font = layout.textSize;
  const gap = font * 0.20;
  const signWidth = font * 0.68;
  const signRadius = font * 0.22;
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
  let cursor = Math.max(
    bbox.x,
    Math.min(desiredX, bbox.x + Math.max(0, bbox.width - totalWidth)),
  );
  const commands = [];

  if (left) {
    commands.push({
      kind: 'text', x: cursor + leftWidth / 2, y: layout.textY,
      text: left, size: font, role: 'label',
    });
    cursor += leftWidth + leftGap;
  }

  const signX = cursor + signWidth / 2;
  commands.push({
    kind: 'circle', cx: signX, cy: layout.textY, r: signRadius,
    role: 'diameterteken',
  });
  for (const segment of diameterSignSegments(signRadius).segments) {
    commands.push({
      kind: 'line',
      x1: signX + segment.x1,
      y1: layout.textY - segment.y1,
      x2: signX + segment.x2,
      y2: layout.textY - segment.y2,
      role: 'diameterteken',
    });
  }
  cursor += signWidth + gap;
  commands.push({
    kind: 'text', x: cursor + rightWidth / 2, y: layout.textY,
    text: right, size: font, role: 'label',
  });
  return commands;
}

function markerCommands(params, layout, bbox, enabled) {
  const count = enabled
    ? Math.min(4, Math.max(1, Math.round(Number(params.markerAantal) || 1)))
    : 1;
  const gap = layout.markerHalfWidth * 0.35;
  const step = layout.markerHalfWidth * 2 + gap;
  const groupWidth = step * (count - 1) + layout.markerHalfWidth * 2;
  const center = Math.max(
    bbox.x + groupWidth / 2,
    Math.min(layout.markerX, bbox.x + bbox.width - groupWidth / 2),
  );
  return Array.from({ length: count }, (_, index) => {
    const markerX = center + (index - (count - 1) / 2) * step;
    return {
      kind: 'polyline', close: true, fill: true, role: 'marker',
      points: [
        { x: markerX - layout.markerHalfWidth, y: layout.markerBaseY },
        { x: markerX, y: layout.markerTipY },
        { x: markerX + layout.markerHalfWidth, y: layout.markerBaseY },
      ],
    };
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
  realSizeMm(params) {
    return { width: positiveNumber(params?.lengte, 1600, 1), height: 240 };
  },
  snapPoints,
};
