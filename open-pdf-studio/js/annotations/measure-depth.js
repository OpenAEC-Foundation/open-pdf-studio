// Depth of a measurement (#311): a length in the measurement's own unit
// (`measureDepth`). With it a length becomes a surface (wall length × height)
// and an area a volume (floor area × thickness). Stored on the annotation and
// saved with tool set items; the measured value itself is unchanged.

import { lengteEenheid } from './vlak-zijden.js';
import { leesGetalOfNull } from '../core/getal-invoer.js';

const DEPTH_TYPES = new Set(['measureDistance', 'measurePerimeter', 'measureArea']);

export function supportsDepth(type) {
  return DEPTH_TYPES.has(type);
}

/** A depth from the panel: a positive number, or undefined (no depth). */
export function parseDepth(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : leesGetalOfNull(String(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Small units are shown in metres: 2400 mm × 3000 mm reads as 7.2 m², not
// 7200000 mm².
const TO_METRE = { mm: 0.001, cm: 0.01 };

/**
 * Surface (length × depth) or volume (area × depth) of a measurement, or
 * null without a depth or a value. `kind` is 'surface' or 'volume'.
 */
export function depthQuantity(ann) {
  if (!ann || !supportsDepth(ann.type)) return null;
  const depth = parseDepth(ann.measureDepth);
  const value = Number(ann.measureValue);
  const unit = lengteEenheid(ann.measureUnit);
  if (!depth || !Number.isFinite(value) || !unit) return null;
  const volume = ann.type === 'measureArea';
  const power = volume ? 3 : 2;
  let result = value * depth;
  let outUnit = unit;
  const f = TO_METRE[unit];
  if (f) {
    result *= f ** power;
    outUnit = 'm';
  }
  return { kind: volume ? 'volume' : 'surface', value: result, unit: outUnit + (volume ? '³' : '²') };
}

export function formatDepthQuantity(q, decimals = 3) {
  if (!q || !Number.isFinite(q.value)) return '';
  return `${q.value.toFixed(decimals)} ${q.unit}`;
}
