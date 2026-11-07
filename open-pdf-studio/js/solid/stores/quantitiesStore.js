// Hoeveelheden — config-store. Solid-signals voor de schedule-config + memo's
// die de pure engine aanroepen. Visibility blijft in scheduleStore (re-exported).
import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument, getAnnotationBounds } from '../../core/state.js';
import { buildSchedule } from '../../quantities/engine.js';
import { scheduleUsesLocation } from '../../quantities/categories.js';
import { collectZones, locationFor } from '../../annotations/spatial-zones.js';
// Koppelt de label-hook van quantities/categories.js aan i18next (side-effect).
import '../../quantities/label-i18n.js';
import { verrijkVoorStaat, documentEenheid } from './staatElementen.js';
import { metSchaalBronnen } from '../../annotations/schaal-bronnen.js';
import { countTallies } from './countStore.js';
import { wapeningsElementen } from '../../quantities/wapening.js';
import { getTemplate } from '../../symbols/registry.js';
import { scheduleVisible, setScheduleVisible, toggleSchedule } from './scheduleStore.js';

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
  // Eén doorloop: de schaalbronnen van het document worden één keer verzameld
  // in plaats van per element opnieuw uit de hele annotatielijst (#491).
  // Schaal per element: zie staatElementen.js (lengte, oppervlakte, omtrek).
  const anns = metSchaalBronnen(() => (doc?.annotations || []).map(a => verrijkVoorStaat(a, countCatName)));
  const bi = selectedCategories().includes('text-built-in') ? builtInText() : [];
  // Wapening: buigstaat-regels uit stavenreeksen en wapeningssymbolen.
  const rebar = selectedCategories().includes('reinforcement')
    ? wapeningsElementen(doc?.annotations || [], getTemplate) : [];
  const elements = [...anns, ...bi, ...rebar];
  // De Locatie-kolommen kosten per element een zone-opzoeking: alleen als de
  // staat ze toont, erop filtert of erop sorteert.
  if (!scheduleUsesLocation({ fields: scheduledFields(), filters: filters(), sort: sortLevels() })) return elements;
  const zones = collectZones(doc?.annotations);
  return elements.map(a => ({ ...a, __location: locationFor(a, zones, getAnnotationBounds(a)) }));
}

function computeSchedule() {
  return buildSchedule(collectElements(), {
    categories: selectedCategories(),
    fields: scheduledFields(),
    filters: filters(),
    sort: sortLevels(),
    itemize: itemize(),
    format: format(),
  }, { documentUnit: documentEenheid(getActiveDocument()) });
}

// Alleen zolang het hoeveelhedenpaneel open staat houdt een memo de staat bij.
// Een Solid-memo rekent bij elke wijziging meteen opnieuw, ook zonder lezer:
// met het paneel dicht kostte zo elke toevoeging, verwijdering of ongedaan-stap
// een volledige herberekening (#491). Dicht leest de memo alleen
// scheduleVisible(); gaat het paneel open, dan rekent hij vers.
const scheduleInView = createMemo(() => (scheduleVisible() ? computeSchedule() : null));

/** De hoeveelhedenstaat van het actieve document. Met het paneel open uit de
 *  memo; anders op verzoek berekend (zonder bij te houden). */
export function scheduleResult() {
  return scheduleInView() ?? computeSchedule();
}

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
