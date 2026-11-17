// Presentation view: the decisions, without the page (presentatie.js applies them).
//
// Full screen used to make only the window screen-filling: ribbon, tabs,
// panels and status bar stayed and the page kept its zoom. In presentation
// view the page fills the screen, one page at a time, and the arrow keys turn
// the pages.

/** The name setViewMode() takes for the view a document is in now. */
export function weergaveNaam(doc) {
  if (!doc) return 'single';
  if (doc.facingSpread) return 'facing';
  if (doc.bookSpread) return 'book';
  return doc.viewMode === 'continuous' ? 'continuous' : 'single';
}

const TOETSEN = {
  ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next',
  ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev',
  Home: 'first', End: 'last',
};

/**
 * What a key does in presentation view, or null when the key is not ours:
 * with a modifier, while typing, or while a dialog is open.
 */
export function presentatieActie(e, { typend = false, dialoogOpen = false } = {}) {
  if (!e || typend || dialoogOpen) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  return TOETSEN[e.key] || null;
}

/** The page an action leads to, kept inside the document. */
export function doelPagina(actie, huidig, aantal) {
  const n = Math.max(1, aantal | 0);
  const nu = Math.min(n, Math.max(1, huidig | 0));
  if (actie === 'next') return Math.min(n, nu + 1);
  if (actie === 'prev') return Math.max(1, nu - 1);
  if (actie === 'first') return 1;
  if (actie === 'last') return n;
  return nu;
}

/** Whether the focused element takes typed text. */
export function isTypend(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
