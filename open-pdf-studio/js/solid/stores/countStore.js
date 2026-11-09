import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordBulkModify } from '../../core/undo-manager.js';
import {
  telGroepen, telGroepSleutel, hernummerTellingen, volgendTelNummer, telGroepVelden, GEEN_TELGROEP,
  volgendeTelGroepKleur, volgendeTelGroepNaam,
} from '../../annotations/telling.js';
import i18next from '../../i18n/config.js';
import { language } from '../../i18n/useTranslation.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';

// --- Telgroepen (#935; per sessie: presets + vrij toe te voegen) ---
//
// De definities staan hier; elke markering draagt zelf haar groep
// (categoryId) en groepsnaam (categoryName), zodat een opgeslagen bestand
// zijn groepen bij heropenen terugkrijgt (telGroepen leest ze uit de
// markeringen). De pure logica staat in annotations/telling.js.
//
// De standaardgroepen hebben geen vaste naam maar een vertaalsleutel
// (#1004): ze heten in elke taal zoals die taal ze noemt. De ids blijven
// gelijk, zodat markeringen uit eerder opgeslagen bestanden erbij horen.
// Een hernoemde standaardgroep krijgt een eigen naam, die dan voorgaat.
const DEFAULT_CATEGORIES = [
  { id: 'deuren',        nameKey: 'countDefaultDoors',   nameDefault: 'Doors',   color: '#e11d48', markerStyle: 'dot' },
  { id: 'ramen',         nameKey: 'countDefaultWindows', nameDefault: 'Windows', color: '#2563eb', markerStyle: 'dot' },
  { id: 'stopcontacten', nameKey: 'countDefaultSockets', nameDefault: 'Sockets', color: '#16a34a', markerStyle: 'dot' },
];

/** Een tekst uit ribbon.json (drawing.*), met de Engelse tekst als terugval. */
function lintTekst(sleutel, standaard, opties) {
  const tekst = i18next.t(`drawing.${sleutel}`, { ns: 'ribbon', defaultValue: standaard, ...opties });
  return typeof tekst === 'string' && tekst && tekst !== `drawing.${sleutel}` ? tekst : standaard;
}

export { GEEN_TELGROEP };

const [categories, setCategories] = createSignal([...DEFAULT_CATEGORIES]);
const [activeCategoryId, setActiveCategoryId] = createSignal('deuren');

/** De groepsdefinities, met de standaardnamen in de huidige taal. */
export const countCategories = createMemo(() => {
  language(); // opnieuw bij een andere taal
  return categories().map(({ nameKey, nameDefault, ...c }) => (
    c.name ? c : { ...c, name: nameKey ? lintTekst(nameKey, nameDefault) : (nameDefault || c.id) }
  ));
});
export const activeCountCategoryId = activeCategoryId;

/** Reactieve telling per groep, afgeleid van de annotaties van het actieve document. */
export const countTallies = createMemo(() => telGroepen(countCategories(), getActiveDocument()?.annotations || []));

/** De groepen die je kunt kiezen (zonder de rij 'geen groep'). */
export const countGroups = createMemo(() => countTallies().filter(g => g.id !== GEEN_TELGROEP));

export const activeCountCategory = () =>
  countGroups().find(c => c.id === activeCategoryId()) || countGroups()[0] || null;
export function setActiveCountCategory(id) { setActiveCategoryId(id); }

export function addCountCategory(name, color = '#e11d48', markerStyle = 'dot', symbolId) {
  const id = (name || 'cat').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  setCategories([...categories(), { id, name: name || lintTekst('countNewName', 'Count'), color, markerStyle, symbolId }]);
  return id;
}

/**
 * Nieuwe telling met één klik (#1004): een nieuwe groep met een automatische
 * naam ("Telling 4", in de taal van de app) en de volgende kleur uit het
 * palet die nog vrij is, en die groep wordt actief. De nummering begint daar
 * bij 1; de eerdere tellingen houden hun nummers en kleur.
 * @returns {{id: string, name: string, color: string}} de nieuwe groep
 */
export function startNewCount() {
  const groepen = countGroups();
  const name = volgendeTelGroepNaam(groepen, lintTekst('countNewName', 'Count'));
  const color = volgendeTelGroepKleur(groepen);
  const id = addCountCategory(name, color);
  setActiveCategoryId(id);
  updateStatusMessage(lintTekst('countNewStarted', `New count: ${name}`, { name }));
  return { id, name, color };
}

