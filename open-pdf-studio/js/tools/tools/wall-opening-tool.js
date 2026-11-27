/**
 * Door / Window in a wall (#1229) — hover a wall and click: the wall stays
 * ONE annotation and hosts the opening. The frame slides along its wall,
 * moves with it and the wall closes again when the frame is deleted.
 *
 * Placement goes the same way as `app_floorplan {action: "opening"}`
 * (plattegrond/mcp-plattegrond.js): one undo step per click, a door swings
 * toward the side of the wall that was clicked, and an opening that would
 * overlap another opening in the same wall is refused with a message.
 *
 * Width (#1230): the opening starts at the default of the sheet under the
 * pointer — 900 / 1200 mm, or 36" / 48" with the US plan symbol on a sheet
 * measured in feet or inches (plattegrond/blad-conventie.js). Typing a width
 * and Enter changes it for the next clicks: on a feet or inch sheet a bare
 * number is inches and `3'-0"` reads as feet and inches, on a metric sheet a
 * bare number is millimetres. The typing goes through the same key buffer
 * as the typed lengths of the line tools (type-length-input.js).
 *
 * While hovering, the tool shows where the gap will come: the opening at
 * its current width, shifted so that it fits inside the wall.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { wandAs, projecteer } from '../../annotations/wand-geometrie.js';
import { wallPxPerMm } from '../../annotations/rendering/walls.js';
import { wandOpeningen, pasOpeningenIn, klemAfstandMm, overlaptOpening } from '../../annotations/wand-openingen.js';
import { leesBreedteMm, breedteLabel } from '../../plattegrond/blad-conventie.js';
import { isImperiaalBladOpPunt, isImperiaalBladOpPagina } from '../../plattegrond/blad-conventie-op-punt.js';
import { standaardOpeningBreedteMm } from '../../plattegrond/opening-breedte.js';
import {
  enterTypeLengthMode, exitTypeLengthMode, typeLengthActive, typeLengthBuffer, clearTypeLengthBuffer,
} from '../type-length-input.js';

const KIND_OF_TOOL = { wallDoor: 'door', wallWindow: 'window' };

const MESSAGES = {
  hint: ['drawing.wallOpeningHint', 'Width {{width}}: click a wall to place the opening; a door swings to the side you click. Type another width and press Enter to change it'],
  wall: ['drawing.wallOpeningNoWall', 'Click on a wall to place the opening'],
  overlap: ['drawing.wallOpeningOverlap', 'Not placed: the opening would overlap another opening in this wall'],
  outside: ['drawing.wallOpeningNoFit', 'Not placed: the opening does not fit in this wall'],
  layered: ['drawing.wallOpeningLayered', 'Not placed: this wall is one layer of a layered wall'],
  scale: ['drawing.wallOpeningNoScale', 'Set a measurement scale on this page first'],
  badWidth: ['drawing.wallOpeningBadWidth', 'Not a width: {{text}}'],
};

function _message(code, values = {}) {
  const [key, fallback] = MESSAGES[code] || MESSAGES.wall;
  updateStatusMessage(i18next.t(key, { ns: 'ribbon', defaultValue: fallback, ...values }), 6000);
}

// The width the user typed (null = the default of the sheet) and where the
// pointer last was, to know which sheet convention applies.
const _session = { widthMm: null, page: null, x: null, y: null };

/** Is the sheet at the pointer (or, before the first move, the page) imperial? */
function _imperial() {
  if (_session.page != null && Number.isFinite(_session.x) && Number.isFinite(_session.y)) {
    return isImperiaalBladOpPunt(_session.page, _session.x, _session.y);
  }
  return isImperiaalBladOpPagina();
}

function _widthMm(kind, imperial) {
  return _session.widthMm ?? standaardOpeningBreedteMm(kind, imperial);
}

function _showHint(kind) {
  const imperial = _imperial();
  _message('hint', { width: breedteLabel(_widthMm(kind, imperial), imperial) });
}

function _remember(ctx) {
  _session.page = ctx.pageNum || getActiveDocument()?.currentPage || 1;
  _session.x = ctx.x;
  _session.y = ctx.y;
}

/** Enter after typing: the typed text becomes the width for the next clicks. */
function _commitTypedWidth() {
  const kind = KIND_OF_TOOL[state.currentTool];
  const text = typeLengthBuffer();
  clearTypeLengthBuffer();
  if (!kind) return;
  // A bare number is inches on a feet or inch sheet, millimetres otherwise.
  const widthMm = leesBreedteMm(text, _imperial());
  if (widthMm === null) { _message('badWidth', { text }); return; }
  _session.widthMm = widthMm;
  _showHint(kind);
}

/** The wall under the pointer: the point lies inside its band. */
function _wallAt(ctx) {
  const doc = getActiveDocument();
  const page = ctx.pageNum || doc?.currentPage || 1;
  const tol = 4 / (ctx.scale || 1);
  let best = null;
  for (const a of doc?.annotations || []) {
    if (a?.type !== 'wall' || (a.page ?? 1) !== page || a.locked) continue;
    const pr = projecteer({ x: ctx.x, y: ctx.y }, a);
    if (!pr || pr.t < -tol || pr.t > pr.as.len + tol) continue;
    const pxPerMm = wallPxPerMm(a);
    const outside = Math.abs(pr.d) - ((a.dikteMm || 100) * pxPerMm) / 2;
    if (outside > tol) continue;
    if (!best || Math.abs(pr.d) < best.distance) best = { distance: Math.abs(pr.d), wall: a, pr, pxPerMm };
  }
  return best;
}

