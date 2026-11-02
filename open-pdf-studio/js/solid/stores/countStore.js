import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';

// --- Telcategorieën (per sessie; presets + vrij toe te voegen) ---
const DEFAULT_CATEGORIES = [
  { id: 'deuren',        name: 'Deuren',        color: '#e11d48', markerStyle: 'dot' },
  { id: 'ramen',         name: 'Ramen',         color: '#2563eb', markerStyle: 'dot' },
  { id: 'stopcontacten', name: 'Stopcontacten', color: '#16a34a', markerStyle: 'dot' },
];

const [categories, setCategories] = createSignal([...DEFAULT_CATEGORIES]);
const [activeCategoryId, setActiveCategoryId] = createSignal('deuren');

export const countCategories = categories;
export const activeCountCategoryId = activeCategoryId;
export const activeCountCategory = () => categories().find(c => c.id === activeCategoryId()) || categories()[0] || null;
export function setActiveCountCategory(id) { setActiveCategoryId(id); }

export function addCountCategory(name, color = '#e11d48', markerStyle = 'dot', symbolId) {
  const id = (name || 'cat').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  setCategories([...categories(), { id, name: name || 'Categorie', color, markerStyle, symbolId }]);
  return id;
}

export function updateCountCategory(id, patch) {
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

/** Volgnummer voor de volgende markering in een categorie (huidig aantal + 1). */
export function nextCountNumber(categoryId) {
  const doc = getActiveDocument();
  return (doc?.annotations || []).filter(a => a.type === 'count' && a.categoryId === categoryId).length + 1;
}

/** Reactieve telling per categorie, afgeleid van de annotaties van het actieve document. */
export const countTallies = createMemo(() => {
  const doc = getActiveDocument();
  const counts = (doc?.annotations || []).filter(a => a.type === 'count');
  const byCat = new Map();
  for (const a of counts) {
    const k = a.categoryId || '(geen)';
    byCat.set(k, (byCat.get(k) || 0) + 1);
  }
  const rows = categories().map(c => ({ ...c, count: byCat.get(c.id) || 0 }));
  // Een PDF bewaart de categorie-ID, maar de categoriepresets zijn per sessie.
  // Tel ingelezen eigen groepen ook mee; hun ID is de beschikbare naam.
  const knownIds = new Set(rows.map(c => c.id));
  for (const [id, count] of byCat) {
    if (id !== '(geen)' && !knownIds.has(id)) {
      rows.push({ id, name: id, color: '#888888', markerStyle: 'dot', count });
    }
  }
  if (byCat.has('(geen)')) {
    rows.push({ id: '(geen)', name: '(geen categorie)', color: '#888888', markerStyle: 'dot', count: byCat.get('(geen)') });
  }
  return rows;
});

export const countTotal = createMemo(() => countTallies().reduce((s, r) => s + r.count, 0));

/** CSV-regels voor de telling (gebruikt door de paneel-export). */
export function countCsvRows() {
  return countTallies().filter(r => r.count > 0).map(r => `Telling,"${String(r.name).replace(/"/g, '""')}",${r.count},stuks,`);
}
