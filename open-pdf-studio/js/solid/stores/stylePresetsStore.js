import { createSignal } from 'solid-js';
import { zetRanddikte } from '../../annotations/rendering/textbox-layout.js';
import { getActiveDocument } from '../../core/state.js';
import { applyToSelected } from './formatStore.js';
import { annotProps, updateAnnotProp } from './propertiesStore.js';
import { heeftVulDekking } from '../../annotations/vul-dekking.js';

/**
 * Named line-style presets (WEERGAVE-stijlen).
 *
 * A preset captures the appearance props of the Eigenschappen-paneel
 * WEERGAVE-sectie (fill/stroke colour, opacity, line width, border style,
 * plus line endings when present) under a user-chosen name.
 *
 * Presets are DOCUMENT-level data: they live on the DocumentState
 * (`doc.stylePresets`) and are persisted inside the PDF itself via the
 * catalog entry `OPS_StylePresets` (see js/pdf/saver/style-presets.js),
 * so they travel with the document.
 *
 * Applying a preset goes through the existing edit paths so undo works:
 *  - with a selection: formatStore.applyToSelected (single undo step,
 *    same path as the ribbon style gallery);
 *  - in tool-defaults mode: propertiesStore.updateAnnotProp per key
 *    (routes into preferences, like every other panel control).
 */

// Keys a preset may carry. Anything else in a loaded preset is ignored.
export const STYLE_PRESET_KEYS = [
  'fillColor', 'strokeColor', 'color', 'opacity', 'fillOpacity', 'lineWidth',
  'borderStyle', 'startHead', 'endHead', 'headSize',
];

// Mirror of propertiesStore's stroke-colour-driven types: for these,
// setting 'color' must also set strokeColor (rendering resolves
// `strokeColor || color`).
const _STROKE_COLOR_DRIVEN = new Set([
  'parametricSymbol', 'polyline', 'cloudPolyline', 'spline', 'draw',
]);

// Types that carry line endings.
const _HEAD_TYPES = new Set(['arrow', 'line', 'polyline', 'measureDistance']);

// Text appearance belongs to the transient clipboard, not the named line presets.
const TEXT_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontBold', 'fontItalic', 'fontUnderline',
  'fontStrikethrough', 'textColor', 'textAlign', 'textVAlign',
];
const TEXT_TYPES = new Set(['textbox', 'callout', 'text', 'measureDistance',
  'measureArea', 'measurePerimeter', 'measureAngle']);
