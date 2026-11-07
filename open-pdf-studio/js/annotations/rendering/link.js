// Een link van de app (#953) op het canvas: wat het bestand ook in elke lezer
// toont (geen rand, een rand of een onderstreping, zie saver/link-opslaan.js),
// en op het scherm bij een link zonder rand een lichte stippellijn, zodat de
// gebruiker ziet waar hij staat. Die hulplijn komt nooit in een afdruk of
// export (`gids` is dan uit).

import { linkRand, linkRanddikte, linkVakken, LINK_STANDAARD_KLEUR } from '../link/link-model.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} ann
 * @param {{ gids?: boolean, schermSchaal?: number }} [opties]
 */
export function drawLink(ctx, ann, { gids = false, schermSchaal = 1 } = {}) {
  const vakken = linkVakken(ann);
  const rand = linkRand(ann);
  const kleur = ann.color || ann.strokeColor || LINK_STANDAARD_KLEUR;
  ctx.save();
  if (rand === 'none') {
    if (gids) {
      const sc = schermSchaal || 1;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0, 102, 204, 0.6)';
      ctx.fillStyle = 'rgba(0, 102, 204, 0.06)';
      ctx.lineWidth = 1 / sc;
      ctx.setLineDash([4 / sc, 3 / sc]);
      for (const r of vakken) {
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeRect(r.x, r.y, r.width, r.height);
      }
    }
    ctx.restore();
    return;
  }
  const w = linkRanddikte(ann);
  ctx.strokeStyle = kleur;
  ctx.lineWidth = w;
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  for (const r of vakken) {
    // Binnen het vak, zoals de appearance in het bestand.
    if (rand === 'underline') {
      const y = r.y + r.height - w / 2;
      ctx.beginPath();
      ctx.moveTo(r.x + w / 2, y);
      ctx.lineTo(r.x + r.width - w / 2, y);
      ctx.stroke();
    } else {
      ctx.strokeRect(r.x + w / 2, r.y + w / 2, Math.max(0, r.width - w), Math.max(0, r.height - w));
    }
  }
  ctx.restore();
}
