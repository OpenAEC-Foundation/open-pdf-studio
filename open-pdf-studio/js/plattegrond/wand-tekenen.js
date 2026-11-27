// Een wand die op een vlak is getekend sluit aan op de wand ervoor (#1230).
//
// De pure regel staat in wand-locatielijn.js (vlakHoekPlan). Dit is de dunne
// laag voor het wandgereedschap: de wanden van de pagina erbij zoeken, het
// plan uitvoeren en teruggeven wat er veranderde, zodat het gereedschap de
// nieuwe wand en de bijgestelde uiteinden in één ongedaan-stap vastlegt.

import { wallHalfWidthPx } from '../annotations/rendering/walls.js';
import { pasTrimToe } from '../annotations/wand-join.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { vlakHoekPlan } from './wand-locatielijn.js';

/**
 * Sluit de hoeken van een zojuist getekende wand. Muteert `ann` en de
 * bestaande wanden waarvan een uiteinde naar de hoek gaat.
 *
 * @param {object} ann  de nieuwe wand (nog niet in de lijst), op haar hartlijn
 * @param {{x: number, y: number}} klikStart  het eerste geklikte punt
 * @param {object[]} annotaties  de annotaties van het document
 * @returns {{geraakt: object[], voor: object[]} | null}  de bijgestelde
 *   bestaande wanden met hun toestand ervoor; null als de wand op haar
 *   hartlijn is getekend of er geen hoek te sluiten viel
 */
export function sluitVlakHoeken(ann, klikStart, annotaties) {
  if (ann?.type !== 'wall' || !klikStart) return null;
  // De hartlijn ligt overal dezelfde vector naast de geklikte lijn.
  const vx = ann.startX - klikStart.x, vy = ann.startY - klikStart.y;
  if (Math.hypot(vx, vy) < 1e-9) return null;                 // op de hartlijn
  const klik = {
    startX: klikStart.x, startY: klikStart.y,
    endX: ann.endX - vx, endY: ann.endY - vy,
  };
  // Een vergrendelde wand blijft zoals hij is, net als bij hoek trimmen.
  const wanden = (annotaties || []).filter((a) => a?.type === 'wall' && a.page === ann.page
    && a !== ann && !a.locked);
  const plan = vlakHoekPlan(ann, klik, wanden, wallHalfWidthPx);
  if (!plan.length) return null;
  const geraakt = wanden.filter((w) => plan.some((z) => z.id === w.id));
  const voor = geraakt.map((w) => cloneAnnotation(w));
  const nu = new Date().toISOString();
  for (const w of geraakt) {
    pasTrimToe(w, plan);
    w.modifiedAt = nu;
  }
  pasTrimToe(ann, plan);
  return { geraakt, voor };
}
