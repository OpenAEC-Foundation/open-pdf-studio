import { createSignal, createRoot, createEffect } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { recordPropertyChange, recordBulkModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { lintZetLijnkoppen, koppenVan } from '../../pdf/lijnkoppen.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../../ui/panels/properties-panel.js';
import { applyStampLineWidth, applyStampColor } from '../../annotations/stamp-line-width.js';
import { stampAppearanceSnapshot, syncStampAppearance } from '../../annotations/stamp-appearance-sync.js';
import {
  symbolInsertActive, symbolInsertDisplay, setSymbolInsertFormat, symbolInsertSupports,
} from '../../symbols/symbol-insert-format-store.js';
import {
  gereedschapMetOpmaak, gereedschapOndersteunt, leesGereedschapOpmaak,
  zetGereedschapOpmaak, stijlTypeVanGereedschap,
} from '../../tools/gereedschap-opmaak.js';
import { heeftVulDekking, vulDekking } from '../../annotations/vul-dekking.js';

// Een symbool (SVG-stempel) wordt als raster getekend: kleur en lijndikte
// moeten na de wijziging de SVG in, anders heeft de werkbalk geen effect (#398).
const STAMP_HOOKS = { applyStampLineWidth, applyStampColor };

function applyFnToAnnotation(ann, applyFn) {
  const before = stampAppearanceSnapshot(ann);
  applyFn(ann);
  syncStampAppearance(ann, before, STAMP_HOOKS);
}

// Format property signals
const [textColor, setTextColor] = createSignal('#000000');
const [hasTextColor, setHasTextColor] = createSignal(false);
const [fillColor, setFillColor] = createSignal('#ffffff');
const [strokeColor, setStrokeColor] = createSignal('#000000');
const [fmtLineWidth, setFmtLineWidth] = createSignal(1);
const [opacity, setOpacity] = createSignal(100);
// Aparte dekking voor de vulling (#685), in procenten, en of het doel die
// kent (rechthoek, ellips, veelhoek, wolk).
const [fillOpacity, setFillOpacity] = createSignal(100);
const [aparteVulDekking, setAparteVulDekking] = createSignal(false);
const [borderStyle, setBorderStyle] = createSignal('solid');
const [blendMode, setBlendMode] = createSignal('normal');
const [arrowStart, setArrowStart] = createSignal('none');
const [arrowEnd, setArrowEnd] = createSignal('open');
const [hasFill, setHasFill] = createSignal(false);
const [hasSelection, setHasSelection] = createSignal(false);
const [isLocked, setIsLocked] = createSignal(false);
const [annotationType, setAnnotationType] = createSignal('');
// True when exactly one editable symbol-stamp (carries stampSvg) is selected —
// drives the contextual "Edit Type" affordance in the Format tab.
const [isSingleSymbolStamp, setIsSingleSymbolStamp] = createSignal(false);

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
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Apply a property change to all selected annotations with single undo
export function applyToSelected(applyFn) {
  const _fmtDoc = getActiveDocument();
  const selected = _fmtDoc ? _fmtDoc.selectedAnnotations : [];
  if (!selected || selected.length === 0) return;

  if (selected.length === 1) {
    const ann = selected[0];
    if (ann.locked) return;
    recordPropertyChange(ann);
    applyFnToAnnotation(ann, applyFn);
    ann.modifiedAt = new Date().toISOString();
    showProperties(ann);
  } else {
    const originals = selected.map(a => cloneAnnotation(a));
    for (const ann of selected) {
      if (ann.locked) continue;
      applyFnToAnnotation(ann, applyFn);
      ann.modifiedAt = new Date().toISOString();
    }
    recordBulkModify(selected, originals);
    showMultiSelectionProperties();
  }
  redraw();
}

// Invoegmodus voor symbolen (#587): de werkbalk toont de opmaak voor de
// VOLGENDE plaatsingen — de gekozen waarde, anders de eigen opmaak van het
// gekozen symbool. Een automatisch geselecteerd, net geplaatst symbool telt
// hier niet; dat behoudt zijn eigen opmaak.
function syncFromSymbolInsert(selectedAnnotations) {
  const d = symbolInsertDisplay();
  setHasSelection(!!selectedAnnotations && selectedAnnotations.length > 0);
  setIsSingleSymbolStamp(false);
  setIsLocked(false);
  setAnnotationType('symbolInsert');
  setHasTextColor(false);
  setFillColor('#ffffff');
  setHasFill(false);
  setStrokeColor(d.strokeColor);
  setFmtLineWidth(d.lineWidth);
  setOpacity(d.opacity);
  setAparteVulDekking(false);
  setBorderStyle('solid');
  setBlendMode(d.blendMode);
}

/**
 * Een optie van de werkbalk instellen voor de volgende plaatsingen tijdens
 * het invoegen van symbolen. Raakt geen enkel bestaand symbool.
 */
export function setSymbolInsertOption(patch) {
  setSymbolInsertFormat(patch);
  syncFromSymbolInsert(getActiveDocument()?.selectedAnnotations || []);
}

// ── Opmaak van het actieve tekengereedschap (#668) ─────────────────────────
// Zonder selectie en buiten de invoegmodus voor symbolen werkt de werkbalk
// (en kleur/breedte in het lint) op de VOLGENDE annotatie van het actieve
// tekengereedschap: de stijlvoorkeuren van dat gereedschap. Die blijven
// staan voor het volgende object van hetzelfde gereedschap.

/**
 * Reactief: het tekengereedschap waarvan de werkbalk nu de opmaak instelt,
 * of null (er is iets geselecteerd, er worden symbolen ingevoegd, of het
 * gereedschap heeft geen instelbare stijl).
 */
export function gereedschapOpmaakDoel() {
  if (symbolInsertActive()) return null;
  const doc = getActiveDocument();
  if (!doc) return null;
  return gereedschapMetOpmaak(state.currentTool, doc.selectedAnnotations?.length || 0);
}

/**
 * Reactief: waar de werkbalk nu op werkt: 'symbool' (de invoegsessie),
 * 'selectie', 'gereedschap' (het volgende object van het actieve
 * tekengereedschap) of null (nergens op).
 */
export function opmaakDoel() {
  if (symbolInsertActive()) return 'symbool';
  if ((getActiveDocument()?.selectedAnnotations?.length || 0) > 0) return 'selectie';
  return gereedschapOpmaakDoel() ? 'gereedschap' : null;
}

/** Reactief: stelt de werkbalk de opmaak in van wat nog geplaatst wordt? */
export function opmaakVoorNieuw() {
  const doel = opmaakDoel();
  return doel === 'symbool' || doel === 'gereedschap';
}

/** Reactief: kan de werkbalk deze optie nu instellen? */
export function opmaakOndersteunt(key) {
  switch (opmaakDoel()) {
    case 'symbool': return symbolInsertSupports(key);
    case 'gereedschap': return gereedschapOndersteunt(state.currentTool, key);
    case 'selectie': return true;
    default: return false;
  }
}

function syncFromGereedschap(tool) {
  const o = leesGereedschapOpmaak(state.preferences, tool);
  if (!o) return;
  setHasSelection(false);
  setIsSingleSymbolStamp(false);
  setIsLocked(false);
  setAnnotationType(stijlTypeVanGereedschap(tool) || '');
  setHasTextColor(gereedschapOndersteunt(tool, 'textColor'));
  setTextColor(o.textColor);
  setFillColor(o.fillColor || '#ffffff');
  setHasFill(!!o.fillColor);
  setStrokeColor(o.strokeColor);
  setFmtLineWidth(o.lineWidth);
  setOpacity(o.opacity);
  setFillOpacity(o.fillOpacity);
  setAparteVulDekking(gereedschapOndersteunt(tool, 'fillOpacity'));
  setBorderStyle(o.borderStyle);
  setBlendMode('normal');
  setArrowStart(o.startHead);
  setArrowEnd(o.endHead);
}

// Voorkeuren één keer bewaren na een reeks wijzigingen (een schuif of een
// kleurkiezer geeft er veel achter elkaar); de waarde zelf geldt meteen.
let _bewaarTimer = null;
function bewaarVoorkeurenStraks() {
  if (_bewaarTimer) clearTimeout(_bewaarTimer);
  _bewaarTimer = setTimeout(() => {
    _bewaarTimer = null;
    import('../../core/preferences.js')
      .then((m) => m.savePreferences())
      .catch(() => { /* de waarde staat al in state.preferences */ });
  }, 300);
}

// Het eigenschappenpaneel toont bij een actief gereedschap een kopie van zijn
// standaardstijl ('__tool-defaults__') en schrijft die bij een wijziging
// helemaal terug. Na een wijziging via de werkbalk moet die kopie dus mee,
// anders zet de volgende paneelwijziging de oude waarde terug.
function vernieuwPaneelStandaarden(tool) {
  import('./propertiesStore.js').then((m) => {
    if (m.getCurrentAnnotation?.()?.id !== '__tool-defaults__') return;
    m.showToolDefaults(tool, {}, () => state.currentTool === tool);
  }).catch(() => { /* paneel nog niet geladen */ });
}

function zetGereedschapOpmaakEnBewaar(tool, patch) {
  if (!zetGereedschapOpmaak(state.preferences, tool, patch)) return;
  syncFromGereedschap(tool);
  bewaarVoorkeurenStraks();
  vernieuwPaneelStandaarden(tool);
}

/**
 * Eén optie van de werkbalk (of van kleur/breedte in het lint) instellen op
 * wat er nu het doel is: de invoegsessie van symbolen, het volgende object
 * van het actieve tekengereedschap, of de selectie (`applyFn`, met undo).
 * `patch` gebruikt de namen van de werkbalk: strokeColor, lineWidth, opacity
 * (0..1), fillOpacity (0..1), blendMode, borderStyle, fillColor (null = geen),
 * startHead, endHead.
 */
export function zetOpmaak(patch, applyFn) {
  switch (opmaakDoel()) {
    case 'symbool':
      setSymbolInsertOption(patch);
      return;
    case 'gereedschap':
      zetGereedschapOpmaakEnBewaar(state.currentTool, patch);
      return;
    case 'selectie':
      applyToSelected(applyFn);
      syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
      return;
    default:
      // Geen doel: niets geselecteerd en geen gereedschap met een stijl.
      break;
  }
}

// De werkbalk volgt de voorkeuren van het gereedschap ook als ze elders
// veranderen (eigenschappenpaneel, voorkeurenvenster). Pas na het laden van
// alle modules, zodat de import-kringloop via bridge.ts geen rol speelt.
queueMicrotask(() => createRoot(() => {
  createEffect(() => {
    const tool = gereedschapOpmaakDoel();
    if (tool) syncFromGereedschap(tool);
  });
}));

export function setFormatTextColor(color) {
  if (!hasTextColor()) return;
  zetOpmaak({ textColor: color }, ann => {
    ann.textColor = color;
    import('../../tools/text-editing.js').then(m => m.werkEditorStijlBij(ann));
  });
}

// Sync format store from selected annotations
export function syncFormatStore(selectedAnnotations) {
  if (symbolInsertActive()) {
    syncFromSymbolInsert(selectedAnnotations);
    return;
  }
  if (!selectedAnnotations || selectedAnnotations.length === 0) {
    const tool = gereedschapOpmaakDoel();
    if (tool) {
      syncFromGereedschap(tool);
      return;
    }
    setHasSelection(false);
    setHasTextColor(false);
    setIsSingleSymbolStamp(false);
    setAparteVulDekking(false);
    return;
  }

  setHasSelection(true);
  const ann = selectedAnnotations[0];
  setIsSingleSymbolStamp(
    selectedAnnotations.length === 1 &&
    ann.type === 'stamp' &&
    !!(ann.stampSvg || ann.stampBaseSvg)
  );
  const locked = selectedAnnotations.some(a => a.locked);
  setIsLocked(locked);
  setAnnotationType(ann.type || '');
  setHasTextColor(selectedAnnotations.every(a => a.type === 'textbox' || a.type === 'callout'));
  setTextColor(ann.textColor || '#000000');

  const fc = ann.fillColor || '#ffffff';
  setFillColor(fc);
  setHasFill(!!ann.fillColor);

  const sc = ann.strokeColor || ann.color || '#000000';
  setStrokeColor(sc);

  const lw = ann.lineWidth !== undefined ? ann.lineWidth : 1;
  setFmtLineWidth(lw);

  const op = ann.opacity !== undefined ? Math.round(ann.opacity * 100) : 100;
  setOpacity(op);
  setFillOpacity(Math.round(vulDekking(ann) * 100));
  setAparteVulDekking(selectedAnnotations.every(a => heeftVulDekking(a.type)));

  setBorderStyle(ann.borderStyle || 'solid');
  setBlendMode(ann.blendMode || 'normal');

  // Pijl, gebogen pijl en callout (#612): de koppen zoals het scherm ze tekent.
  if (lintZetLijnkoppen(ann.type)) {
    const koppen = koppenVan(ann);
    setArrowStart(koppen.startHead);
    setArrowEnd(koppen.endHead);
  }
}

export {
  textColor, hasTextColor,
  fillColor, setFillColor,
  strokeColor, setStrokeColor,
  fmtLineWidth, setFmtLineWidth,
  opacity, setOpacity,
  fillOpacity, setFillOpacity,
  aparteVulDekking, setAparteVulDekking,
  borderStyle, setBorderStyle,
  blendMode, setBlendMode,
  arrowStart, setArrowStart,
  arrowEnd, setArrowEnd,
  hasFill, setHasFill,
  hasSelection, setHasSelection,
  isLocked, setIsLocked,
  annotationType, setAnnotationType,
  isSingleSymbolStamp, setIsSingleSymbolStamp
};
