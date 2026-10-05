import { state, getActiveDocument, isSelected, getAnnotationBounds, addToSelection, removeFromSelection } from '../../core/state.js';
import { getTypeDisplayName, getAnnotationDisplayName, createDateFormatter } from '../../utils/helpers.js';
import {
  withoutFoldedChildren, listPreview, expandCorrectionGroups, replaceParentOf,
} from '../../annotations/corrections/model.js';
import { showProperties, showMultiSelectionProperties } from './properties-panel.js';
import { goToPage } from '../../pdf/renderer.js';
import { viewport, markAnchored } from '../../pdf/pdf-viewport.js';
import { stopAlleWielScrollers } from '../../pdf/wiel-scroll.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { paginaNaarWeergave } from '../../pdf/weergave-ruimte.js';
import { switchLeftPanelTab } from './left-panel.js';
import {
  leftPanelCollapsed, leftPanelActiveTab as activeTab,
  setAnnotationItems as setItems, setAnnotationCountText as setCountText,
  setAnnotationEmptyMessage as setEmptyMessage, annotationSortMode as sortMode,
  annotationFilterMode as filterMode, setAnnotationFilterMode as setFilterMode,
  isAnnotationStatusHidden,
  refreshAnnotationLayers,
} from '../../bridge.js';

const statusColors = {
  'accepted': '#22c55e',
  'rejected': '#ef4444',
  'cancelled': '#6b7280',
  'completed': '#3b82f6',
  'reviewed': '#8b5cf6'
};

// Toggle annotations list panel visibility
export function toggleAnnotationsListPanel() {
  const isAnnotationsActive = activeTab() === 'annotations';

  if (isAnnotationsActive && !leftPanelCollapsed()) {
    // Already showing annotations and panel is expanded - switch to thumbnails
    switchLeftPanelTab('thumbnails');
  } else {
    // Switch to annotations tab (also expands if collapsed)
    switchLeftPanelTab('annotations');
  }
}

// Show annotations list panel
export function showAnnotationsListPanel() {
  switchLeftPanelTab('annotations');
}

// Hide annotations list panel
export function hideAnnotationsListPanel() {
  switchLeftPanelTab('thumbnails');
}

// The list is only built while it can be seen (#491). Every full redraw calls
// updateAnnotationsList; with the panel hidden that sorted, grouped and
// formatted every annotation and made the (always mounted) panel recreate all
// its rows, for nothing. A hidden list is marked stale instead and rebuilt as
// soon as it is shown (AnnotationsPanel calls refreshAnnotationsListIfStale).
let listStale = false;

function listVisible() {
  return activeTab() === 'annotations' && !leftPanelCollapsed();
}

/** Rebuild the list if an update came in while it was hidden. */
export function refreshAnnotationsListIfStale() {
  if (listStale && listVisible()) updateAnnotationsList();
}

// The rows of the previous build by key. A row whose content did not change
// is handed back as the same object, so the list component keeps its DOM row
// instead of recreating every row on each update (#491).
let previousItems = new Map();

function sameItem(a, b) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

