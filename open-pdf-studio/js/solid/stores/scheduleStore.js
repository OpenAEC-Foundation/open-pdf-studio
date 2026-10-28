import { createSignal, createMemo } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { formatMeasurement } from '../../annotations/measurement.js';
import { savePreferences } from '../../core/preferences.js';

// --- State ---
const [scheduleVisible, setScheduleVisible] = createSignal(false);
const [groupBy, setGroupBy] = createSignal('type'); // 'type' | 'page' | 'label'
const [filterType, setFilterType] = createSignal('all'); // 'all' | 'measureDistance' | 'measureArea' | 'measurePerimeter' | 'measureAngle'
const [filterPage, setFilterPage] = createSignal(0); // 0 = all pages
const [searchLabel, setSearchLabel] = createSignal('');

// --- Collect all measurement annotations from the active document ---
const measurementTypes = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);

function collectMeasurements() {
  const doc = getActiveDocument();
  if (!doc || !doc.annotations) return [];
  return doc.annotations.filter(a => measurementTypes.has(a.type));
}

// --- Filtered + grouped entries ---
const scheduleEntries = createMemo(() => {
  const measurements = collectMeasurements();
  const ft = filterType();
  const fp = filterPage();
  const sl = searchLabel().toLowerCase();

  let filtered = measurements;

  if (ft !== 'all') {
    filtered = filtered.filter(a => a.type === ft);
  }
  if (fp > 0) {
    filtered = filtered.filter(a => a.page === fp);
  }
  if (sl) {
    filtered = filtered.filter(a =>
      (a.label || '').toLowerCase().includes(sl) ||
      (a.measureText || '').toLowerCase().includes(sl)
    );
  }

  return filtered.map(a => ({
    id: a.id,
    type: a.type,
    typeName: getTypeName(a.type),
    label: a.label || '',
    subject: a.subject || '',
    value: a.measureValue || 0,
    unit: getDefaultUnit(a),
    text: a.measureText || '-',
    page: a.page || 1,
    color: a.color || a.strokeColor || '#000',
    annotation: a,
  }));
});

function getDefaultUnit(a) {
  if (a.measureUnit && a.measureUnit !== 'px') return a.measureUnit;
  if (a.unit) return a.unit;
  if (a.type === 'measureAngle') return '°';
  // Extract unit from measureText (e.g., "2681 mm" → "mm", "15.60 m²" → "m²")
  if (a.measureText) {
    // Komma, punt en (vaste) spaties horen bij het getal ("15,60 m²", #629).
    const match = a.measureText.match(/\d[\d.,\u00a0\u202f]*\s*([^\d\s.,].*)$/);
    if (match && match[1].trim()) return match[1].trim();
  }
  return 'px';
}

function getTypeName(type) {
  switch (type) {
    case 'measureDistance': return 'Distance';
    case 'measureArea': return 'Area';
    case 'measurePerimeter': return 'Perimeter';
    case 'measureAngle': return 'Angle';
    default: return type;
  }
}

// --- Grouped entries ---
const groupedEntries = createMemo(() => {
  const entries = scheduleEntries();
  const gb = groupBy();
  const groups = new Map();

  for (const entry of entries) {
    let key;
    switch (gb) {
      case 'type': key = entry.typeName; break;
      case 'page': key = `Page ${entry.page}`; break;
      case 'label': key = entry.label || '(No label)'; break;
      default: key = entry.typeName;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  return [...groups.entries()].map(([name, items]) => ({
    name,
    items,
    total: items.reduce((sum, i) => sum + i.value, 0),
    unit: items[0]?.unit || '',
  }));
});

// --- Templates ---
function getTemplates() {
  return state.preferences.scheduleTemplates || [];
}

function saveTemplate(name) {
  const template = {
    name,
    groupBy: groupBy(),
    filterType: filterType(),
    filterPage: filterPage(),
    created: Date.now(),
  };
  const templates = [...getTemplates().filter(t => t.name !== name), template];
  state.preferences.scheduleTemplates = templates;
  savePreferences();
}

function loadTemplate(name) {
  const template = getTemplates().find(t => t.name === name);
  if (!template) return;
  setGroupBy(template.groupBy || 'type');
  setFilterType(template.filterType || 'all');
  setFilterPage(template.filterPage || 0);
}

function deleteTemplate(name) {
  state.preferences.scheduleTemplates = getTemplates().filter(t => t.name !== name);
  savePreferences();
}

// --- Export to CSV ---
function exportCSV() {
  const entries = scheduleEntries();
  const header = 'Type,Label,Value,Unit,Page\n';
  const rows = entries.map(e =>
    `${e.typeName},"${e.label}",${e.value},${e.unit},${e.page}`
  ).join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schedule.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// --- Alle geplaatste elementen, geteld per type (heel het document) ---
const ELEMENT_TYPE_NAMES = {
  line: 'Lijn', arrow: 'Pijl', wall: 'Wand', box: 'Rechthoek', mask: 'Maskeer',
  redaction: 'Redactie', circle: 'Cirkel', ellipse: 'Ellips', highlight: 'Markering',
  cloud: 'Wolk', polygon: 'Polygoon', polyline: 'Polylijn', cloudPolyline: 'Wolk-polylijn',
  spline: 'Spline', arc: 'Boog', draw: 'Pen', filledArea: 'Gevuld vlak',
  textbox: 'Tekstvak', callout: 'Tekstballon', comment: 'Notitie', text: 'Tekst',
  stamp: 'Stempel', signature: 'Handtekening', image: 'Afbeelding',
  parametricSymbol: 'Symbool', count: 'Telmarkering',
  measureDistance: 'Afstand', measureArea: 'Oppervlakte', measurePerimeter: 'Omtrek',
  measureAngle: 'Hoek', scaleRegion: 'Schaalgebied', viewport: 'Viewport', scheduleTable: 'Hoeveelheden-tabel',
};

/** Telt élke geplaatste annotatie, gegroepeerd per type (aflopend op aantal). */
export const allElementsTally = createMemo(() => {
  const doc = getActiveDocument();
  const byType = new Map();
  for (const a of (doc?.annotations || [])) byType.set(a.type, (byType.get(a.type) || 0) + 1);
  return [...byType.entries()]
    .map(([type, count]) => ({ type, name: ELEMENT_TYPE_NAMES[type] || type, count }))
    .sort((a, b) => b.count - a.count);
});

export const allElementsTotal = createMemo(() => (getActiveDocument()?.annotations || []).length);

export function toggleSchedule() {
  setScheduleVisible(!scheduleVisible());
}

export {
  scheduleVisible, setScheduleVisible,
  groupBy, setGroupBy,
  filterType, setFilterType,
  filterPage, setFilterPage,
  searchLabel, setSearchLabel,
  scheduleEntries, groupedEntries,
  saveTemplate, loadTemplate, deleteTemplate, getTemplates,
  exportCSV,
};
