import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { markDocumentModified } from '../../ui/chrome/tabs.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { openDialog } from '../../solid/stores/dialogStore.js';
import { setTree, setCountText, setEmptyMessage, setSelectedId, setToolbarDisabled } from '../../solid/stores/panels/bookmarksStore.js';

let selectedBookmarkId = null;

// Initialize bookmarks - no-op, kept for callers
export function initBookmarks() {
  return;
}

// Load bookmarks from PDF outline
export async function loadBookmarksFromPdf(pdfDoc) {
  if (!pdfDoc) return [];
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) return [];
    const bookmarks = [];
    let nextId = 1;
    async function processItems(items, parentId) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = 'bm_' + (nextId++);
        let page = 1;
        let top = null;
        let left = null;

        // Resolve destination
        if (item.dest) {
          try {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await pdfDoc.getDestination(dest);
            }
            if (dest && Array.isArray(dest)) {
              const pageRef = dest[0];
              const pageIndex = await pdfDoc.getPageIndex(pageRef);
              page = pageIndex + 1;
              if (dest.length > 2) left = dest[2];
              if (dest.length > 3) top = dest[3];
            }
          } catch (e) {
            // Failed to resolve dest - use page 1
          }
        }

        const bm = {
          id,
          title: item.title || 'Untitled',
          page,
          top,
          left,
          zoom: null,
          parentId,
          expanded: true,
          bold: !!(item.bold),
          italic: !!(item.italic),
          color: item.color ? rgbArrayToHex(item.color) : null,
          sortOrder: i,
          fromPdf: true,
        };
        bookmarks.push(bm);

        if (item.items && item.items.length > 0) {
          await processItems(item.items, id);
        }
      }
    }
    await processItems(outline, null);
    return bookmarks;
  } catch (e) {
    console.warn('Failed to load bookmarks:', e);
    return [];
  }
}

function rgbArrayToHex(arr) {
  if (!arr || arr.length < 3) return null;
  const r = Math.round(arr[0] * 255);
  const g = Math.round(arr[1] * 255);
  const b = Math.round(arr[2] * 255);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

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
  if (!doc) {
    setTree([]);
    setCountText('0 bookmarks');
    setEmptyMessage('No document open');
    setSelectedId(null);
    updateToolbarState();
    return;
  }

  const bookmarks = doc.bookmarks || [];
  if (bookmarks.length === 0) {
    setTree([]);
    setCountText('0 bookmarks');
    setEmptyMessage('No bookmarks in this document');
    updateToolbarState();
    return;
  }

  const tree = buildTree(bookmarks);
  const componentTree = toComponentTree(tree);

  setTree(componentTree);
  setCountText(`${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}`);
  setEmptyMessage(null);
  updateToolbarState();
}

// Update toolbar button enabled state by pushing to store
function updateToolbarState() {
  const doc = getActiveDocument();
  const hasDoc = !!doc?.pdfDoc;
  const hasSelection = selectedBookmarkId !== null;
  const readOnly = isPdfAReadOnly();

  setToolbarDisabled({
    add: !hasDoc || readOnly,
    addChild: !hasDoc || !hasSelection || readOnly,
    edit: !hasDoc || !hasSelection || readOnly,
    delete: !hasDoc || !hasSelection || readOnly,
  });
}

// Generate unique id
function generateId() {
  return 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// Select a bookmark and navigate
export function selectBookmark(id) {
  selectedBookmarkId = id;
  setSelectedId(id);
  updateToolbarState();
  // Navigate
  const doc = getActiveDocument();
  if (doc && doc.bookmarks) {
    const bm = doc.bookmarks.find(b => b.id === id);
    if (bm) navigateToBookmark(bm);
  }
}

// Clear bookmark selection
export function clearBookmarkSelection() {
  selectedBookmarkId = null;
  setSelectedId(null);
  updateToolbarState();
}

function navigateToBookmark(bm) {
  if (!bm || !state.pdfDoc) return;
  goToPage(bm.page);
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

  const result = await showBookmarkDialog('Add Bookmark', '', state.currentPage);
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
    bold: false,
    italic: false,
    color: null,
    sortOrder: doc.bookmarks.filter(b => b.parentId === null).length,
    fromPdf: false,
  };

  doc.bookmarks.push(bm);
  selectedBookmarkId = bm.id;
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

  const result = await showBookmarkDialog('Add Child Bookmark', '', state.currentPage);
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
    bold: false,
    italic: false,
    color: null,
    sortOrder: siblings.length,
    fromPdf: false,
  };

  // Ensure parent is expanded
  const parent = doc.bookmarks.find(b => b.id === selectedBookmarkId);
  if (parent) parent.expanded = true;

  doc.bookmarks.push(bm);
  selectedBookmarkId = bm.id;
  markDocumentModified();

  const { recordAddBookmark } = await import('../../core/undo-manager.js');
  recordAddBookmark(bm);

  updateBookmarksList();
}

// Edit selected bookmark
export async function editBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  if (!doc || !selectedBookmarkId) return;

  const bm = doc.bookmarks.find(b => b.id === selectedBookmarkId);
  if (!bm) return;

  const result = await showBookmarkDialog('Edit Bookmark', bm.title, bm.page);
  if (!result) return;

  const oldState = { ...bm };
  bm.title = result.title;
  bm.page = result.page;
  markDocumentModified();

  const { recordModifyBookmark } = await import('../../core/undo-manager.js');
  recordModifyBookmark(bm.id, oldState, { ...bm });

  updateBookmarksList();
}

// Delete selected bookmark
export async function deleteBookmark() {
  if (isPdfAReadOnly()) return;
  const doc = getActiveDocument();
  if (!doc || !selectedBookmarkId) return;

  const bm = doc.bookmarks.find(b => b.id === selectedBookmarkId);
  if (!bm) return;

  // Check if bookmark has children
  const children = getDescendants(doc.bookmarks, bm.id);

  if (children.length > 0) {
    // Confirm with user
    let confirmed = false;
    if (window.__TAURI__?.dialog?.ask) {
      confirmed = await window.__TAURI__.dialog.ask(
        `Delete "${bm.title}" and its ${children.length} child bookmark${children.length !== 1 ? 's' : ''}?`,
        { title: 'Delete Bookmark', kind: 'warning' }
      );
    } else {
      confirmed = confirm(`Delete "${bm.title}" and its ${children.length} child bookmark(s)?`);
    }
    if (!confirmed) return;
  }

  // Collect all IDs to remove (bookmark + descendants)
  const idsToRemove = new Set([bm.id, ...children.map(c => c.id)]);
  const removedBookmarks = doc.bookmarks.filter(b => idsToRemove.has(b.id));

  doc.bookmarks = doc.bookmarks.filter(b => !idsToRemove.has(b.id));
  selectedBookmarkId = null;
  markDocumentModified();

  const { recordRemoveBookmark } = await import('../../core/undo-manager.js');
  recordRemoveBookmark(removedBookmarks);

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

function showBookmarkDialog(dialogTitle, currentTitle, currentPage) {
  return new Promise((resolve) => {
    const isEdit = dialogTitle.toLowerCase().includes('edit');
    openDialog('bookmark', {
      title: currentTitle,
      page: currentPage,
      isEdit,
      onOk: resolve,
    });
  });
}

