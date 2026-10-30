import i18next from '../../i18n/config.js';
import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { markDocumentModified } from '../../ui/chrome/tabs.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { ingeklapteVoorouders } from './bladwijzer-zoeken.js';
import { loadBookmarksFromPdf } from '../../pdf/bladwijzers-lezen.js';
import { zetBladwijzerStijl, stijlVanSelectie } from './bladwijzer-stijl.js';
import {
  selectieBereik, verplaatsBladwijzers, springIn, springUit, nestOnderNieuw, verwijderBladwijzers, topSelectie,
} from './bladwijzer-boom.js';
import {
  openDialog, setBookmarkTree as setTree, setBookmarkCountText as setCountText,
  setBookmarkEmptyMessage as setEmptyMessage, setBookmarkSelectedId as setSelectedId,
  setBookmarkSelectedIds as setSelectedIds, setBookmarkToolbarDisabled as setToolbarDisabled,
} from '../../bridge.js';

// Selectie (#690): de laatst aangeklikte (bewerken, subbladwijzer) en alle
// geselecteerde (Ctrl/Shift+klik). Het anker is het beginpunt van Shift+klik.
let selectedBookmarkId = null;
let selectedBookmarkIds = [];
let selectieAnker = null;
// De selectie hoort bij één document: de ids beginnen per document opnieuw.
let selectieDocId = null;

function zetSelectie(ids, primair = ids[ids.length - 1] ?? null, anker = primair) {
  selectedBookmarkIds = [...new Set(ids)];
  selectedBookmarkId = primair;
  selectieAnker = anker;
  selectieDocId = getActiveDocument()?.id ?? null;
  setSelectedIds(selectedBookmarkIds);
  setSelectedId(primair);
  updateToolbarState();
}

// Initialize bookmarks - no-op, kept for callers
export function initBookmarks() {
  return;
}

// Load bookmarks from PDF outline (pure; bladwijzers-lezen.js, ook onder node te testen)
export { loadBookmarksFromPdf };