function applyClipboardText(ann, props) {
  for (const key of TEXT_STYLE_KEYS) {
    if (props[key] === undefined || !(TEXT_TYPES.has(ann.type) || key in ann)) continue;
    ann[key] = props[key];
    if ((key === 'fontBold' || key === 'fontItalic') && Array.isArray(ann.textRuns)) {
      const field = key === 'fontBold' ? 'bold' : 'italic';
      ann.textRuns = ann.textRuns.map(line => (line || []).map(run => ({ ...run, [field]: !!props[key] })));
    }
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function _captureFromAnnotation(ann) {
  const props = {};
  // fillColor: null is meaningful ("no fill"), so copy it verbatim when the
  // annotation has the concept of a fill at all.
  if ('fillColor' in ann) props.fillColor = ann.fillColor ?? null;
  if (ann.strokeColor !== undefined) props.strokeColor = ann.strokeColor;
  if (ann.color !== undefined) props.color = ann.color;
  if (ann.opacity !== undefined) props.opacity = Math.round(ann.opacity * 100);
  // Eigen vul-dekking (#685), alleen als de vorm er een heeft.
  if (heeftVulDekking(ann.type) && typeof ann.fillOpacity === 'number') {
    props.fillOpacity = Math.round(ann.fillOpacity * 100);
  }
  if (ann.lineWidth !== undefined) props.lineWidth = parseFloat(ann.lineWidth);
  if (ann.borderStyle !== undefined) props.borderStyle = ann.borderStyle;
  if (ann.startHead !== undefined) props.startHead = ann.startHead;
  if (ann.endHead !== undefined) props.endHead = ann.endHead;
  if (ann.headSize !== undefined) props.headSize = ann.headSize;
  return props;
}

function _captureFromPanel() {
  // Tool-defaults mode (or no selection): capture the panel values.
  const props = {};
  const p = annotProps;
  if (p.fillColor !== 'mixed') props.fillColor = p.fillColor ?? null;
  if (p.strokeColor && p.strokeColor !== 'mixed') props.strokeColor = p.strokeColor;
  if (p.color && p.color !== 'mixed') props.color = p.color;
  if (p.opacity !== 'mixed' && p.opacity !== undefined) props.opacity = parseInt(p.opacity);
  if (heeftVulDekking(p.type) && p.fillOpacity !== 'mixed' && p.fillOpacity !== undefined) {
    props.fillOpacity = parseInt(p.fillOpacity);
  }
  if (p.lineWidth !== 'mixed' && p.lineWidth !== undefined) props.lineWidth = parseFloat(p.lineWidth);
  if (p.borderStyle && p.borderStyle !== 'mixed') props.borderStyle = p.borderStyle;
  return props;
}

/**
 * Capture the current appearance as a plain props object, from the first
 * selected annotation, or from the panel values when nothing is selected
 * (tool-defaults mode). Returns null when there is nothing to capture.
 */
export function captureCurrentStyle() {
  const doc = getActiveDocument();
  const sel = doc ? doc.selectedAnnotations : [];
  const ann = (sel && sel.length > 0) ? sel[0] : doc?.selectedAnnotation;
  const props = ann ? _captureFromAnnotation(ann) : _captureFromPanel();
  // Drop 'mixed' leftovers defensively.
  for (const k of Object.keys(props)) {
    if (props[k] === 'mixed') delete props[k];
    if (!STYLE_PRESET_KEYS.includes(k)) delete props[k];
  }
  return Object.keys(props).length > 0 ? props : null;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

// Write preset props onto one annotation with the same semantics as
// propertiesStore.updateAnnotProp's switch.
function _applyPropsToAnnotation(ann, props) {
  if (props.color !== undefined) {
    ann.color = props.color;
    if (_STROKE_COLOR_DRIVEN.has(ann.type)) ann.strokeColor = props.color;
  }
  if (props.strokeColor !== undefined) {
    ann.strokeColor = props.strokeColor;
    if (ann.type === 'parametricSymbol') ann.color = props.strokeColor;
  }
  if (props.fillColor !== undefined && 'fillColor' in ann) ann.fillColor = props.fillColor;
  if (props.opacity !== undefined) {
    const op = Math.max(0, Math.min(100, parseInt(props.opacity)));
    if (!isNaN(op)) ann.opacity = op / 100;
  }
  // Vul-dekking (#685): een stijl zonder eigen vul-dekking is één dekking
  // voor lijn en vulling, zoals een ouder bestand.
  if (heeftVulDekking(ann.type)) {
    const vul = props.fillOpacity !== undefined ? parseInt(props.fillOpacity) : NaN;
    if (!isNaN(vul)) ann.fillOpacity = Math.max(0, Math.min(100, vul)) / 100;
    else if (props.opacity !== undefined) delete ann.fillOpacity;
  }
  if (props.lineWidth !== undefined) {
    const lw = parseFloat(props.lineWidth);
    if (!isNaN(lw)) zetRanddikte(ann, lw);
  }
  if (props.borderStyle !== undefined) ann.borderStyle = props.borderStyle;
  // Line endings: only where they make sense.
  const takesHeads = _HEAD_TYPES.has(ann.type) ||
    ann.startHead !== undefined || ann.endHead !== undefined;
  if (takesHeads) {
    if (props.startHead !== undefined) ann.startHead = props.startHead;
    if (props.endHead !== undefined) ann.endHead = props.endHead;
    if (props.headSize !== undefined) ann.headSize = props.headSize;
  }
}

/**
 * Apply a style-props object to the current selection (single undo step via
 * formatStore.applyToSelected). Without a selection, routes through
 * updateAnnotProp so tool-defaults mode keeps working.
 */
export function applyStyleToSelection(props) {
  if (!props) return;
  const doc = getActiveDocument();
  const sel = doc ? doc.selectedAnnotations : [];
  if (sel && sel.length > 0) {
    applyToSelected((ann) => {
      _applyPropsToAnnotation(ann, props);
      applyClipboardText(ann, props);
    });
    return;
  }
  // Tool-defaults mode: the panel shows a synthetic annotation; updateAnnotProp
  // routes each write into state.preferences.
  if (annotProps.id === '__tool-defaults__') {
    if (props.color !== undefined) updateAnnotProp('color', props.color);
    if (props.strokeColor !== undefined) updateAnnotProp('strokeColor', props.strokeColor);
    if (props.fillColor !== undefined) updateAnnotProp('fillColor', props.fillColor);
    if (props.opacity !== undefined) updateAnnotProp('opacity', props.opacity);
    if (props.fillOpacity !== undefined) updateAnnotProp('fillOpacity', props.fillOpacity);
    if (props.lineWidth !== undefined) updateAnnotProp('lineWidth', props.lineWidth);
    if (props.borderStyle !== undefined) updateAnnotProp('borderStyle', props.borderStyle);
    if (props.startHead !== undefined) updateAnnotProp('startHead', props.startHead);
    if (props.endHead !== undefined) updateAnnotProp('endHead', props.endHead);
    if (props.headSize !== undefined) updateAnnotProp('headSize', props.headSize);
    for (const key of TEXT_STYLE_KEYS) {
      if (props[key] !== undefined && TEXT_TYPES.has(annotProps.type)) updateAnnotProp(key, props[key]);
    }
  }
}

// ---------------------------------------------------------------------------
// Preset CRUD (document-level, persisted in the PDF on save)
// ---------------------------------------------------------------------------

function _newId() {
  return 'sp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Presets of the active document (reactive: state is createMutable). */
export function getStylePresets() {
  const doc = getActiveDocument();
  return (doc && Array.isArray(doc.stylePresets)) ? doc.stylePresets : [];
}

/**
 * Create a named preset from the current appearance. Returns the preset,
 * or null when there is no document / nothing to capture / empty name.
 */
export function createStylePreset(name) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const props = captureCurrentStyle();
  if (!props) return null;
  const preset = { id: _newId(), name: trimmed, props };
  doc.stylePresets = [...(doc.stylePresets || []), preset];
  doc.modified = true;
  return preset;
}

export function deleteStylePreset(id) {
  const doc = getActiveDocument();
  if (!doc || !Array.isArray(doc.stylePresets)) return;
  const next = doc.stylePresets.filter(p => p.id !== id);
  if (next.length !== doc.stylePresets.length) {
    doc.stylePresets = next;
    doc.modified = true;
  }
}

export function renameStylePreset(id, name) {
  const doc = getActiveDocument();
  if (!doc || !Array.isArray(doc.stylePresets)) return;
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  doc.stylePresets = doc.stylePresets.map(p =>
    p.id === id ? { ...p, name: trimmed } : p
  );
  doc.modified = true;
}

/** Apply a stored preset (by id) to the current selection. */
export function applyStylePresetById(id) {
  const preset = getStylePresets().find(p => p.id === id);
  if (preset) applyStyleToSelection(preset.props);
}

// ---------------------------------------------------------------------------
// Copy / paste style (app-level clipboard, works across documents)
// ---------------------------------------------------------------------------

const [copiedStyle, setCopiedStyle] = createSignal(null);
export { copiedStyle };

export function copyStyleFromSelection() {
  const props = captureCurrentStyle();
  if (props) {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotations?.[0] || doc?.selectedAnnotation;
    if (ann) {
      for (const key of TEXT_STYLE_KEYS) {
        if (ann[key] !== undefined && ann[key] !== 'mixed') props[key] = ann[key];
      }
      // Missing booleans mean plain text, not 'retain the recipient's bold'.
      if (TEXT_TYPES.has(ann.type)) {
        for (const key of ['fontBold', 'fontItalic', 'fontUnderline', 'fontStrikethrough']) props[key] = !!ann[key];
        props.textAlign = ann.textAlign || 'left';
        props.textVAlign = ann.textVAlign || 'top';
      }
    }
    setCopiedStyle(props);
  }
  return props;
}

export function pasteStyleToSelection() {
  const props = copiedStyle();
  if (props) applyStyleToSelection(props);
}
