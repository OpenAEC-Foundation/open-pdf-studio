/**
 * Link-gereedschap (#953): sleep een vak; daarna kiest de gebruiker het doel
 * in het venster 'link' (annotations/link/link-maken.js). Is er tekst
 * geselecteerd, dan maakt de knop de link direct uit die selectie en komt dit
 * gereedschap er niet aan te pas. Escape of de rechtermuisknop breekt een
 * lopend vak af.
 */
import { applyToolTransform } from '../tool-context.js';
import { MIN_GEBIED_PX, schermPxNaarPt } from '../../annotations/minimummaat.js';
import { vraagNieuweLink, neemSelectieOver, LINK_TOOL } from '../../annotations/link/link-maken.js';
import { getActiveDocument } from '../../core/state.js';

let _start = null;    // { x, y, pageNum }
let _laatste = null;  // laatste punt op de startpagina

function vakTussen(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function stop(ctx) {
  _start = null;
  _laatste = null;
  ctx?.redraw?.();
}

export const linkTool = {
  name: LINK_TOOL,
  cursor: 'crosshair',

  // Gekozen met tekst geselecteerd (lint, palet, sneltoets): die tekst wordt
  // de link, daarna terug naar Selecteren.
  onActivate() {
    if (!neemSelectieOver()) return;
    queueMicrotask(() => import('../manager.js').then((m) => m.setTool('select')).catch(() => {}));
  },

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      if (_start) { e.preventDefault?.(); stop(ctx); }
      return;
    }
    if (e.button !== 0 || ctx.isPdfAReadOnly?.()) return;
    // De pagina onder de cursor (doorlopende weergave), anders de huidige.
    _start = { x: ctx.x, y: ctx.y, pageNum: ctx.pageNum || getActiveDocument()?.currentPage || 1 };
    _laatste = { x: ctx.x, y: ctx.y };
  },

  onPointerMove(ctx) {
    // Het vak hoort bij één pagina: buiten de startpagina telt het laatste
    // punt erop (doorlopende weergave).
    if (!_start || (ctx.pageNum && ctx.pageNum !== _start.pageNum)) return;
    _laatste = { x: ctx.x, y: ctx.y };
    ctx.redraw();
    const c = ctx.canvasCtx;
    if (!c) return;
    const v = vakTussen(_start, _laatste);
    const sc = ctx.scale || 1;
    c.save();
    applyToolTransform(c);
    c.strokeStyle = '#0066cc';
    c.fillStyle = 'rgba(0, 102, 204, 0.08)';
    c.lineWidth = 1.5 / sc;
    c.setLineDash([5 / sc, 3 / sc]);
    c.fillRect(v.x, v.y, v.width, v.height);
    c.strokeRect(v.x, v.y, v.width, v.height);
    c.restore();
  },

  onPointerUp(ctx) {
    if (!_start) return false;
    if (!ctx.pageNum || ctx.pageNum === _start.pageNum) _laatste = { x: ctx.x, y: ctx.y };
    const vak = vakTussen(_start, _laatste);
    const page = _start.pageNum;
    stop(ctx);
    // Een klik is geen vak: het gereedschap blijft klaar voor een sleep.
    const min = schermPxNaarPt(MIN_GEBIED_PX / 2, ctx.scale);
    if (vak.width < min || vak.height < min) return true;
    vraagNieuweLink(page, vak);
    return true;
  },

  onEscape(ctx) {
    if (!_start) return false;
    stop(ctx);
    return true;
  },

  onDeactivate(ctx) {
    if (_start) stop(ctx);
  },
};
