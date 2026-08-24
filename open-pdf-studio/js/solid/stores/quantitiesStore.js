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

// Representatief punt van een lijnvormig element voor schaal-lookup
// (scaleRegion/scaleBar zijn positie-afhankelijk).
function lengthMidpoint(a) {
  if (typeof a.startX === 'number' && typeof a.endX === 'number') {
    return { x: (a.startX + a.endX) / 2, y: (a.startY + a.endY) / 2 };
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
function withLengthScale(a) {
  const mid = lengthMidpoint(a);
  const scale = getMeasureScale(a.page || 1, mid.x, mid.y);
  return { ...a, __pxPerUnit: scale.pixelsPerUnit, __unit: scale.unit };
}

// --- Config signals ---
const [selectedCategories, setSelectedCategories] = createSignal(['area', 'line-based', 'count']);
const [scheduledFields, setScheduledFields] = createSignal(['type', 'page', 'count']);
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
    if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return withLengthScale(a);
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
