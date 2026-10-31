import { uiSchaalFactor, UI_SCHAAL_EVENT } from '../../../core/ui-scale.js';

const MIN_FONT_SIZE = 7;
const DEFAULT_FONT_SIZE = 10;
const MAX_LINES = 2;

// Every label that is attached, so a change of the interface size (#883) can
// measure them all again: a size that was shrunk inline at 100% would
// otherwise stay small at 200%.
const labels = new Set();

// Labels to measure in the next frame. Measuring reads layout; done straight
// from the MutationObserver (a microtask) it forced a full layout in the
// middle of the startup render, for every label that got its text (#707).
// Batched in one requestAnimationFrame it runs with the frame's own layout,
// still before that frame is painted.
const pending = new Set();
let frame = 0;

function schedule(el) {
  pending.add(el);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const teMeten = [...pending];
    pending.clear();
    for (const label of teMeten) shrink(label);
    // Labels of closed ribbon tabs are created anew next time: forget the
    // old ones now and then (they are connected again only if reused).
    if (labels.size > 300) {
      for (const el of labels) if (!el.isConnected) labels.delete(el);
    }
  });
}

globalThis.addEventListener?.(UI_SCHAAL_EVENT, () => {
  for (const el of labels) {
    if (el.isConnected) schedule(el);
    else labels.delete(el);
  }
});

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    const el = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
    if (el) schedule(el);
  }
});

// True when the label overflows its box. Vertical: more than MAX_LINES
// lines. Horizontal: a word wider than the box — `word-break: normal`
// forbids mid-word breaks, so long words (e.g. "Schermafbeelding") don't
// wrap and were silently clipped by `overflow: hidden` (#158). scrollHeight
// only detects the vertical case, so check scrollWidth too.
function overflows(el, maxHeight) {
  return el.scrollHeight > maxHeight || el.scrollWidth > el.clientWidth;
}

function shrink(el) {
  if (!el || !el.parentElement) return;

  // Reset to default size
  el.style.fontSize = '';
  // Sizes follow the interface size (#883): at 200% a label must not shrink
  // below what it is at 100%.
  const schaal = uiSchaalFactor();
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || (DEFAULT_FONT_SIZE * schaal * 1.15);
  const maxHeight = lineHeight * MAX_LINES + 1; // allow 2 lines

  let size = DEFAULT_FONT_SIZE * schaal;
  // If content overflows the box (too many lines, or an unbreakable word
  // that is clipped at the edge), reduce font size until it fits.
  while (overflows(el, maxHeight) && size > MIN_FONT_SIZE * schaal) {
    size -= 0.5 * schaal;
    el.style.fontSize = size + 'px';
  }
}

/**
 * Attach to a ribbon-btn-label span via ref.
 * Shrinks font-size so text fits within 2 lines without breaking words.
 */
export function autoShrinkLabel(el) {
  labels.add(el);
  schedule(el);
  observer.observe(el, { childList: true, characterData: true, subtree: true });
}
