// Statusbadge op de markering (#1076): een klein gekleurd vierkant op de
// rechterbovenhoek van een markering met een status, zodat open en afgeronde
// punten op de tekening opvallen. Een voorkeur (showStatusBadges), standaard
// uit.
//
// Alleen weergave: de badge wordt na de markeringen op het schermcanvas
// getekend (annotations/rendering.js) en nooit in drawAnnotation zelf. Het
// opgeslagen uiterlijk van de markering, een afdruk en een export blijven
// dus zoals ze waren.
//
// Puur: alleen status-sets.js; de omhullende en het weergavefilter komen van
// de aanroeper. Ook in node te testen.

import { statusKleur, statusSleutelVan } from './status-sets.js';

/** De zijde van de badge in schermpixels. */
export const BADGE_PIXELS = 9;

/**
 * De badge van één markering in de ruimte van de pagina, of null als ze geen
 * status of geen omhullende heeft. Het vierkant ligt met zijn midden op de
 * rechterbovenhoek van de omhullende en is op het scherm altijd even groot.
 * @param {object} ann
 * @param {object[]} lijst  statusLijst(voorkeuren)
 * @param {{x: number, y: number, width: number, height: number}|null} grenzen
 * @param {number} pixelsPerEenheid  schermpixels per pagina-eenheid
 * @returns {{x: number, y: number, maat: number, kleur: string}|null}
 */
export function statusBadge(ann, lijst, grenzen, pixelsPerEenheid) {
  if (!ann || statusSleutelVan(ann.status) === 'none') return null;
  const kleur = statusKleur(ann.status, lijst);
  if (!kleur || !grenzen) return null;
  const { x, y, width, height } = grenzen;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const schaal = Number.isFinite(pixelsPerEenheid) && pixelsPerEenheid > 0 ? pixelsPerEenheid : 1;
  const maat = BADGE_PIXELS / schaal;
  return { x: x + Math.max(0, width) - maat / 2, y: y - maat / 2, maat, kleur };
}

/**
 * Teken de badges van de markeringen op een pagina. De schaal komt uit de
 * transformatie van het canvas, zodat de badge in elke weergave (zoom,
 * gedraaid, hoge pixeldichtheid) dezelfde maat op het scherm heeft.
 * @param {CanvasRenderingContext2D} ctx  met de transformatie van de pagina
 * @param {object[]} annotations
 * @param {number} pageNum
 * @param {{ lijst?: object[], grenzen: (ann: object) => object|null,
 *   verborgen?: (ann: object) => boolean, dpr?: number }} bron
 * @returns {number} het aantal getekende badges
 */
export function tekenStatusBadges(ctx, annotations, pageNum, { lijst = [], grenzen, verborgen, dpr = 1 } = {}) {
  if (!ctx || !Array.isArray(annotations) || typeof grenzen !== 'function') return 0;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const apparaat = m ? Math.hypot(m.a, m.b) : 1;
  const pixelsPerEenheid = (apparaat || 1) / (dpr > 0 ? dpr : 1);
  let aantal = 0;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  for (const ann of annotations) {
    if (!ann || ann.page !== pageNum) continue;
    if (statusSleutelVan(ann.status) === 'none') continue;
    if (verborgen && verborgen(ann)) continue;
    let vak = null;
    try { vak = grenzen(ann); } catch { vak = null; }
    const badge = statusBadge(ann, lijst, vak, pixelsPerEenheid);
    if (!badge) continue;
    // Een witte rand met een donkere lijn eromheen: leesbaar op elke ondergrond.
    const rand = 1 / pixelsPerEenheid;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(badge.x - rand, badge.y - rand, badge.maat + 2 * rand, badge.maat + 2 * rand);
    ctx.fillStyle = badge.kleur;
    ctx.fillRect(badge.x, badge.y, badge.maat, badge.maat);
    ctx.lineWidth = rand;
    ctx.strokeStyle = '#333333';
    ctx.strokeRect(badge.x - rand, badge.y - rand, badge.maat + 2 * rand, badge.maat + 2 * rand);
    aantal++;
  }
  ctx.restore();
  return aantal;
}
