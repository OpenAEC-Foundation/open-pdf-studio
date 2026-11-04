import { createOrganizerPointerDrag } from '../../pdf/organizer-pointer-drag.js';
import { dropPositie } from './miniatuur-maat.js';

// Pointer capture retargets events to the container, so hit-test the screen.
export function thumbnailDropAt(list, point) {
  const box = list.getBoundingClientRect();
  if (point.clientX < box.left || point.clientX >= box.right || point.clientY < box.top || point.clientY >= box.bottom) return null;
  const hit = list.ownerDocument.elementFromPoint(point.clientX, point.clientY);
  const row = hit?.closest('.thumbnail-item[data-page]');
  if (!row || !list.contains(row)) return null;
  const columns = list.ownerDocument.defaultView.getComputedStyle(list).gridTemplateColumns || '';
  const naast = columns.trim().split(/\s+/).filter(Boolean).length > 1;
  return { page: Number(row.dataset.page), position: dropPositie(row.getBoundingClientRect(), point.clientX, point.clientY, naast), naast };
}

export function createThumbnailPointerDrag(list, { getDocument, getSelection, canEdit, setDragging, setTarget, commit }) {
  const dom = list.ownerDocument;
  const win = dom.defaultView;
  let source = null;
  let sourcePdf = null;
  let selected = null;
  let point = null;
  let target = null;
  let frame = null;
  const valid = () => source && source === getDocument() && source.pdfDoc === sourcePdf && canEdit();
  function clear() {
    if (frame != null) win.cancelAnimationFrame(frame);
    frame = null; source = null; sourcePdf = null; selected = null; point = null; target = null;
    setDragging(null); setTarget(null);
  }
  function update() {
    const next = valid() ? thumbnailDropAt(list, point) : null;
    target = next && !selected.includes(next.page) ? next : null;
    setTarget(target);
  }
  function scroll() {
    frame = null;
    if (!valid()) { controller.cancel(); return; }
    const box = list.getBoundingClientRect();
    if (point.clientX >= box.left && point.clientX < box.right && point.clientY >= box.top && point.clientY < box.bottom) {
      if (point.clientY < box.top + 24) list.scrollTop -= 8;
      else if (point.clientY > box.bottom - 24) list.scrollTop += 8;
    }
    update();
    frame = win.requestAnimationFrame(scroll);
  }
  const controller = createOrganizerPointerDrag(list, {
    keyAt(el) {
      if (!canEdit() || el.closest?.('button, input, textarea, select, a, [contenteditable]')) return null;
      const row = el.closest?.('.thumbnail-item[data-page]');
      const doc = getDocument();
      if (!row || !list.contains(row) || !doc?.pdfDoc) return null;
      return { page: Number(row.dataset.page), doc, pdf: doc.pdfDoc };
    },
    start(key) {
      source = key.doc; sourcePdf = key.pdf;
      const pages = getSelection();
      selected = pages.includes(key.page) ? [...pages] : [key.page];
      setDragging(key.page);
      list.focus({ preventScroll: true });
    },
    move(event) {
      point = { clientX: event.clientX, clientY: event.clientY };
      update();
      if (frame == null) frame = win.requestAnimationFrame(scroll);
    },
    finish(event) {
      if (!event.cancelled && valid()) { point = event; update(); }
      const drop = !event.cancelled && valid() ? target : null;
      const doc = source; const pdf = sourcePdf; const pages = selected;
      clear();
      if (drop) commit(doc, pdf, pages, drop.page, drop.position === 'before');
    },
  });
  function escape(event) {
    if (event.key !== 'Escape' || !controller.isDragging()) return;
    event.preventDefault(); event.stopPropagation(); controller.cancel();
  }
  dom.addEventListener('keydown', escape, true);
  return {
    cancel: () => controller.cancel(),
    destroy() { controller.destroy(); clear(); dom.removeEventListener('keydown', escape, true); },
  };
}
