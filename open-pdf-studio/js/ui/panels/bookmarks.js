import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { markDocumentModified } from '../../ui/chrome/tabs.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';

// DOM elements
const bookmarksContainer = document.getElementById('bookmarks-container');
const bookmarksCount = document.getElementById('bookmarks-count');
const addBtn = document.getElementById('bookmarks-add-btn');
const addChildBtn = document.getElementById('bookmarks-add-child-btn');
const editBtn = document.getElementById('bookmarks-edit-btn');
const deleteBtn = document.getElementById('bookmarks-delete-btn');

let selectedBookmarkId = null;
let contextMenu = null;

// Initialize toolbar button events
export function initBookmarks() {
  if (addBtn) addBtn.addEventListener('click', addBookmark);
  if (addChildBtn) addChildBtn.addEventListener('click', addChildBookmark);
  if (editBtn) editBtn.addEventListener('click', editBookmark);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteBookmark);
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
              // dest[1] is the fit type name (e.g. /XYZ)
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

// Update the bookmarks list display
export function updateBookmarksList() {
  if (!bookmarksContainer) return;
  const doc = getActiveDocument();
  if (!doc) {
    bookmarksContainer.innerHTML = '<div class="bookmarks-empty">No document open</div>';
    if (bookmarksCount) bookmarksCount.textContent = '0 bookmarks';
    updateToolbarState();
    return;
  }

  const bookmarks = doc.bookmarks || [];
  if (bookmarks.length === 0) {
    bookmarksContainer.innerHTML = '<div class="bookmarks-empty">No bookmarks in this document</div>';
    if (bookmarksCount) bookmarksCount.textContent = '0 bookmarks';
    updateToolbarState();
    return;
  }

  const tree = buildTree(bookmarks);
  bookmarksContainer.innerHTML = '';
  renderNodes(bookmarksContainer, tree, 0);

  if (bookmarksCount) {
    bookmarksCount.textContent = `${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}`;
  }
  updateToolbarState();
}

// Render tree nodes recursively
function renderNodes(container, nodes, level) {
  for (const node of nodes) {
    const item = createBookmarkItem(node, level);
    container.appendChild(item);

    if (node.children.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.className = 'bookmark-children' + (node.expanded ? '' : ' collapsed');
      childContainer.dataset.parentId = node.id;
      renderNodes(childContainer, node.children, level + 1);
      container.appendChild(childContainer);
    }
  }
}

// Create a single bookmark item
function createBookmarkItem(node, level) {
  const item = document.createElement('div');
  item.className = 'bookmark-item' + (selectedBookmarkId === node.id ? ' selected' : '');
  item.dataset.bookmarkId = node.id;
  item.style.paddingLeft = (8 + level * 16) + 'px';

  // Arrow (expand/collapse)
  const arrow = document.createElement('span');
  arrow.className = 'bookmark-arrow' + (node.children.length > 0 ? ' has-children' : ' empty');
  if (node.children.length > 0) {
    arrow.textContent = node.expanded ? '\u25BC' : '\u25B6';
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpand(node.id);
    });
  }
  item.appendChild(arrow);

  // Icon
  const icon = document.createElement('span');
  icon.className = 'bookmark-icon';
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  item.appendChild(icon);

  // Title
  const title = document.createElement('span');
  title.className = 'bookmark-title';
  if (node.bold) title.classList.add('bold');
  if (node.italic) title.classList.add('italic');
  if (node.color) title.style.color = node.color;
  title.textContent = node.title;
  title.title = `${node.title} (Page ${node.page})`;
  item.appendChild(title);

  // Click to select and navigate
  item.addEventListener('click', () => {
    selectBookmark(node.id);
  });

  // Double-click to edit
  item.addEventListener('dblclick', () => {
    selectBookmark(node.id);
    editBookmark();
  });

  // Right-click context menu
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectBookmark(node.id);
    showContextMenu(e.clientX, e.clientY);
  });

  return item;
}

// Select a bookmark and navigate
function selectBookmark(id) {
  selectedBookmarkId = id;
  // Update visual selection
  if (bookmarksContainer) {
    bookmarksContainer.querySelectorAll('.bookmark-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.bookmarkId === id);
    });
  }
  updateToolbarState();
  // Navigate
  const doc = getActiveDocument();
  if (doc && doc.bookmarks) {
    const bm = doc.bookmarks.find(b => b.id === id);
    if (bm) navigateToBookmark(bm);
  }
}

function navigateToBookmark(bm) {
  if (!bm || !state.pdfDoc) return;
  goToPage(bm.page);
}

// Toggle expand/collapse
function toggleExpand(id) {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  const bm = doc.bookmarks.find(b => b.id === id);
  if (!bm) return;
  bm.expanded = !bm.expanded;
  updateBookmarksList();
}

// Expand all
function expandAll() {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  for (const bm of doc.bookmarks) bm.expanded = true;
  updateBookmarksList();
}

// Collapse all
function collapseAll() {
  const doc = getActiveDocument();
  if (!doc || !doc.bookmarks) return;
  for (const bm of doc.bookmarks) bm.expanded = false;
  updateBookmarksList();
}

