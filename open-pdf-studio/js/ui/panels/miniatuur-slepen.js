// Pagina's herschikken door miniaturen te slepen (#962). Het slepen gaat met
// pointer-events (organizer-pointer-drag.js), niet met HTML5-drag-and-drop:
// in de desktop-app neemt de eigen bestandsdrop van het venster de
// HTML5-sleepgebeurtenissen over, waardoor er niets gebeurde. Hier staan de
// pure stukken: welk doel ligt onder de wijzer, en welke nieuwe volgorde
// levert een drop op. Geen DOM, los te testen.

import { identityOrder, gapForDrop, moveGroupToGap, isNoOpGap } from '../../pdf/page-order.js';
import { dropPositie } from './miniatuur-maat.js';

/**
 * Het dropdoel onder de wijzer. Eerst de rij (de tegel die in hoogte het
 * dichtst bij ligt), dan de dichtstbijzijnde tegel in die rij; daarbinnen
 * valt de drop ervoor of erachter (links/rechts bij meerdere kolommen,
 * boven/onder bij één kolom).
 * @param {{page:number, left:number, top:number, right:number, bottom:number}[]} tegels
 *   in de volgorde zoals getoond
 * @returns {{page:number, position:'before'|'after', naast:boolean}|null}
 */
export function dropDoelBijPunt(tegels, x, y, meerdereKolommen = false) {
  if (!Array.isArray(tegels) || tegels.length === 0) return null;
  let beste = null;
  let besteDy = Infinity;
  let besteDx = Infinity;
  for (const r of tegels) {
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (dy < besteDy || (dy === besteDy && dx < besteDx)) {
      beste = r; besteDy = dy; besteDx = dx;
    }
  }
  const rect = { left: beste.left, top: beste.top, width: beste.right - beste.left, height: beste.bottom - beste.top };
  const naast = !!meerdereKolommen;
  return { page: beste.page, position: dropPositie(rect, x, y, naast), naast };
}

/**
 * De nieuwe paginavolgorde na een drop. Een geselecteerde pagina neemt de
 * hele selectie mee (#763); een niet-geselecteerde gaat alleen.
 * @param {number} aantal paginatal van het document
 * @param {number[]} geselecteerd geselecteerde pagina's (1-based)
 * @param {number} gesleept de pagina waarmee het slepen begon
 * @param {{page:number, position:'before'|'after'}|null} doel
 * @returns {number[]|null} de volgorde voor reorderPages(), of null als er
 *   niets verandert
 */
export function volgordeNaDrop(aantal, geselecteerd, gesleept, doel) {
  if (!doel || !(aantal > 1)) return null;
  const order = identityOrder(aantal);
  if (!order.includes(gesleept)) return null;
  const sel = Array.isArray(geselecteerd) ? geselecteerd : [];
  const groep = sel.includes(gesleept) ? sel.filter((p) => order.includes(p)) : [gesleept];
  const gap = gapForDrop(order, doel.page, doel.position === 'after' ? 'after' : 'before');
  if (gap < 0 || isNoOpGap(order, groep, gap)) return null;
  return moveGroupToGap(order, groep, gap);
}

/**
 * Automatisch scrollen tijdens het slepen: hoeveel px per frame als de wijzer
 * binnen `rand` px van de boven- of onderkant van de lijst komt (negatief =
 * omhoog), anders 0.
 */
export function scrollStap(top, bottom, y, rand = 40, max = 18) {
  if (!(bottom > top)) return 0;
  if (y < top + rand) return -Math.ceil(max * Math.min(1, (top + rand - y) / rand));
  if (y > bottom - rand) return Math.ceil(max * Math.min(1, (y - (bottom - rand)) / rand));
  return 0;
}
