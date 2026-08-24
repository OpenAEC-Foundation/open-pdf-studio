// Staten-beheer (issue #277): een LIJST van benoemde schedules die de gebruiker
// naast elkaar kan beheren (toevoegen vanaf standaard-sjabloon, hernoemen,
// verwijderen) en naar de PDF kan slepen. Elke schedule bewaart een config die
// aan quantities/engine.buildSchedule gevoerd wordt. Persistent in preferences.
import { createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { buildSchedule } from '../../quantities/engine.js';
// Koppelt de label-hook van quantities/categories.js aan i18next (side-effect).
import '../../quantities/label-i18n.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { countTallies } from './countStore.js';
import { STANDARD_SCHEDULE_TEMPLATES, getTemplateById } from '../../quantities/schedule-templates.js';

// Lijnvormige types zónder eigen measureValue: lengte moet uit geometrie +
// document-schaal komen (spiegelt quantitiesStore.collectElements).
const LENGTH_TYPES = new Set(['line', 'arrow', 'polyline', 'wall', 'spline', 'arc', 'draw']);

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

function withLengthScale(a) {
  const mid = lengthMidpoint(a);
  const scale = getMeasureScale(a.page || 1, mid.x, mid.y);
  return { ...a, __pxPerUnit: scale.pixelsPerUnit, __unit: scale.unit };
}

function countCatName(categoryId) {
  const t = countTallies().find(c => c.id === categoryId);
  return t ? t.name : (categoryId || '');
}

/** Alle annotaties van het actieve document, verrijkt zoals de engine verwacht. */
function collectElements() {
  const doc = getActiveDocument();
  return (doc?.annotations || []).map(a => {
    if (a.type === 'count') return { ...a, __countCatName: countCatName(a.categoryId) };
    if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return withLengthScale(a);
    return a;
  });
}

// --- Persistente lijst van schedules ---
function loadInitial() {
  const saved = state.preferences?.userSchedules;
  return Array.isArray(saved) ? saved : [];
}

const [schedules, setSchedules] = createSignal(loadInitial());

function persist() {
  state.preferences.userSchedules = schedules();
  try { savePreferences(); } catch (_) { /* preferences kunnen ontbreken buiten Tauri */ }
}

function newId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Voeg een schedule toe op basis van een standaard-sjabloon. `name` is een
 *  reeds vertaalde weergavenaam (de aanroeper heeft de i18n-key opgelost). */
export function addScheduleFromTemplate(templateId, name) {
  const tpl = getTemplateById(templateId);
  if (!tpl) return null;
  const item = {
    id: newId(),
    name: name || templateId,
    templateId,
    config: JSON.parse(JSON.stringify(tpl.config)),
  };
  setSchedules([...schedules(), item]);
  persist();
  return item;
}

export function renameSchedule(id, name) {
  setSchedules(schedules().map(s => s.id === id ? { ...s, name } : s));
  persist();
}

/** Vervang de config van een schedule (wizard). Reactief + persistent. */
export function updateScheduleConfig(id, config) {
  setSchedules(schedules().map(s => s.id === id
    ? { ...s, config: JSON.parse(JSON.stringify(config || {})) }
    : s));
  persist();
}

/** Maak een lege (blanco) schedule zonder sjabloon — voor de "Nieuwe staat"-wizard. */
export function addBlankSchedule(name) {
  const item = {
    id: newId(),
    name: name || 'Schedule',
    templateId: null,
    config: { categories: [], fields: [], filters: [], sort: [], itemize: true, format: {} },
  };
  setSchedules([...schedules(), item]);
  persist();
  return item;
}

// --- Wizard/configuratie-UI-state (welke staat wordt bewerkt) ---
const [configuringId, setConfiguringId] = createSignal(null);
export { configuringId, setConfiguringId };

export function removeSchedule(id) {
  setSchedules(schedules().filter(s => s.id !== id));
  persist();
}

export function getScheduleById(id) {
  return schedules().find(s => s.id === id) || null;
}

/** Bouw het (reactieve) engine-resultaat voor een schedule tegen het actieve doc. */
export function buildResultForSchedule(schedule) {
  if (!schedule) return null;
  return buildSchedule(collectElements(), schedule.config);
}

export { schedules, setSchedules, STANDARD_SCHEDULE_TEMPLATES };