/** Where the gap would come for this pointer position, and whether it is free. */
function _candidate(hit, widthMm) {
  const { wall, pr, pxPerMm } = hit;
  const lengthMm = pr.as.len / pxPerMm;
  const alongMm = klemAfstandMm(lengthMm, widthMm, pr.t / pxPerMm);
  const others = pasOpeningenIn(lengthMm, wandOpeningen(wall));
  return {
    alongMm, widthMm,
    fits: widthMm <= lengthMm + 1e-6,
    free: widthMm <= lengthMm + 1e-6 && !overlaptOpening(alongMm, widthMm, others),
    side: pr.d >= 0 ? 1 : -1,
  };
}

function _drawPreview(ctx, hit, cand) {
  const canvasCtx = ctx.canvasCtx;
  if (!canvasCtx) return;
  const { wall, pxPerMm } = hit;
  const as = wandAs(wall);
  const h = ((wall.dikteMm || 100) * pxPerMm) / 2;
  const t0 = (cand.alongMm - cand.widthMm / 2) * pxPerMm;
  const t1 = (cand.alongMm + cand.widthMm / 2) * pxPerMm;
  const at = (t, s) => ({
    x: wall.startX + as.u.x * t + as.n.x * s,
    y: wall.startY + as.u.y * t + as.n.y * s,
  });
  const scale = ctx.scale || 1;
  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = cand.free ? '#0078d7' : '#e81123';
  canvasCtx.lineWidth = 1.5 / scale;
  canvasCtx.setLineDash([4 / scale, 3 / scale]);
  canvasCtx.beginPath();
  const corners = [at(t0, h), at(t1, h), at(t1, -h), at(t0, -h)];
  canvasCtx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) canvasCtx.lineTo(corners[i].x, corners[i].y);
  canvasCtx.closePath();
  canvasCtx.stroke();
  // A short mark on the side of the wall the pointer is on: the side a door
  // will swing to.
  canvasCtx.setLineDash([]);
  const mid = (t0 + t1) / 2;
  const from = at(mid, cand.side * h);
  const to = at(mid, cand.side * (h + 10 / scale));
  canvasCtx.beginPath();
  canvasCtx.moveTo(from.x, from.y);
  canvasCtx.lineTo(to.x, to.y);
  canvasCtx.stroke();
  canvasCtx.restore();
}

let _busy = false;

async function _place(ctx, hit, kind) {
  if (_busy) return;
  _busy = true;
  try {
    const { plattegrondInApp } = await import('../../mcp-bridge.js');
    const r = await plattegrondInApp({
      action: 'opening', page: hit.wall.page ?? 1, wallId: hit.wall.id, kind,
      point: { x: ctx.x, y: ctx.y },
      // A typed width; without one the sheet under the click decides (and
      // with it the symbol: the frame, or the US plan symbol).
      ...(_session.widthMm != null ? { widthMm: _session.widthMm } : {}),
    });
    if (!r?.ok) { _message(r?.reason || 'wall'); return; }
    const m = await import('../manager.js');
    if (m.maybeRevertToSelect) m.maybeRevertToSelect();
  } catch (err) {
    console.error('[wall opening] placing failed', err);
  } finally {
    _busy = false;
    ctx.redraw();
  }
}

function _makeTool(name) {
  const kind = KIND_OF_TOOL[name];
  return {
    name,
    cursor: 'crosshair',

    // Chosen (again): start from the default width and listen for a typed one.
    onActivate() {
      _session.widthMm = null;
      enterTypeLengthMode(0, 0);
      state._typeLengthCommit = _commitTypedWidth;
    },

    onPointerDown(ctx, e) {
      if (e.button !== 0) return;
      _remember(ctx);
      const hit = _wallAt(ctx);
      if (!hit) { _message('wall'); return; }
      _place(ctx, hit, kind);
    },

    onPointerMove(ctx) {
      _remember(ctx);
      ctx.redraw();
      const hit = _wallAt(ctx);
      if (!hit) return;
      const cand = _candidate(hit, _widthMm(kind, _imperial()));
      if (cand.fits) _drawPreview(ctx, hit, cand);
    },

    onEscape() { return false; },

    onDeactivate() {
      if (typeLengthActive()) exitTypeLengthMode();
      if (state._typeLengthCommit) state._typeLengthCommit = null;
      _session.widthMm = null;
      _session.page = null;
    },
  };
}

export const wallDoorTool = _makeTool('wallDoor');
export const wallWindowTool = _makeTool('wallWindow');

/** Ribbon entry point: choose the tool and show what to do. */
export async function startWallOpeningTool(kind) {
  const m = await import('../manager.js');
  m.setTool(kind === 'window' ? 'wallWindow' : 'wallDoor');
  _showHint(kind === 'window' ? 'window' : 'door');
}
