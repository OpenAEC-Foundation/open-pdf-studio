/**
 * Coord-input capture module — CAD-style live coordinate entry.
 *
 * Supports four input formats while a tool/flow has activated capture mode:
 *
 *   length        e.g. `100`        distance in current cursor direction
 *   relative XY   e.g. `100,50`     offset @dx,dy from anchor
 *   polar         e.g. `100<45`     distance @ angle (deg) from anchor
 *   absolute      e.g. `=400,300`   absolute app-coord (top-left origin)
 *
 * Parsing rules (live, on every keystroke):
 *   - starts with `=` → absolute (must contain `,` after the `=`)
 *   - contains `<` → polar (split on `<`)
 *   - contains `,` → relative XY (split on `,`)
 *   - otherwise → length
 *
 * Numeric values:
 *   - `.` is the decimal separator (locale-agnostic, v1)
 *   - `,` is ALWAYS a field separator, never a decimal
 *   - leading `-` permitted on either field of relative/polar/absolute
 *
 * Backward compatibility:
 *   - public API (enter/exit/setStart/clear/applyToEndpoint/consumeKey) unchanged
 *   - typing `100` keeps the original length-only behaviour
 *   - applyToEndpoint signature unchanged: returns {x, y, constrained}
 *
 * Coordinate considerations:
 *   - typed numeric values are in current scale units; converted to app pixels
 *     via getMeasureScale().pixelsPerUnit
 *   - absolute mode interprets `=X,Y` as raw app-coords (already pixels) so it
 *     bypasses the unit conversion
 *
 * SolidJS signals exposed for HUD overlay:
 *   typeLengthBuffer()  — raw buffer string
 *   typeLengthCursor()  — last-seen cursor in viewport coords
 *   typeLengthFormat()  — parsed format kind: 'length'|'cartesian'|'polar'|'absolute'|'invalid'|'empty'
 */

import { createSignal } from 'solid-js';
import { getMeasureScale } from '../annotations/measurement.js';
import { getActiveDocument } from '../core/state.js';
import { parseCoordBuffer, beperkEindpunt } from './coord-invoer.js';

export { parseCoordBuffer };

// ── SolidJS signals exposed to the HUD overlay ─────────────────────────────
const [_buffer, _setBuffer] = createSignal('');
const [_cursorScreen, _setCursorScreen] = createSignal({ x: 0, y: 0 });
const [_format, _setFormat] = createSignal('empty');

export const typeLengthBuffer = _buffer;
export const typeLengthCursor = _cursorScreen;
export const typeLengthFormat = _format;

// ── Internal mode state ────────────────────────────────────────────────────
const _mode = {
  active: false,
  startX: 0,
  startY: 0,
};

/** Returns true if a tool has called enterTypeLengthMode and not yet exited. */
export function typeLengthActive() {
  return _mode.active;
}

/** Returns true if the user has typed at least one char (so endpoint should be constrained). */
export function typeLengthHasBuffer() {
  return _mode.active && _buffer().length > 0;
}

export function getTypeLengthStart() {
  return { x: _mode.startX, y: _mode.startY };
}

/** Activate coord-input capture for a tool that just committed its start point. */
export function enterTypeLengthMode(startX, startY) {
  _mode.active = true;
  _mode.startX = startX;
  _mode.startY = startY;
  _setBuffer('');
  _setFormat('empty');
}

/** Deactivate (called from tool onDeactivate or after final commit). */
export function exitTypeLengthMode() {
  _mode.active = false;
  _setBuffer('');
  _setFormat('empty');
}

/** Clear only the buffer but keep the mode active. */
export function clearTypeLengthBuffer() {
  _setBuffer('');
  _setFormat('empty');
}

/** Update startX/Y for tools that move along (e.g. polyline next segment). */
export function setTypeLengthStart(x, y) {
  _mode.startX = x;
  _mode.startY = y;
  _setBuffer('');
  _setFormat('empty');
}

/** Called from the canvas pointermove so the HUD can follow the cursor. */
export function setTypeLengthCursorScreen(clientX, clientY) {
  _setCursorScreen({ x: clientX, y: clientY });
}

// ── Parsing ────────────────────────────────────────────────────────────────
// parseCoordBuffer woont in coord-invoer.js (pure, getest).

