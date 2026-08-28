import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 annotations');
const [emptyMessage, setEmptyMessage] = createSignal('');
const [sortMode, setSortMode] = createSignal('page');
const [filterMode, setFilterMode] = createSignal('all');
// Review-statussen (kleine letters: none/accepted/cancelled/completed/rejected)
// die de gebruiker via Tonen > Status heeft verborgen. Leeg = alles zichtbaar.
const [hiddenStatuses, setHiddenStatuses] = createSignal(new Set());
const [collapsedGroups, setCollapsedGroups] = createSignal(new Set());

// Afgeleide zichtbaarheid van het statusfilter — de ENIGE rekenplek, zodat
// lijst (annotations-list.js) en canvas (rendering/hit-test via
// annotations/view-filters.js) gegarandeerd dezelfde uitkomst zien (#333).
// Hoofdletter-ongevoelig ('Accepted' == 'accepted'); geen status telt als
// 'none'.
function isStatusHidden(ann) {
  const hidden = hiddenStatuses();
  if (hidden.size === 0) return false;
  return hidden.has(String((ann && ann.status) || 'none').toLowerCase());
}

function toggleHiddenStatus(statusKey) {
  setHiddenStatuses(prev => {
    const next = new Set(prev);
    if (next.has(statusKey)) next.delete(statusKey);
    else next.add(statusKey);
    return next;
  });
  // Canvas volgt het statusfilter (#333): laat een selectie die zojuist
  // onzichtbaar werd los (onzichtbaar = niet klik- of sleepbaar, dus ook
  // niet geselecteerd) en herteken de actieve weergave. Lazy imports om
  // laad-cycli met rendering.js/state.js te vermijden — zelfde patroon als
  // elementVisibilityStore.redraw().
  Promise.all([
    import('../../../core/state.js'),
    import('../../../annotations/rendering.js'),
  ]).then(([{ getActiveDocument }, m]) => {
    const doc = getActiveDocument();
    if (!doc) return;
    const prevSel = doc.selectedAnnotations || [];
    const sel = prevSel.filter(a => !isStatusHidden(a));
    if (sel.length !== prevSel.length) {
      doc.selectedAnnotations = sel;
      if (doc.selectedAnnotation && isStatusHidden(doc.selectedAnnotation)) {
        doc.selectedAnnotation = sel.length > 0 ? sel[sel.length - 1] : null;
      }
    }
    if (doc.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => { /* renderer nog niet geladen */ });
}

function toggleGroup(groupKey) {
  setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
    return next;
  });
}

function expandAllGroups() {
  setCollapsedGroups(new Set());
}

function collapseAllGroups(allKeys) {
  setCollapsedGroups(new Set(allKeys));
}

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  sortMode, setSortMode,
  filterMode, setFilterMode,
  hiddenStatuses, toggleHiddenStatus, isStatusHidden,
  collapsedGroups, toggleGroup, expandAllGroups, collapseAllGroups,
};