// Update toolbar button enabled state
function updateToolbarState() {
  const doc = getActiveDocument();
  const hasDoc = !!doc?.pdfDoc;
  const hasSelection = selectedBookmarkId !== null;
  const readOnly = isPdfAReadOnly();

  if (addBtn) addBtn.disabled = !hasDoc || readOnly;
  if (addChildBtn) addChildBtn.disabled = !hasDoc || !hasSelection || readOnly;
  if (editBtn) editBtn.disabled = !hasDoc || !hasSelection || readOnly;
  if (deleteBtn) deleteBtn.disabled = !hasDoc || !hasSelection || readOnly;
}

// Generate unique id
function generateId() {
  return 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// Add bookmark at root
async function addBookmark() {
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
async function addChildBookmark() {
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
async function editBookmark() {
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
async function deleteBookmark() {
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

// Show bookmark add/edit dialog
function showBookmarkDialog(dialogTitle, currentTitle, currentPage) {
  return new Promise((resolve) => {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'bookmark-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'bookmark-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'bookmark-dialog-header';
    const headerTitle = document.createElement('span');
    headerTitle.textContent = dialogTitle;
    header.appendChild(headerTitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bookmark-dialog-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
      overlay.remove();
      state.modalDialogOpen = false;
      resolve(null);
    });
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'bookmark-dialog-body';

    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Title:';
    body.appendChild(titleLabel);
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = currentTitle;
    titleInput.placeholder = 'Bookmark title';
    body.appendChild(titleInput);

    const pageLabel = document.createElement('label');
    pageLabel.textContent = 'Page:';
    body.appendChild(pageLabel);
    const pageInput = document.createElement('input');
    pageInput.type = 'number';
    pageInput.value = currentPage;
    pageInput.min = 1;
    if (state.pdfDoc) pageInput.max = state.pdfDoc.numPages;
    body.appendChild(pageInput);

    dialog.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'bookmark-dialog-footer';

    const okBtn = document.createElement('button');
    okBtn.className = 'primary';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }
      let page = parseInt(pageInput.value);
      if (isNaN(page) || page < 1) page = 1;
      if (state.pdfDoc && page > state.pdfDoc.numPages) page = state.pdfDoc.numPages;
      overlay.remove();
      state.modalDialogOpen = false;
      resolve({ title, page });
    });
    footer.appendChild(okBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      state.modalDialogOpen = false;
      resolve(null);
    });
    footer.appendChild(cancelBtn);

    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    state.modalDialogOpen = true;

    // Make dialog draggable
    makeDraggable(dialog, header, overlay);

    // Focus title input
    setTimeout(() => titleInput.focus(), 50);

    // Enter key to submit
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
    pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
  });
}

// Make dialog draggable
function makeDraggable(dialog, handle, overlay) {
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.bookmark-dialog-close')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = overlay.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - offsetX;
    let newY = e.clientY - overlayRect.top - offsetY;

    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    dialog.style.position = 'absolute';
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.margin = '0';
    dialog.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// Context menu
function showContextMenu(x, y) {
  hideContextMenu();

  const doc = getActiveDocument();
  if (!doc) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  contextMenu = menu;

  const hasSelection = selectedBookmarkId !== null;

  const items = [
    { label: 'Add Bookmark', action: addBookmark, disabled: false },
    { label: 'Add Child Bookmark', action: addChildBookmark, disabled: !hasSelection },
    { separator: true },
    { label: 'Edit Bookmark', action: editBookmark, disabled: !hasSelection },
    { label: 'Delete Bookmark', action: deleteBookmark, disabled: !hasSelection },
    { separator: true },
    { label: 'Expand All', action: expandAll, disabled: false },
    { label: 'Collapse All', action: collapseAll, disabled: false },
  ];

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.disabled ? ' disabled' : '');
    const labelEl = document.createElement('span');
    labelEl.className = 'context-menu-label';
    labelEl.textContent = item.label;
    el.appendChild(labelEl);
    if (!item.disabled) {
      el.addEventListener('click', () => {
        hideContextMenu();
        item.action();
      });
    }
    menu.appendChild(el);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = 'block';
  document.body.appendChild(menu);

  // Ensure menu stays in viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }

  // Close on click outside or Escape
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      hideContextMenu();
      document.removeEventListener('click', closeHandler);
    }
  };
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      document.removeEventListener('keydown', escHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

// Also handle right-click on the empty container area
if (bookmarksContainer) {
  bookmarksContainer.addEventListener('contextmenu', (e) => {
    // Only if not clicking on a bookmark item
    if (!e.target.closest('.bookmark-item')) {
      e.preventDefault();
      selectedBookmarkId = null;
      updateToolbarState();
      if (bookmarksContainer) {
        bookmarksContainer.querySelectorAll('.bookmark-item').forEach(el => {
          el.classList.remove('selected');
        });
      }
      showContextMenu(e.clientX, e.clientY);
    }
  });
}
