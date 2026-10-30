import { createOrganizerPointerDrag } from '../../pdf/organizer-pointer-drag.js';
import { dropToegestaan, sleepPositie } from './bladwijzer-boom.js';

// Hit-test against the screen, not event.target: pointer capture keeps the
// latter on the list even while the pointer crosses other rows or panels.
export function bookmarkDropAt(list, point, bookmarks, ids) {
  const rect = list.getBoundingClientRect();
  if (point.clientX < rect.left || point.clientX >= rect.right || point.clientY < rect.top || point.clientY >= rect.bottom) return null;
  const hit = list.ownerDocument.elementFromPoint(point.clientX, point.clientY);
  if (!hit || !list.contains(hit)) return null;
  const row = hit.closest('[data-bm-id]');
  if (!row) return hit === list ? { id: null, positie: 'end' } : null;
  const id = row.dataset.bmId;
  if (!dropToegestaan(bookmarks, ids, id)) return null;
  const box = row.getBoundingClientRect();
  return { id, positie: sleepPositie(box.top, box.height, point.clientY) };
}

export function createBookmarkPointerDrag(list, { getDocument, getSelection, canEdit, setDragging, setTarget, expand, commit }) {
  const dom = list.ownerDocument;
  const win = dom.defaultView;
  let source = null;
  let ids = null;
  let point = null;
  let target = null;
  let frame = null;
  let hoverTimer = null;
  let hoverId = null;
  const valid = () => source && source === getDocument() && canEdit();
  function stopHover() {
    win.clearTimeout(hoverTimer); hoverTimer = null; hoverId = null;
  }
  function clear() {
    if (frame != null) win.cancelAnimationFrame(frame);
    frame = null; stopHover(); source = null; ids = null; point = null; target = null;
    setDragging(null); setTarget(null);
  }
  function update() {
    const next = valid() ? bookmarkDropAt(list, point, source.bookmarks || [], ids) : null;
    if (target?.id !== next?.id || target?.positie !== next?.positie) setTarget(next);
    target = next;
    const parent = target?.positie === 'inside' && source?.bookmarks?.find(b => b.id === target.id);
    const closedParent = parent && !parent.expanded && source.bookmarks.some(b => b.parentId === parent.id);
    if (!closedParent) { stopHover(); return; }
    if (hoverId === parent.id) return;
    stopHover(); hoverId = parent.id;
    const hoverSelection = ids;
    hoverTimer = win.setTimeout(() => {
      hoverTimer = null;
      if (valid() && target?.id === parent.id && target.positie === 'inside') expand(source, parent.id, () => ids === hoverSelection && valid() && target?.id === parent.id && target.positie === 'inside');
    }, 1000);
  }
  function scroll() {
    frame = null;
    if (!valid()) { controller.cancel(); return; }
    const rect = list.getBoundingClientRect();
    if (point.clientX >= rect.left && point.clientX < rect.right && point.clientY >= rect.top && point.clientY < rect.bottom) {
      if (point.clientY < rect.top + 24) list.scrollTop -= 8;
      else if (point.clientY > rect.bottom - 24) list.scrollTop += 8;
    }
    update();
    frame = win.requestAnimationFrame(scroll);
  }
  const controller = createOrganizerPointerDrag(list, {
    keyAt(el) {
      if (!canEdit() || el.closest?.('button, input, textarea, select, a, [contenteditable], .bookmark-arrow')) return null;
      const row = el.closest?.('[data-bm-id]');
      if (!row || !list.contains(row)) return null;
      return { id: row.dataset.bmId, doc: getDocument() };
    },
    start(key) {
      source = key.doc;
      const selected = getSelection();
      ids = selected.includes(key.id) ? [...selected] : [key.id];
      setDragging(ids);
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
      const previous = source; const selected = ids;
      clear();
      if (drop) commit(previous, selected, drop.id, drop.positie);
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