export function updateCountCategory(id, patch) {
  // Een groep uit een geopend bestand heeft nog geen definitie: maak er een.
  if (!categories().some(c => c.id === id)) {
    const uitDoc = countGroups().find(g => g.id === id);
    if (!uitDoc) return;
    const { count: _c, fromDocument: _f, ...def } = uitDoc;
    setCategories([...categories(), { ...def, ...patch }]);
    return;
  }
  setCategories(categories().map(c => c.id === id ? { ...c, ...patch } : c));
}

/** Verwijderen geblokkeerd zolang er markeringen in deze categorie staan. */
export function removeCountCategory(id) {
  const doc = getActiveDocument();
  const inUse = (doc?.annotations || []).some(a => a.type === 'count' && a.categoryId === id);
  if (inUse) return false;
  setCategories(categories().filter(c => c.id !== id));
  if (activeCategoryId() === id) setActiveCategoryId(categories()[0]?.id || '');
  return true;
}

/** Volgnummer voor de volgende markering in een categorie. */
export function nextCountNumber(categoryId) {
  return volgendTelNummer(getActiveDocument()?.annotations || [], categoryId);
}

/**
 * Markeringen in een groep zetten (#935): ze krijgen de groep, haar naam en
 * haar opmaak, en de oude en de nieuwe groep tellen opnieuw. Eén
 * ongedaan-stap. Vergrendelde markeringen blijven staan.
 * @param {object[]} markeringen
 * @param {string} groupId  id van een groep, of GEEN_TELGROEP
 * @returns {number} het aantal markeringen dat van groep wisselde
 */
export function assignCountGroup(markeringen, groupId) {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const groep = groupId === GEEN_TELGROEP ? null : countGroups().find(g => g.id === groupId);
  if (groupId !== GEEN_TELGROEP && !groep) return 0;
  const doel = (markeringen || []).filter(a => a?.type === 'count' && !a.locked);
  if (doel.length === 0) return 0;
  const voor = new Map();
  const groepen = new Set(doel.map(telGroepSleutel));
  groepen.add(groep ? groep.id : '');
  const velden = telGroepVelden(groep);
  const nu = new Date().toISOString();
  for (const a of doel) {
    voor.set(a, cloneAnnotation(a));
    for (const [k, v] of Object.entries(velden)) {
      if (v === undefined) delete a[k];
      else a[k] = v;
    }
    a.modifiedAt = nu;
  }
  for (const w of hernummerTellingen(doc.annotations, groepen)) {
    if (!voor.has(w.ann)) voor.set(w.ann, cloneAnnotation(w.ann));
    w.ann.number = w.number;
  }
  recordBulkModify([...voor.keys()], [...voor.values()]);
  return doel.length;
}

/**
 * Opmaak of naam van een hele groep wijzigen (#935): de definitie en elke
 * markering van de groep in het document, in één ongedaan-stap.
 * @param {string} groupId
 * @param {{name?: string, color?: string}} patch
 */
export function updateCountGroup(groupId, patch) {
  if (!groupId || groupId === GEEN_TELGROEP || !patch) return;
  updateCountCategory(groupId, patch);
  const doc = getActiveDocument();
  const leden = (doc?.annotations || []).filter(a => a.type === 'count' && a.categoryId === groupId && !a.locked);
  if (leden.length === 0) return;
  const voor = leden.map(a => cloneAnnotation(a));
  const nu = new Date().toISOString();
  for (const a of leden) {
    if (patch.color) { a.color = patch.color; a.strokeColor = patch.color; }
    if (patch.name) a.categoryName = patch.name;
    a.modifiedAt = nu;
  }
  recordBulkModify(leden, voor);
}

/** De markeringen van een groep in het actieve document. */
export function countGroupMembers(groupId) {
  const key = groupId === GEEN_TELGROEP ? '' : groupId;
  return (getActiveDocument()?.annotations || []).filter(a => a.type === 'count' && telGroepSleutel(a) === key);
}

export const countTotal = createMemo(() => countTallies().reduce((s, r) => s + r.count, 0));

/** CSV-regels voor de telling (gebruikt door de paneel-export). */
export function countCsvRows() {
  return countTallies().filter(r => r.count > 0).map(r => `Telling,"${r.name}",${r.count},stuks,`);
}