// Build tree from flat array
function buildTree(bookmarks) {
  const map = {};
  const roots = [];
  for (const bm of bookmarks) {
    map[bm.id] = { ...bm, children: [] };
  }
  for (const bm of bookmarks) {
    const node = map[bm.id];
    if (bm.parentId && map[bm.parentId]) {
      map[bm.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort children by sortOrder
  function sortChildren(nodes) {
    nodes.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children);
    }
  }
  sortChildren(roots);
  return roots;
}

// Convert tree nodes to component format (add hasChildren flag recursively)
function toComponentTree(nodes) {
  return nodes.map(node => ({
    id: node.id,
    title: node.title,
    page: node.page,
    bold: node.bold,
    italic: node.italic,
    color: node.color,
    expanded: node.expanded,
    hasChildren: node.children.length > 0,
    children: toComponentTree(node.children),
  }));
}

// Update the bookmarks list display by pushing to the store
export function updateBookmarksList() {
  const doc = getActiveDocument();
  // Ander document, of geselecteerde bladwijzers bestaan niet meer: bijwerken.
  const docId = doc?.id ?? null;
  if (docId !== selectieDocId) {
    zetSelectie([]);
  } else if (selectedBookmarkIds.length > 0) {
    const bestaat = new Set((doc?.bookmarks || []).map(b => b.id));
    const over = selectedBookmarkIds.filter(id => bestaat.has(id));
    if (over.length !== selectedBookmarkIds.length) {
      zetSelectie(over, bestaat.has(selectedBookmarkId) ? selectedBookmarkId : (over[over.length - 1] ?? null));
    }
  }
  if (!doc) {
    setTree([]);
    setCountText(i18next.t('leftPanel.bookmarksCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    setSelectedId(null);
    updateToolbarState();
    return;
  }

  const bookmarks = doc.bookmarks || [];
  if (bookmarks.length === 0) {
    setTree([]);
    setCountText(i18next.t('leftPanel.bookmarksCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noBookmarks'));
    updateToolbarState();
    return;
  }

  const tree = buildTree(bookmarks);
  const componentTree = toComponentTree(tree);

  setTree(componentTree);
  setCountText(i18next.t('leftPanel.bookmarksCount', { count: bookmarks.length }));
  setEmptyMessage(null);
  updateToolbarState();
}

// Update toolbar button enabled state by pushing to store
function updateToolbarState() {
  const doc = getActiveDocument();
  const hasDoc = !!doc?.pdfDoc;
  const aantal = selectedBookmarkIds.length;
  const readOnly = isPdfAReadOnly();

  // Bewerken en subbladwijzer werken op één bladwijzer; verwijderen, stijl
  // en verplaatsen op de hele selectie.
  setToolbarDisabled({
    add: !hasDoc || readOnly,
    addChild: !hasDoc || aantal !== 1 || readOnly,
    edit: !hasDoc || aantal !== 1 || readOnly,
    delete: !hasDoc || aantal === 0 || readOnly,
    style: !hasDoc || aantal === 0 || readOnly,
  });
}

// Generate unique id
function generateId() {
  return 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// Select a bookmark and navigate
export function selectBookmark(id) {
  zetSelectie([id], id);
  // Navigate
  const doc = getActiveDocument();
  if (doc && doc.bookmarks) {
    const bm = doc.bookmarks.find(b => b.id === id);
    if (bm) navigateToBookmark(bm);
  }
}

// Clear bookmark selection
export function clearBookmarkSelection() {
  zetSelectie([]);
}

// Ctrl+klik: toevoegen aan of weghalen uit de selectie, zonder te navigeren.
export function toggleBookmarkSelection(id) {
  if (selectedBookmarkIds.includes(id)) {
    const over = selectedBookmarkIds.filter(x => x !== id);
    zetSelectie(over, over[over.length - 1] ?? null, id);
  } else {
    zetSelectie([...selectedBookmarkIds, id], id, id);
  }
}

// Shift+klik: alle zichtbare bladwijzers van het anker tot hier. Met Ctrl
// erbij komt het bereik bij de bestaande selectie.
export function selectBookmarkRange(id, toevoegen = false) {
  const doc = getActiveDocument();
  const bereik = selectieBereik(doc?.bookmarks || [], selectieAnker, id);
  const anker = selectieAnker ?? id;
  zetSelectie(toevoegen ? [...selectedBookmarkIds, ...bereik] : bereik, id, anker);
}

// Rechtsklik: een geselecteerde bladwijzer houdt de selectie (het menu werkt
// op allemaal); een andere wordt de enige selectie, zoals een gewone klik.
export function selectBookmarkForMenu(id) {
  if (selectedBookmarkIds.includes(id)) return;
  selectBookmark(id);
}

function navigateToBookmark(bm) {
  if (!bm || !getActiveDocument()?.pdfDoc) return;
  goToPage(bm.page);
}

// Klap de ouders van een bladwijzer open zodat hij in de boom te zien is
// (zoekveld, #578). Alleen als er iets dicht zat wordt de lijst ververst.
export function revealBookmark(id) {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  const dicht = new Set(ingeklapteVoorouders(doc.bookmarks, id));
  if (dicht.size === 0) return;
  for (const bm of doc.bookmarks) {
    if (dicht.has(bm.id)) bm.expanded = true;
  }
  updateBookmarksList();
}

// Toggle expand/collapse
export function toggleBookmarkExpand(id) {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  const bm = doc.bookmarks.find(b => b.id === id);
  if (!bm) return;
  bm.expanded = !bm.expanded;
  updateBookmarksList();
}

// Expand all
export function expandAll() {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  for (const bm of doc.bookmarks) bm.expanded = true;
  updateBookmarksList();
}

// Collapse all
export function collapseAll() {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  for (const bm of doc.bookmarks) bm.expanded = false;
  updateBookmarksList();
}

// Add bookmark at root
export async function addBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  if (!doc) return;

  const result = await showBookmarkDialog('Add Bookmark', '', doc.currentPage);
  if (!result) return;

  if (!doc.bookmarks) doc.bookmarks = [];

  const bm = {
    id: generateId(),
    title: result.title,
    page: result.page,
    top: null,
    left: null,
    zoom: null,
    parentId: null,
    expanded: true,
    bold: !!result.bold,
    italic: !!result.italic,
    color: result.color || null,
    sortOrder: doc.bookmarks.filter(b => b.parentId === null).length,
    fromPdf: false,
  };

  doc.bookmarks.push(bm);
  zetSelectie([bm.id]);
  markDocumentModified();

  // Record undo
  const { recordAddBookmark } = await import('../../core/undo-manager.js');
  recordAddBookmark(bm);

  updateBookmarksList();
}

// Add child bookmark under selected
export async function addChildBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  if (!doc || !selectedBookmarkId) return;

  const result = await showBookmarkDialog('Add Child Bookmark', '', doc.currentPage);
  if (!result) return;

  if (!doc.bookmarks) doc.bookmarks = [];

  const siblings = doc.bookmarks.filter(b => b.parentId === selectedBookmarkId);

  const bm = {
    id: generateId(),
    title: result.title,
    page: result.page,
    top: null,
    left: null,
    zoom: null,
    parentId: selectedBookmarkId,
    expanded: true,
    bold: !!result.bold,
    italic: !!result.italic,
    color: result.color || null,
    sortOrder: siblings.length,
    fromPdf: false,
  };

  // Ensure parent is expanded
  const parent = doc.bookmarks.find(b => b.id === selectedBookmarkId);
  if (parent) parent.expanded = true;

  doc.bookmarks.push(bm);
  zetSelectie([bm.id]);
  markDocumentModified();

  const { recordAddBookmark } = await import('../../core/undo-manager.js');
  recordAddBookmark(bm);

  updateBookmarksList();
}

// Inline rename captures the document and original title before editing. Recheck
// after loading undo support: tab switches and external edits must not be lost.
export async function renameBookmarkTitle(doc, id, value, originalTitle) {
  const title = String(value ?? '').trim();
  if (!title || title === originalTitle) return false;
  const { recordModifyBookmark } = await import('../../core/undo-manager.js');
  if (getActiveDocument() !== doc || isPdfAReadOnly()) return false;
  const bm = doc?.bookmarks?.find(b => b.id === id);
  if (!bm || bm.title !== originalTitle) return false;
  const oldState = { ...bm };
  bm.title = title;
  recordModifyBookmark(id, oldState, { ...bm });
  markDocumentModified(doc);
  updateBookmarksList();
  return true;
}

// Edit selected bookmark
export async function editBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  if (!doc || !selectedBookmarkId) return;

  const bm = doc.bookmarks.find(b => b.id === selectedBookmarkId);
  if (!bm) return;

  const result = await showBookmarkDialog('Edit Bookmark', bm.title, bm.page,
    { color: bm.color || null, bold: !!bm.bold, italic: !!bm.italic });
  if (!result) return;

  const oldState = { ...bm };
  bm.title = result.title;
  bm.page = result.page;
  bm.color = result.color || null;
  bm.bold = !!result.bold;
  bm.italic = !!result.italic;
  markDocumentModified();

  const { recordModifyBookmark } = await import('../../core/undo-manager.js');
  recordModifyBookmark(bm.id, oldState, { ...bm });

  updateBookmarksList();
}

// Bevestiging met de dialoog van het systeem (zoals overal in de app).
async function bevestig(tekst, titel) {
  if (window.__TAURI__?.dialog?.ask) {
    return window.__TAURI__.dialog.ask(tekst, { title: titel, kind: 'warning' });
  }
  return confirm(tekst);
}

// Delete the selected bookmark(s) with everything under them: one undo step.
export async function deleteBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  const ids = getSelectedBookmarkIds();
  if (!doc || ids.length === 0) return;

  const { bookmarks, verwijderd, aantalGeselecteerd } = verwijderBladwijzers(doc.bookmarks, ids);
  if (verwijderd.length === 0) return;

  if (aantalGeselecteerd > 1) {
    // Meerdere: één bevestiging voor allemaal.
    const ok = await bevestig(
      i18next.t('bookmark.deleteConfirm', { ns: 'dialogs', count: aantalGeselecteerd }),
      i18next.t('bookmark.deleteTitle', { ns: 'dialogs' }));
    if (!ok) return;
  } else {
    const bm = doc.bookmarks.find(b => b.id === topSelectie(doc.bookmarks, ids)[0]);
    const children = getDescendants(doc.bookmarks, bm.id);
    if (children.length > 0) {
      const ok = await bevestig(
        `Delete "${bm.title}" and its ${children.length} child bookmark${children.length !== 1 ? 's' : ''}?`,
        'Delete Bookmark');
      if (!ok) return;
    }
  }

  doc.bookmarks = bookmarks;
  zetSelectie([]);
  markDocumentModified();

  const { recordRemoveBookmark } = await import('../../core/undo-manager.js');
  recordRemoveBookmark(verwijderd);

  updateBookmarksList();
}

