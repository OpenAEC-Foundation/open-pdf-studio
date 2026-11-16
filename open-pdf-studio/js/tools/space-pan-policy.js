import { isTextEntryTarget } from '../ui/chrome/tab-sneltoets.js';

const isSpace = e => e.code === 'Space' || e.key === ' ';
// Space belongs to whatever control has the focus. Besides the usual controls
// that is any keyboard-operable element outside the page view: a section
// header with tabindex, a label, anything with a role. The page view itself
// may be focusable; there Space is the pan gesture.
const control = t => isTextEntryTarget(t) || !!t?.closest?.(
  'button, select, a, [role="button"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="listbox"], [role="slider"]')
  || (!!t?.closest?.('summary, label, [role], [tabindex]:not([tabindex="-1"])') && !t?.closest?.('#pdf-container'));
const consume = e => { e.preventDefault(); e.stopPropagation(); };

// A temporary gesture, not a tool switch: no deselect/deactivate side effects.
// Dependencies keep ownership and keyboard guards testable without app globals.
export function createSpacePanHandlers(d) {
  let held = false;
  let owner = null;
  let pointerId = null;
  let stop = null;
  let suppressClick = false;
  const setHeld = value => { held = value; d.setHeld(value); };
  function end() { const finish = stop; stop = null; finish?.(); }
  function reset() { setHeld(false); owner = null; end(); pointerId = null; }
  function valid() { return owner === d.getDocument() && !d.blocked(); }
  return {
    reset,
    onKeyDown(e) {
      if (!isSpace(e)) return;
      if (held) { if (valid()) consume(e); else reset(); return; }
      if (e.repeat || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey
          || control(e.target) || !d.getDocument() || d.blocked() || d.isPanning()) return;
      owner = d.getDocument();
      setHeld(true);
      consume(e);
    },
    onKeyUp(e) {
      if (!isSpace(e) || !held) return;
      consume(e);
      setHeld(false);
      owner = null;
      // Keep the pointer id until release so a tool does not receive an orphan up.
      end();
    },
    onPointerDown(e) {
      suppressClick = false;
      if (!held) return;
      if (!valid()) { reset(); return; }
      if (e.button !== 0 || e.buttons !== 1 || e.pointerType === 'touch'
          || !e.target?.closest?.('#pdf-container') || e.target.closest('.compare-view')
          || isTextEntryTarget(e.target) || e.target.closest('button, select') || d.isPanning()) return;
      consume(e);
      pointerId = e.pointerId;
      suppressClick = true;
      stop = d.startPan(e);
    },
    onPointerMove(e) {
      if (e.pointerId !== pointerId) return;
      if (!(e.buttons & 1)) { consume(e); reset(); return; }
      if (!held || !valid()) { consume(e); setHeld(false); owner = null; end(); }
    },
    onPointerUp(e) {
      if (e.pointerId !== pointerId) return;
      consume(e); end(); pointerId = null;
    },
    onPointerCancel(e) { if (e.pointerId === pointerId) { consume(e); reset(); } },
    onLostPointerCapture(e) {
      if (e.pointerId === pointerId && stop) { setHeld(false); owner = null; end(); }
    },
    onClick(e) { if (suppressClick && e.target?.closest?.('#pdf-container')) { consume(e); suppressClick = false; } },
  };
}
