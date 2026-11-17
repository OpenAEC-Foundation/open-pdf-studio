// Staten-beheer (issue #277): een LIJST van benoemde schedules die de gebruiker
// naast elkaar kan beheren (toevoegen vanaf standaard-sjabloon, hernoemen,
// verwijderen) en naar de PDF kan slepen. Elke schedule bewaart een config die
// aan quantities/engine.buildSchedule gevoerd wordt. Persistent in preferences.
import { createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { buildSchedule } from '../../quantities/engine.js';
// Koppelt de label-hook van quantities/categories.js aan i18next (side-effect).
import { standaardLaagNaam } from '../../quantities/label-i18n.js';
import { scheduleUsesLayer } from '../../quantities/categories.js';
import { verrijkVoorStaat, documentEenheid, metLaagNamen } from './staatElementen.js';
import { metSchaalBronnen } from '../../annotations/schaal-bronnen.js';
import { countTallies } from './countStore.js';
import { wapeningsElementen } from '../../quantities/wapening.js';
import { getTemplate } from '../../symbols/registry.js';
import { STANDARD_SCHEDULE_TEMPLATES, getTemplateById } from '../../quantities/schedule-templates.js';
import { planTagChanges, applyTagChange } from '../../quantities/takeoff-tags.js';
import { collectZones, locationFor } from '../../annotations/spatial-zones.js';
import { isLayerLocked } from '../../annotations/annotatie-lagen.js';
import { getAnnotationBounds } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordBulkModify, registerUndoHandler } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';

function countCatName(categoryId) {
  const t = countTallies().find(c => c.id === categoryId);
  return t ? t.name : (categoryId || '');
}

/**
 * Alle annotaties van het actieve document, verrijkt zoals de engine verwacht.
 * Een staat is een definitie die de hele app deelt; de cijfers komen altijd
 * uit het document dat op dat moment actief is.
 */
function collectElements(config = {}) {
  const categories = config?.categories || [];
  const doc = getActiveDocument();
  // Eén doorloop: de schaalbronnen één keer verzamelen, niet per lijn (#491).
  // Dezelfde verrijking als het hoeveelhedenpaneel (staatElementen.js): ook
  // vlakken krijgen hun schaal, anders kwam hun oppervlakte en omtrek in
  // pagina-eenheden in een opgeslagen staat (#982).
  const anns = metSchaalBronnen(() => (doc?.annotations || []).map(a => verrijkVoorStaat(a, countCatName)));
  // Wapening (buigstaat/wapeningsstaat): alleen als de staat erom vraagt.
  const elementen = (categories || []).includes('reinforcement')
    ? [...anns, ...wapeningsElementen(doc?.annotations || [], getTemplate)]
    : anns;
  // De Laag-kolom (#1130): alleen als de staat hem toont, erop filtert of sorteert.
  return scheduleUsesLayer(config) ? metLaagNamen(doc, elementen, standaardLaagNaam()) : elementen;
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

/**
 * Een staat met een eigen config toevoegen (#1130: de MCP-opdracht controleert
 * de config eerst en maakt de staat pas daarna aan, in één keer).
 * @param {{name?: string, templateId?: string|null, config: object}} gegevens
 */
export function addScheduleWithConfig({ name, templateId = null, config }) {
  const item = {
    id: newId(),
    name: name || templateId || 'Schedule',
    templateId: templateId || null,
    config: JSON.parse(JSON.stringify(config || {})),
  };
  setSchedules([...schedules(), item]);
  persist();
  return item;
}

/** Een eerder verwijderde staat terugzetten op zijn oude plek in de lijst. */
export function restoreSchedule(schedule, index) {
  if (!schedule?.id || getScheduleById(schedule.id)) return;
  const lijst = [...schedules()];
  const plek = Number.isInteger(index) ? Math.max(0, Math.min(index, lijst.length)) : lijst.length;
  lijst.splice(plek, 0, JSON.parse(JSON.stringify(schedule)));
  setSchedules(lijst);
  persist();
}

// Een staat die samen met zijn geplaatste tabellen is verwijderd (#1130) komt
// met dezelfde ongedaan-stap terug als die tabellen, en gaat bij opnieuw weer
// weg. De staat zelf hoort bij de app, niet bij het document: de stap staat in
// de geschiedenis van het document waar de tabellen stonden.
registerUndoHandler('removeSchedule', {
  undo: (cmd) => restoreSchedule(cmd.schedule, cmd.index),
  redo: (cmd) => removeSchedule(cmd.schedule?.id),
});

export function getScheduleById(id) {
  return schedules().find(s => s.id === id) || null;
}

/** Bouw het (reactieve) engine-resultaat voor een schedule tegen het actieve doc. */
export function buildResultForSchedule(schedule) {
  if (!schedule) return null;
  // De schedule-config gaat ongewijzigd naar de engine (de werkboek-koppeling
  // vergelijkt hem); de documentschaal is een aparte invoer.
  return buildSchedule(collectElements(schedule.config), schedule.config,
    { documentUnit: documentEenheid(getActiveDocument()) });
}

/**
 * Kenmerken uit een bewerkte staat-CSV terugzetten op de annotaties van het
 * actieve document (#629), als één stap die ongedaan te maken is.
 * @param {{id: string, fields: object}[]} updates  uit readTagUpdates
 * @returns {null | {changed: number, notFound: number, locked: number, unknownCountCategories: string[]}}
 */
export function applyScheduleTagUpdates(updates) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const anns = doc.annotations || [];
  let zones = null;
  const plan = planTagChanges(anns, updates, {
    location: (ann) => {
      zones ??= collectZones(anns);
      return locationFor(ann, zones, getAnnotationBounds(ann))?.path || '';
    },
    countCategoryName: (id) => countCatName(id),
    countCategoryId: (naam) => {
      const t = countTallies().find(c => c.name === naam || c.id === naam);
      return t ? t.id : null;
    },
    isEditable: (ann) => !ann.locked && !ann.readOnly && !isLayerLocked(doc, ann),
  });
  if (plan.changes.length) {
    const originals = plan.changes.map(c => cloneAnnotation(c.ann));
    const nu = new Date().toISOString();
    for (const c of plan.changes) {
      applyTagChange(c.ann, c.set);
      c.ann.modifiedAt = nu;
    }
    recordBulkModify(plan.changes.map(c => c.ann), originals);
    if (doc.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations();
  }
  return {
    changed: plan.changes.length,
    notFound: plan.notFound.length,
    locked: plan.locked.length,
    unknownCountCategories: plan.unknownCountCategories,
  };
}

export { schedules, setSchedules, STANDARD_SCHEDULE_TEMPLATES };