// Get all descendants of a bookmark
function getDescendants(bookmarks, parentId) {
  const result = [];
  const directChildren = bookmarks.filter(b => b.parentId === parentId);
  for (const child of directChildren) {
    result.push(child);
    result.push(...getDescendants(bookmarks, child.id));
  }
  return result;
}

function showBookmarkDialog(dialogTitle, currentTitle, currentPage, stijl = {}, modus = null) {
  return new Promise((resolve) => {
    const isEdit = dialogTitle.toLowerCase().includes('edit');
    openDialog('bookmark', {
      title: currentTitle,
      page: currentPage,
      color: stijl.color || null,
      bold: !!stijl.bold,
      italic: !!stijl.italic,
      isEdit,
      modus,
      onOk: resolve,
    });
  });
}

// ── Kleur en vet/cursief (#689) ──────────────────────────────────────────────

// De bladwijzers waarop een keuze uit het menu werkt (stijl, verplaatsen,
// verwijderen): de hele selectie, voor zover ze nog bestaan.
export function getSelectedBookmarkIds() {
  const bestaat = new Set((getActiveDocument()?.bookmarks || []).map(b => b.id));
  return selectedBookmarkIds.filter(id => bestaat.has(id));
}

// Vinkjes voor het menu: vet/cursief als alle geselecteerde het hebben,
// kleur als ze allemaal dezelfde hebben.
export function bookmarkSelectionStyle() {
  const doc = getActiveDocument();
  return stijlVanSelectie(doc?.bookmarks || [], getSelectedBookmarkIds());
}

