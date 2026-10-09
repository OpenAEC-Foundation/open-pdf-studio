import { Show } from 'solid-js';
import {
  typeLengthBuffer,
  typeLengthCursor,
  typeLengthFormat,
  typeLengthActive,
  getTypeLengthStart,
} from '../../tools/type-length-input.js';
import { state, getActiveDocument } from '../../core/state.js';
import { paginaRectNaarClient } from '../../pdf/weergave-ruimte.js';

/**
 * Overlay HUD for the live coord-input buffer. Visible for the WHOLE time a
 * tool has coord-input capture active — not only after the first keystroke —
 * so the user can see WHERE to type a measurement/factor/displacement.
 * Shows a colored format hint next to the typed text:
 *   length    → blue   "len"
 *   cartesian → green  "@dx,dy"
 *   polar     → orange "@d<θ"
 *   absolute  → purple "abs"
 *   invalid   → red    "?"
 */
function _hintFor(kind) {
  switch (kind) {
    case 'length':    return { text: 'len',    color: '#1c6dd0' };
    case 'cartesian': return { text: '@dx,dy', color: '#2e8b3d' };
    case 'polar':     return { text: '@d<θ',  color: '#d97706' };
    case 'absolute': return { text: 'abs',    color: '#7c3aed' };
    case 'invalid':  return { text: '?',      color: '#c0382c' };
    default:          return { text: '',       color: '#666666' };
  }
}

/** Wat er in het lege veld staat, afhankelijk van het actieve gereedschap. */
function _placeholder() {
  switch (state.currentTool) {
    case 'enlarge': return 'type factor e.g. 1.5 + Enter';
    case 'stretch': return 'type dx,dy e.g. 50,0 + Enter';
    case 'offset':  return 'type distance + Enter';
    case 'line':
    case 'arrow':
    case 'polyline':
    case 'spline':
    case 'measureDistance':
    case 'measureArea':
    case 'measurePerimeter':
      return 'type length + Enter';
    default: return 'type value + Enter';
  }
}

/**
 * Boven de cursor wanneer die boven het paginavlak staat; anders (bv. direct
 * na een ribbon-klik, of nog nooit over het canvas bewogen) aan het invoeranker
 * — de startpositie die het gereedschap heeft vastgelegd — zodat het veld
 * nooit in een hoek van het scherm verdwijnt.
 */
function _pos() {
  const cur = typeLengthCursor();
  const c = document.getElementById('annotation-canvas');
  const r = c && c.getBoundingClientRect ? c.getBoundingClientRect() : null;
  if (r && cur && cur.x >= r.left && cur.x <= r.right && cur.y >= r.top && cur.y <= r.bottom) {
    return { x: cur.x + 15, y: cur.y + 10 };
  }
  try {
    const doc = getActiveDocument();
    const start = getTypeLengthStart();
    const rect = paginaRectNaarClient(doc?.currentPage ?? 1,
      { x: start.x, y: start.y, width: 0, height: 0 }, doc);
    if (rect) return { x: rect.left + 15, y: rect.top + 10 };
  } catch (_) { /* paginarect niet beschikbaar — val terug op het canvas */ }
  if (r) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: 120, y: 120 };
}

export default function TypeLengthHUD() {
  return (
    <Show when={typeLengthActive()}>
      <div
        style={{
          position: 'fixed',
          left: `${_pos().x}px`,
          top: `${_pos().y}px`,
          background: '#ffffff',
          border: '1px solid #000000',
          padding: '2px 6px',
          'font-family': 'Consolas, monospace',
          'font-size': '12px',
          color: '#000000',
          'pointer-events': 'none',
          'z-index': 9999,
          'box-shadow': '1px 1px 2px rgba(0,0,0,0.2)',
          display: 'flex',
          gap: '6px',
          'align-items': 'baseline',
          'white-space': 'nowrap',
        }}
      >
        <Show
          when={typeLengthBuffer().length > 0}
          fallback={<span style={{ color: '#888888' }}>{_placeholder()}</span>}
        >
          <span>{typeLengthBuffer()}</span>
          <Show when={_hintFor(typeLengthFormat()).text}>
            <span style={{ color: _hintFor(typeLengthFormat()).color, 'font-size': '10px' }}>
              {_hintFor(typeLengthFormat()).text}
            </span>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