function _reparse() {
  const r = parseCoordBuffer(_buffer());
  _setFormat(r.kind);
}

// ── Key consumption ────────────────────────────────────────────────────────

/**
 * Consume a key while in coord-input mode.
 * Returns:
 *   { handled: false }                          — key not relevant
 *   { handled: true, committed: true,
 *     length: number|null }                     — Enter pressed with valid buffer
 *   { handled: true, committed: false }         — buffer edited
 *   { handled: true, aborted: true }            — Esc pressed
 */
export function consumeKey(key) {
  if (!_mode.active) return { handled: false };

  // Allow chars that participate in any of the four formats: digits, '.', ',',
  // '<', '=', '-' plus the editing keys.
  if (/^[0-9]$/.test(key)) {
    _setBuffer(_buffer() + key);
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '.') {
    // Append a literal decimal point. Multiple dots are allowed in different
    // fields (e.g. "12.5,3.7"); we let the parser reject malformed numbers.
    _setBuffer(_buffer() + '.');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === ',') {
    // Comma is ALWAYS a field separator (spec). Don't add a second comma in
    // formats that only support one field separator.
    const buf = _buffer();
    if (buf.includes(',')) return { handled: true, committed: false };
    if (buf.includes('<')) return { handled: true, committed: false };
    _setBuffer(buf + ',');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '<') {
    const buf = _buffer();
    // '<' valid only if no '<' already and no ',' (would mix formats)
    if (buf.includes('<') || buf.includes(',')) return { handled: true, committed: false };
    if (buf.length === 0 || buf === '=' || buf === '-') return { handled: true, committed: false };
    _setBuffer(buf + '<');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '=') {
    // Only meaningful as the very first character.
    if (_buffer().length !== 0) return { handled: true, committed: false };
    _setBuffer('=');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '-') {
    // Allow '-' at start of buffer or right after a separator (',' '<' '=')
    const buf = _buffer();
    const last = buf.length > 0 ? buf[buf.length - 1] : '';
    const ok = buf.length === 0 || last === ',' || last === '<' || last === '=';
    if (!ok) return { handled: true, committed: false };
    _setBuffer(buf + '-');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === 'Backspace') {
    if (_buffer().length === 0) return { handled: false };
    _setBuffer(_buffer().slice(0, -1));
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === 'Tab') {
    // Tab is consumed while active (spec mentions field cycling for v2).
    // For v1 just swallow it so it doesn't break tool focus, no buffer change.
    if (_buffer().length === 0) return { handled: false };
    return { handled: true, committed: false };
  }
  if (key === 'Enter') {
    const r = parseCoordBuffer(_buffer());
    if (r.kind === 'invalid' || r.kind === 'empty') return { handled: false };
    // Length-only must have a > 0 to be meaningful (kept from original behaviour)
    if (r.kind === 'length' && (r.a == null || r.a <= 0)) return { handled: false };
    return { handled: true, committed: true, length: r.kind === 'length' ? r.a : null };
  }
  if (key === 'Escape') {
    if (_buffer().length === 0) return { handled: false };
    _setBuffer('');
    _setFormat('empty');
    return { handled: true, aborted: true };
  }
  return { handled: false };
}

// ── Endpoint constraint ────────────────────────────────────────────────────

/**
 * Constrain a cursor-driven endpoint to the parsed buffer when one is active.
 * Returns { x, y, constrained: bool }.  If buffer empty or unparseable, the
 * unchanged cursor coords are returned.
 */
export function applyToEndpoint(startX, startY, cursorX, cursorY) {
  if (!_mode.active || _buffer().length === 0) {
    return { x: cursorX, y: cursorY, constrained: false };
  }
  // Resolve the scale AT THE ANCHOR POINT: when drawing inside a scale region
  // (schaalgebied) the typed value must be interpreted in THAT region's
  // scale/unit, not the document/global scale. getMeasureScale prioritises
  // the innermost region containing the point.
  const _page = getActiveDocument()?.currentPage;
  const pxPerUnit = getMeasureScale(_page, startX, startY).pixelsPerUnit || 1;
  return beperkEindpunt(parseCoordBuffer(_buffer()), startX, startY, cursorX, cursorY, pxPerUnit);
}