// Zet kleur en/of vet/cursief op de selectie: één undo-stap, document gewijzigd.
// `wijziging`: { color?: '#rrggbb'|null, bold?: boolean, italic?: boolean }.
export async function setBookmarkStyle(wijziging) {
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  const ids = getSelectedBookmarkIds();
  if (!doc || ids.length === 0) return false;
  const oud = (doc.bookmarks || []).map(b => ({ ...b }));
  const { bookmarks, gewijzigd } = zetBladwijzerStijl(oud, ids, wijziging);
  if (!gewijzigd) return false;
  await vervangLijst(doc, oud, bookmarks);
  return true;
}

// Nieuwe bladwijzerlijst in één keer: één toewijzing (het document bewaart
// een kopie), één undo-stap, document gewijzigd.
async function vervangLijst(doc, oud, nieuw) {
  doc.bookmarks = nieuw;
  markDocumentModified();
  const { recordBookmarksChange } = await import('../../core/undo-manager.js');
  recordBookmarksChange(oud, nieuw);
  updateBookmarksList();
}

export function toggleBookmarkBold() {
  return setBookmarkStyle({ bold: !bookmarkSelectionStyle().bold });
}

export function toggleBookmarkItalic() {
  return setBookmarkStyle({ italic: !bookmarkSelectionStyle().italic });
}

// ── Verplaatsen en nesten (#690) ─────────────────────────────────────────────

// Slepen: `ids` vóór/na/op `doelId` ('before' | 'after' | 'inside'), of
// `doelId` null met 'end' (lege ruimte onder de lijst). Geweigerd (in
// zichzelf of een eigen kind) of zonder verschil: er gebeurt niets.
export async function moveBookmarks(ids, doelId, positie) {
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return false;
  const oud = doc.bookmarks.map(b => ({ ...b }));
  const nieuw = verplaatsBladwijzers(oud, ids, doelId, positie);
  if (!nieuw) return false;
  await vervangLijst(doc, oud, nieuw);
  return true;
}

// Inspringen: de selectie wordt kind van de bladwijzer erboven.
export async function indentBookmarks() {
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return false;
  const oud = doc.bookmarks.map(b => ({ ...b }));
  const nieuw = springIn(oud, getSelectedBookmarkIds());
  if (!nieuw) return false;
  await vervangLijst(doc, oud, nieuw);
  return true;
}

// Uitspringen: één niveau omhoog, direct na de vroegere ouder.
export async function outdentBookmarks() {
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return false;
  const oud = doc.bookmarks.map(b => ({ ...b }));
  const nieuw = springUit(oud, getSelectedBookmarkIds());
  if (!nieuw) return false;
  await vervangLijst(doc, oud, nieuw);
  return true;
}

// Nesten onder een nieuwe bladwijzer: vraagt een titel; de nieuwe komt op de
// plaats van de eerste geselecteerde, wijst naar diens pagina, en de selectie
// gaat eronder.
export async function nestBookmarksUnderNew() {
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  const ids = getSelectedBookmarkIds();
  if (!doc || !doc.bookmarks || ids.length === 0) return false;
  const eerste = doc.bookmarks.find(b => b.id === topSelectie(doc.bookmarks, ids)[0]);
  const result = await showBookmarkDialog('Add Bookmark', '', eerste?.page || doc.currentPage, {}, 'nest');
  if (!result) return false;
  const oud = doc.bookmarks.map(b => ({ ...b }));
  const bm = {
    id: generateId(),
    title: result.title,
    page: result.page,
    top: null,
    left: null,
    zoom: null,
    parentId: null,
    expanded: true,
    bold: !!result.bold,
    italic: !!result.italic,
    color: result.color || null,
    sortOrder: 0,
    fromPdf: false,
  };
  const nieuw = nestOnderNieuw(oud, ids, bm);
  if (!nieuw) return false;
  await vervangLijst(doc, oud, nieuw);
  zetSelectie([bm.id]);
  return true;
}
