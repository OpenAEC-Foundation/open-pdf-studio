import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { recordPropertyChange, recordBulkModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../../ui/panels/properties-panel.js';

// Format property signals
const [fillColor, setFillColor] = createSignal('#ffffff');
const [strokeColor, setStrokeColor] = createSignal('#000000');
const [fmtLineWidth, setFmtLineWidth] = createSignal(1);
const [opacity, setOpacity] = createSignal(100);
const [borderStyle, setBorderStyle] = createSignal('solid');
const [blendMode, setBlendMode] = createSignal('normal');
const [arrowStart, setArrowStart] = createSignal('none');
const [arrowEnd, setArrowEnd] = createSignal('open');
const [hasFill, setHasFill] = createSignal(false);
const [hasSelection, setHasSelection] = createSignal(false);
const [isLocked, setIsLocked] = createSignal(false);
const [annotationType, setAnnotationType] = createSignal('');

// Style gallery definitions
export const STYLE_DEFS = {
  'red':            { strokeColor: '#ff0000', color: '#ff0000', fillColor: null, borderStyle: 'solid' },
  'purple':         { strokeColor: '#800080', color: '#800080', fillColor: null, borderStyle: 'solid' },
  'indigo':         { strokeColor: '#4b0082', color: '#4b0082', fillColor: null, borderStyle: 'solid' },
  'blue':           { strokeColor: '#0066cc', color: '#0066cc', fillColor: null, borderStyle: 'solid' },
  'green':          { strokeColor: '#008000', color: '#008000', fillColor: null, borderStyle: 'solid' },
  'yellow':         { strokeColor: '#e6a817', color: '#e6a817', fillColor: null, borderStyle: 'solid' },
  'black':          { strokeColor: '#000000', color: '#000000', fillColor: null, borderStyle: 'solid' },
  'red-cloudy':     { strokeColor: '#ff0000', color: '#ff0000', fillColor: 'rgba(255,0,0,0.08)', borderStyle: 'solid' },
  'purple-cloudy':  { strokeColor: '#800080', color: '#800080', fillColor: 'rgba(128,0,128,0.08)', borderStyle: 'solid' },
  'indigo-cloudy':  { strokeColor: '#7b68ee', color: '#7b68ee', fillColor: 'rgba(123,104,238,0.15)', borderStyle: 'solid' },
};

export const PALETTE_COLUMNS = [
  ['#ffffff', '#d9d9d9', '#999999', '#666666', '#333333', '#000000'],
  ['#f4cccc', '#ea9999', '#e06666', '#ff0000', '#cc0000', '#660000'],
  ['#fce5cd', '#f9cb9c', '#ffff00', '#ffd966', '#f1c232', '#bf9000'],
  ['#d9ead3', '#b6d7a8', '#93c47d', '#00ff00', '#38761d', '#274e13'],
  ['#d0e0e3', '#a2c4c9', '#76a5af', '#00ffff', '#45818e', '#134f5c'],
  ['#c9daf8', '#6d9eeb', '#4a86e8', '#0000ff', '#1155cc', '#073763'],
  ['#d9d2e9', '#b4a7d6', '#9900ff', '#ff00ff', '#a64d79', '#741b47'],
];

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Apply a property change to all selected annotations with single undo
export function applyToSelected(applyFn) {
  const selected = state.selectedAnnotations;
  if (!selected || selected.length === 0) return;

  if (selected.length === 1) {
    const ann = selected[0];
    if (ann.locked) return;
    recordPropertyChange(ann);
    applyFn(ann);
    ann.modifiedAt = new Date().toISOString();
    showProperties(ann);
  } else {
    const originals = selected.map(a => cloneAnnotation(a));
    for (const ann of selected) {
      if (ann.locked) continue;
      applyFn(ann);
      ann.modifiedAt = new Date().toISOString();
    }
    recordBulkModify(selected, originals);
    showMultiSelectionProperties();
  }
  redraw();
}

function closestOption(options, val) {
  let best = options[0];
  let bestDiff = Infinity;
  for (const opt of options) {
    const diff = Math.abs(parseFloat(opt) - val);
    if (diff < bestDiff) { bestDiff = diff; best = opt; }
  }
  return best;
}

const LINE_WIDTH_OPTIONS = ['0.5', '1', '2', '3', '4', '6', '8'];
const OPACITY_OPTIONS = ['100', '90', '75', '50', '25', '10'];

// Sync format store from selected annotations
export function syncFormatStore(selectedAnnotations) {
  if (!selectedAnnotations || selectedAnnotations.length === 0) {
    setHasSelection(false);
    return;
  }

  setHasSelection(true);
  const ann = selectedAnnotations[0];
  const locked = selectedAnnotations.some(a => a.locked);
  setIsLocked(locked);
  setAnnotationType(ann.type || '');

  const fc = ann.fillColor || '#ffffff';
  setFillColor(fc);
  setHasFill(!!ann.fillColor);

  const sc = ann.strokeColor || ann.color || '#000000';
  setStrokeColor(sc);

  const lw = ann.lineWidth !== undefined ? ann.lineWidth : 1;
  setFmtLineWidth(closestOption(LINE_WIDTH_OPTIONS, lw));

  const op = ann.opacity !== undefined ? Math.round(ann.opacity * 100) : 100;
  setOpacity(closestOption(OPACITY_OPTIONS, op));

  setBorderStyle(ann.borderStyle || 'solid');
  setBlendMode(ann.blendMode || 'normal');

  if (ann.type === 'arrow') {
    setArrowStart(ann.startHead || 'none');
    setArrowEnd(ann.endHead || 'open');
  }
}

export {
  fillColor, setFillColor,
  strokeColor, setStrokeColor,
  fmtLineWidth, setFmtLineWidth,
  opacity, setOpacity,
  borderStyle, setBorderStyle,
  blendMode, setBlendMode,
  arrowStart, setArrowStart,
  arrowEnd, setArrowEnd,
  hasFill, setHasFill,
  hasSelection, setHasSelection,
  isLocked, setIsLocked,
  annotationType, setAnnotationType
};