// Update annotations list - pushes data to the Solid.js store
export function updateAnnotationsList(filterValue) {
  // Houd het "Zichtbaarheid Elementen"-paneel synchroon: dit is de canonieke
  // "annotatie-set gewijzigd"-aanroep (add/delete/doc-wissel), niet per frame.
  import('../../solid/stores/elementVisibilityStore.js')
    .then(m => m.refreshElementTypes())
    .catch(() => { /* store nog niet geladen */ });
  // Het lagenpaneel telt markeringen per laag (#468): zelfde aanleiding.
  refreshAnnotationLayers();

  // Use provided filter or fall back to stored filter mode
  if (filterValue !== undefined) {
    setFilterMode(filterValue);
  }
  if (!listVisible()) {
    listStale = true;
    return;
  }
  listStale = false;
  const activeFilter = filterValue !== undefined ? filterValue : filterMode();

  // Read annotations from the active document directly (bypass proxy getter caching)
  const doc = state.documents[state.activeDocumentIndex];
  const annotations = doc ? doc.annotations : [];

  // Filter annotations
  let filteredAnnotations = [...annotations];

  if (activeFilter === 'current') {
    filteredAnnotations = filteredAnnotations.filter(a => a.page === (doc ? doc.currentPage : 1));
  } else if (activeFilter !== 'all') {
    filteredAnnotations = filteredAnnotations.filter(a => a.type === activeFilter);
  }

  // Statusfilter (Tonen > Status): verberg annotaties waarvan de
  // review-status door de gebruiker is uitgevinkt. De berekening leeft op
  // ÉÉN plek (annotationsStore.isStatusHidden) zodat lijst en canvas (#333)
  // gegarandeerd hetzelfde filteren.
  filteredAnnotations = filteredAnnotations.filter(a => !isAnnotationStatusHidden(a));

  // Proefleescorrecties (#508): de doorhaling van een vervanging staat in de
  // regel van haar invoegteken, met de naam en voorvertoning van de correctie.
  const byId = new Map(annotations.map(a => [a.id, a]));
  filteredAnnotations = withoutFoldedChildren(filteredAnnotations, byId);

  // Update count text
  setCountText(`${filteredAnnotations.length} annotation${filteredAnnotations.length !== 1 ? 's' : ''}`);

  // Sort and group based on current sort mode
  const currentSort = sortMode();

  const pageThenDate = (a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return new Date(a.createdAt) - new Date(b.createdAt);
  };

  if (currentSort === 'type') {
    filteredAnnotations.sort((a, b) => {
      const ta = getTypeDisplayName(a.type);
      const tb = getTypeDisplayName(b.type);
      if (ta !== tb) return ta.localeCompare(tb);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'modifiedDate') {
    filteredAnnotations.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  } else if (currentSort === 'creationDate') {
    filteredAnnotations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (currentSort === 'author') {
    filteredAnnotations.sort((a, b) => {
      const aa = (a.author || 'User').toLowerCase();
      const ab = (b.author || 'User').toLowerCase();
      if (aa !== ab) return aa.localeCompare(ab);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'color') {
    filteredAnnotations.sort((a, b) => {
      const ca = (a.color || a.strokeColor || '#000').toLowerCase();
      const cb = (b.color || b.strokeColor || '#000').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'subject') {
    filteredAnnotations.sort((a, b) => {
      const sa = (a.subject || '').toLowerCase();
      const sb = (b.subject || '').toLowerCase();
      if (sa !== sb) return sa.localeCompare(sb);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'status') {
    filteredAnnotations.sort((a, b) => {
      const sa = (a.status || 'none').toLowerCase();
      const sb = (b.status || 'none').toLowerCase();
      if (sa !== sb) return sa.localeCompare(sb);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'statusAndAuthor') {
    filteredAnnotations.sort((a, b) => {
      const sa = (a.status || 'none').toLowerCase();
      const sb = (b.status || 'none').toLowerCase();
      if (sa !== sb) return sa.localeCompare(sb);
      const aa = (a.author || 'User').toLowerCase();
      const ab = (b.author || 'User').toLowerCase();
      if (aa !== ab) return aa.localeCompare(ab);
      return pageThenDate(a, b);
    });
  } else if (currentSort === 'lastStatusAuthor') {
    const getLastStatusAuthor = (ann) => {
      if (ann.replies && ann.replies.length > 0) {
        for (let i = ann.replies.length - 1; i >= 0; i--) {
          if (ann.replies[i].author) return ann.replies[i].author;
        }
      }
      return ann.author || 'User';
    };
    filteredAnnotations.sort((a, b) => {
      const aa = getLastStatusAuthor(a).toLowerCase();
      const ab = getLastStatusAuthor(b).toLowerCase();
      if (aa !== ab) return aa.localeCompare(ab);
      return pageThenDate(a, b);
    });
  } else {
    // Default: sort by page
    filteredAnnotations.sort(pageThenDate);
  }

  if (filteredAnnotations.length === 0) {
    setEmptyMessage('No annotations found');
    setItems([]);
    return;
  }

  // Clear empty message so the list renders
  setEmptyMessage('');

  // One date formatter and one selection set for the whole list, instead of
  // new locale formatters and a scan of the selection per annotation.
  const formatDate = createDateFormatter();
  const selected = new Set(doc ? doc.selectedAnnotations : []);
  const nextItems = new Map();
  const reuse = (key, item) => {
    if (nextItems.has(key)) return item; // a second row with the same id keeps its own object
    const previous = previousItems.get(key);
    const row = previous && sameItem(previous, item) ? previous : item;
    nextItems.set(key, row);
    return row;
  };

  // Helper to get last status author
  const getLastStatusAuthor = (ann) => {
    if (ann.replies && ann.replies.length > 0) {
      for (let i = ann.replies.length - 1; i >= 0; i--) {
        if (ann.replies[i].author) return ann.replies[i].author;
      }
    }
    return ann.author || 'User';
  };

  // Helper to capitalize status
  const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // Group annotations based on sort mode
  const groups = {};
  filteredAnnotations.forEach(ann => {
    let groupKey;
    if (currentSort === 'type') {
      groupKey = ann.type;
    } else if (currentSort === 'author') {
      groupKey = ann.author || 'User';
    } else if (currentSort === 'modifiedDate') {
      const d = new Date(ann.modifiedAt);
      groupKey = isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString();
    } else if (currentSort === 'creationDate') {
      const d = new Date(ann.createdAt);
      groupKey = isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString();
    } else if (currentSort === 'color') {
      groupKey = ann.color || ann.strokeColor || '#000';
    } else if (currentSort === 'subject') {
      groupKey = ann.subject || '(No Subject)';
    } else if (currentSort === 'status') {
      groupKey = ann.status || 'none';
    } else if (currentSort === 'statusAndAuthor') {
      const s = ann.status || 'none';
      const a = ann.author || 'User';
      groupKey = `${s}|${a}`;
    } else if (currentSort === 'lastStatusAuthor') {
      groupKey = getLastStatusAuthor(ann);
    } else {
      groupKey = ann.page;
    }
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(ann);
  });

  // Build flat items array for the store
  const flatItems = [];
  const groupKeys = Object.keys(groups);

  // Sort group keys
  if (currentSort === 'page') {
    groupKeys.sort((a, b) => a - b);
  } else if (currentSort === 'modifiedDate' || currentSort === 'creationDate') {
    // Keep insertion order (already sorted by date)
  } else {
    groupKeys.sort((a, b) => String(a).localeCompare(String(b)));
  }

  groupKeys.forEach(key => {
    // Header entry
    let headerLabel, headerColor;
    if (currentSort === 'type') {
      headerLabel = getTypeDisplayName(key);
    } else if (currentSort === 'color') {
      headerColor = key;
    } else if (currentSort === 'status') {
      headerLabel = capitalize(key);
    } else if (currentSort === 'statusAndAuthor') {
      const [s, a] = key.split('|');
      headerLabel = `${capitalize(s)} — ${a}`;
    } else if (currentSort === 'page') {
      // page number stored in item.page
    } else {
      headerLabel = key;
    }

    flatItems.push(reuse(`header:${key}`, {
      isHeader: true,
      groupKey: key,
      page: currentSort === 'page' ? parseInt(key) : null,
      headerLabel,
      headerColor,
      sortMode: currentSort
    }));

    // Annotation item entries
    groups[key].forEach(ann => {
      const hasStatus = ann.status && ann.status !== 'none';
      const replyCount = (ann.replies && ann.replies.length) || 0;
      const preview = listPreview(ann, byId) || ann.text;

      flatItems.push(reuse(`annotation:${ann.id}`, {
        isHeader: false,
        groupKey: key,
        id: ann.id,
        page: ann.page,
        type: ann.type,
        typeLabel: getAnnotationDisplayName(ann, byId),
        color: ann.color || ann.strokeColor || '#000',
        text: preview ? preview.substring(0, 50) + (preview.length > 50 ? '...' : '') : null,
        meta: `[${ann.author || 'User'}] - ${formatDate(ann.modifiedAt)}`,
        statusColor: hasStatus ? (statusColors[ann.status] || '#888') : null,
        statusTitle: hasStatus ? capitalize(ann.status) : null,
        replyCount,
        selected: selected.has(ann)
      }));
    });
  });

  previousItems = nextItems;
  setItems(flatItems);
}

// Scroll the pdf-container viewport to center on the given annotation
function scrollToAnnotation(annotation) {
  const bounds = getAnnotationBounds(annotation);
  if (!bounds) return;

  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  const pdfContainer = document.getElementById('pdf-container');
  if (!pdfContainer) return;

  // Het midden zoals het op het scherm ligt: bij een gedraaide weergave (#200)
  // staat het elders dan in de paginaruimte. Viewport en scrollcontainer
  // rekenen in de weergaveruimte.
  const midden = paginaNaarWeergave(annotation.page ?? doc?.currentPage ?? 1,
    bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, doc);
  const centerX = midden.x * scale;
  const centerY = midden.y * scale;

  // Enkelpagina met de vector-viewport (issue #318): daar scrollt de
  // container NIET — het canvas staat vast en pannen/zoomen gebeurt via
  // viewport.offsetX/Y in de RAF-render. `pdfContainer.scrollTo()` verschoof
  // dan het vaste canvas-element zelf, waardoor de hele pagina uit beeld
  // verdween zodra een opmerking buiten het zichtbare deel lag. Centreer in
  // plaats daarvan de viewport op de annotatie.
  if (viewport.active && doc?.viewMode !== 'continuous') {
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const vpW = canvas.width / dpr;   // CSS-px
    const vpH = canvas.height / dpr;
    // De viewport rekent in de weergaveruimte (punten, oorsprong linksboven
    // van de getoonde, eventueel gedraaide pagina).
    const cx = midden.x;
    const cy = midden.y;
    stopAlleWielScrollers();
    viewport.offsetX = vpW / 2 - cx * viewport.zoom;
    viewport.offsetY = vpH / 2 - cy * viewport.zoom;
    // Door de gebruiker (indirect) gepositioneerd → niet automatisch her-fitten.
    markAnchored();
    viewport.dirty = true;
    return;
  }

  if (getActiveDocument()?.viewMode === 'continuous') {
    const pageWrapper = document.querySelector(`.page-wrapper[data-page="${annotation.page}"]`);
    if (!pageWrapper) return;
    const canvasContainer = pageWrapper.querySelector('.canvas-container-cont');
    if (!canvasContainer) return;

    const wrapperOffset = pageWrapper.offsetTop;
    const canvasOffset = canvasContainer.offsetTop;
    const scrollX = centerX - pdfContainer.clientWidth / 2;
    const scrollY = wrapperOffset + canvasOffset + centerY - pdfContainer.clientHeight / 2;
    // Een lopende wieluitloop zou deze vloeiende sprong afbreken (#522).
    stopAlleWielScrollers();
    pdfContainer.scrollTo({ left: Math.max(0, scrollX), top: Math.max(0, scrollY), behavior: 'smooth' });
  } else {
    const scrollX = centerX - pdfContainer.clientWidth / 2;
    const scrollY = centerY - pdfContainer.clientHeight / 2;
    stopAlleWielScrollers();
    pdfContainer.scrollTo({ left: Math.max(0, scrollX), top: Math.max(0, scrollY), behavior: 'smooth' });
  }
}

// Select an annotation item - navigates to its page and selects it
// When ctrlKey is true, toggles the annotation in/out of multi-selection
export async function selectAnnotationItem(id, page, ctrlKey = false) {
  const selDoc = getActiveDocument();
  const annotation = (selDoc?.annotations || []).find(a => a.id === id);
  if (!annotation) return;
  const selDocPage = selDoc ? selDoc.currentPage : 1;
  // Een vervanging (#508) is één regel en één selectie: beide helften.
  const leden = expandCorrectionGroups(selDoc?.annotations, [annotation]);
  if (ctrlKey) {
    if (isSelected(annotation)) {
      for (const lid of leden) removeFromSelection(lid);
    } else {
      if (annotation.page !== selDocPage) {
        await goToPage(annotation.page);
      }
      for (const lid of leden) addToSelection(lid);
    }
  } else {
    if (annotation.page !== selDocPage) {
      await goToPage(annotation.page);
    }
    const _selListDoc = getActiveDocument();
    const ouder = leden.length > 1 ? replaceParentOf(leden, _selListDoc?.annotations) : null;
    if (_selListDoc) { _selListDoc.selectedAnnotation = ouder || annotation; _selListDoc.selectedAnnotations = leden; }
  }

  redrawAnnotations();
  const _listDoc2 = getActiveDocument();
  const _listSel = _listDoc2 ? _listDoc2.selectedAnnotations : [];
  const _listOuder = _listSel.length > 1 ? replaceParentOf(_listSel, _listDoc2?.annotations) : null;
  if (_listOuder) {
    showProperties(_listOuder);
  } else if (_listSel.length > 1) {
    showMultiSelectionProperties();
  } else if (_listDoc2?.selectedAnnotation) {
    showProperties(_listDoc2.selectedAnnotation);
  }
  updateAnnotationsList();

  // Scroll to the annotation when selecting (not when Ctrl+deselecting)
  if (isSelected(annotation)) {
    setTimeout(() => scrollToAnnotation(annotation), 50);
  }
}

// Initialize annotations list panel (no-op, filter is handled by the component)
export function initAnnotationsList() {
}
