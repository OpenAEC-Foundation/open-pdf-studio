// Hoeveelheden — config-store. Solid-signals voor de schedule-config + memo's
// die de pure engine aanroepen. Visibility blijft in scheduleStore (re-exported).
import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { buildSchedule } from '../../quantities/engine.js';
// Koppelt de label-hook van quantities/categories.js aan i18next (side-effect).
import '../../quantities/label-i18n.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { countTallies } from './countStore.js';
import { scheduleVisible, setScheduleVisible, toggleSchedule } from './scheduleStore.js';

// Lijnvormige annotatietypes zónder eigen measureValue: hun lengte moet uit de
// geometrie + document-schaal komen (net als de meet-tools). measureDistance/
// measurePerimeter dragen hun waarde al zelf, dus die verrijken we niet.
const LENGTH_TYPES = new Set(['line', 'arrow', 'polyline', 'wall', 'spline', 'arc', 'draw']);

// Getekende vlakken zonder eigen measureValue: idem voor de OPPERVLAKTE-kolom,
// die voor deze typen tot nu toe leeg bleef. measureArea draagt zijn waarde al
// zelf en wordt dus niet verrijkt.
const AREA_TYPES = new Set([
  'filledArea', 'polygon', 'cloud', 'cloudPolyline',
  'box', 'mask', 'redaction', 'highlight', 'circle', 'ellipse',
]);

// Representatief punt van een lijnvormig element voor schaal-lookup
// (scaleRegion/scaleBar zijn positie-afhankelijk).
function lengthMidpoint(a) {
  if (typeof a.startX === 'number' && typeof a.endX === 'number') {
    return { x: (a.startX + a.endX) / 2, y: (a.startY + a.endY) / 2 };
  }
  if (typeof a.x === 'number' && typeof a.y === 'number'
      && typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  }
  const pts = Array.isArray(a.points) ? a.points : (Array.isArray(a.path) ? a.path : null);
  if (pts && pts.length) {
    const cx = pts.reduce((s, p) => s + (p.x ?? 0), 0) / pts.length;
    const cy = pts.reduce((s, p) => s + (p.y ?? 0), 0) / pts.length;
    return { x: cx, y: cy };
  }
  return { x: 0, y: 0 };
}

// Verrijk een lijn-annotatie met de opgeloste px-per-eenheid schaal zodat de
// pure categories.js-lengteberekening pixels → meter kan omrekenen.
function withScale(a) {
  const mid = lengthMidpoint(a);
  const scale = getMeasureScale(a.page || 1, mid.x, mid.y);
  return { ...a, __pxPerUnit: scale.pixelsPerUnit, __unit: scale.unit };
}

// --- Config signals ---
const [selectedCategories, setSelectedCategories] = createSignal(['area', 'line-based', 'count']);
// Standaardkolommen: naam en hoeveelheid horen er meteen bij te staan. Met
// alleen type/pagina/aantal moest je elke staat eerst zelf inrichten voordat
// je zag wat je getekend had.
const [scheduledFields, setScheduledFields] = createSignal(['type', 'page', 'label', 'area', 'length', 'count']);
const [filters, setFilters] = createSignal([]);
const [sortLevels, setSortLevels] = createSignal([
  { field: 'category', dir: 'asc', group: true, header: true, footer: true },
]);
const [itemize, setItemize] = createSignal(true);
const [grandTotals, setGrandTotals] = createSignal(true);
const [format, setFormat] = createSignal({});
const [appearance, setAppearance] = createSignal({
  gridlines: true, outline: false, stripe: false, showTitle: true, showHeaders: true,
});
const [propertiesVisible, setPropertiesVisible] = createSignal(false);
const [builtInText, setBuiltInText] = createSignal([]);

function countCatName(categoryId) {
  const t = countTallies().find(c => c.id === categoryId);
  return t ? t.name : (categoryId || '');
}

/** Alle elementen: annotaties (count verrijkt met telcategorie-naam) + native tekst. */
function collectElements() {
  const doc = getActiveDocument();
  const anns = (doc?.annotations || []).map(a => {
    if (a.type === 'count') return { ...a, __countCatName: countCatName(a.categoryId) };
    // Lijnen/pijlen zonder eigen measureValue: schaal meegeven zodat de
    // LENGTE-kolom een werkelijke lengte in meter kan tonen.
    if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return withScale(a);
    // Getekende vlakken: schaal meegeven zodat de OPPERVLAKTE-kolom gevuld
    // raakt in plaats van leeg te blijven.
    if (AREA_TYPES.has(a.type)) return withScale(a);
    // Meet-vlakken en -lijnen dragen hun eigen eenheid, maar niet altijd; geef
    // de opgeloste schaal mee als terugval voor de kolomeenheid.
    if (a.type === 'measureArea' || a.type === 'measureDistance' || a.type === 'measurePerimeter') {
      return a.measureUnit ? a : withScale(a);
    }
    return a;
  });
  const bi = selectedCategories().includes('text-built-in') ? builtInText() : [];
  return [...anns, ...bi];
}

export const scheduleResult = createMemo(() => buildSchedule(collectElements(), {
  categories: selectedCategories(),
  fields: scheduledFields(),
  filters: filters(),
  sort: sortLevels(),
  itemize: itemize(),
  format: format(),
}));

/** Laadt native PDF-tekst van de huidige pagina als text-built-in pseudo-elementen. */
export async function loadBuiltInText() {
  const doc = getActiveDocument();
  const invoke = window.__TAURI__?.core?.invoke;
  if (!doc?.filePath || !invoke) { setBuiltInText([]); return; }
  try {
    const page = doc.currentPage || 1;
    const json = await invoke('extract_page_text', { path: doc.filePath, pageIndex: page - 1 });
    const spans = typeof json === 'string' ? JSON.parse(json) : json;
    setBuiltInText((spans || [])
      .filter(s => s && s.text && String(s.text).trim())
      .map((s, i) => ({
        id: `builtin-${page}-${i}`, __category: 'text-built-in', type: 'builtinText', page,
        text: s.text, fontSize: s.fontSize, x: s.x, y: s.y, width: s.width,
      })));
  } catch (e) {
    console.warn('extract_page_text faalde', e);
    setBuiltInText([]);
  }
}

export function clearBuiltInText() { setBuiltInText([]); }

export {
  selectedCategories, setSelectedCategories,
  scheduledFields, setScheduledFields,
  filters, setFilters,
  sortLevels, setSortLevels,
  itemize, setItemize,
  grandTotals, setGrandTotals,
  format, setFormat,
  appearance, setAppearance,
  propertiesVisible, setPropertiesVisible,
  builtInText,
  scheduleVisible, setScheduleVisible, toggleSchedule,
};
