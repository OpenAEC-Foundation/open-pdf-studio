/**
 * Selection Guard
 * ---------------
 * Voorkomt "spurious" (ongewenste) tekstselecties bij een meerkoloms- of
 * tabel-indeling.
 *
 * ACHTERGROND
 * De tekstlaag bestaat uit absoluut-gepositioneerde <span>'s in PDF
 * content-stream-volgorde (PDF.js TextLayer). Die volgorde komt bij een
 * meerkoloms-/tabel-indeling NIET overeen met de visuele leesvolgorde: in een
 * tabelrij staan de linkercel en de rechtercel direct na elkaar in de DOM.
 *
 * De browser-native selectie (window.getSelection) loopt in DOM-volgorde en
 * pakt ALLE knopen tussen anker en focus. Sleep je in de rechterkolom van
 * onder naar boven, dan liggen de linkercellen van tussenliggende rijen in de
 * DOM tussen anker en focus en kleuren die dus ook blauw — de gerapporteerde
 * bug.
 *
 * AANPAK (conservatief, heuristiek-vrij waar mogelijk)
 * Bij het starten van een sleep bepalen we de "kolom-band": de horizontale
 * strook rond het startpunt. Dit doen we LOKAAL op basis van de tekstregel
 * onder de cursor. Alleen wanneer die regel duidelijk uit meerdere
 * kolom-clusters bestaat (een tabelrij), beperken we de selectie tot de
 * cluster van het startpunt door de spans buiten de band tijdelijk
 * `user-select: none` te geven. Bij een gewone tekststroom (één cluster op de
 * regel, zoals een brief) doen we NIETS — geen risico op het inperken van
 * legitieme selecties.
 *
 * De begrenzing is puur visueel/gedrag en raakt de DOM-volgorde of
 * data-attributen niet, zodat zoeken, tekst-bewerken, markup (quadPoints) en
 * het rechtsklikmenu ongemoeid blijven.
 */

import { weergaveRotatie } from '../pdf/weergave-ruimte.js';
import { naarPagina, rectNaarPagina, weergaveMaat } from '../pdf/weergave-rotatie.js';

/**
 * De kolom-band rekent met horizontale tekstregels. Is de weergave gedraaid
 * (#200), dan staan die regels op het scherm verticaal of op hun kop; reken
 * dan terug naar de stand van de pagina zelf (in schermpixels, zonder schaal).
 * @param {DOMRect} layerRect
 * @returns {{r:number, b:number, h:number}|null} null = ongedraaid
 */
function leesstand(layerRect) {
  const r = weergaveRotatie();
  if (!r) return null;
  const pag = weergaveMaat(layerRect.width, layerRect.height, r);
  return { r, b: pag.breedte, h: pag.hoogte };
}

/**
 * Leest de geometrie van een tekstlaag-span uit t.o.v. de tekstlaag.
 * @param {HTMLElement} span
 * @param {DOMRect} layerRect - getBoundingClientRect() van de .textLayer
 * @param {{r:number, b:number, h:number}|null} [stand] - zie leesstand()
 * @returns {{left:number, right:number, top:number, bottom:number, cx:number, cy:number, h:number}}
 */
function spanGeom(span, layerRect, stand = null) {
  const r = span.getBoundingClientRect();
  let vak = { x: r.left - layerRect.left, y: r.top - layerRect.top, width: r.width, height: r.height };
  if (stand) vak = rectNaarPagina(vak, stand.b, stand.h, stand.r);
  return {
    left: vak.x,
    right: vak.x + vak.width,
    top: vak.y,
    bottom: vak.y + vak.height,
    cx: vak.x + vak.width / 2,
    cy: vak.y + vak.height / 2,
    h: vak.height,
  };
}

/**
 * Bepaalt de horizontale kolom-band rond een startpunt binnen een tekstlaag.
 *
 * @param {Array<{left:number,right:number,top:number,bottom:number,cx:number,cy:number,h:number}>} spans
 *        Geometrie van alle zichtbare spans (t.o.v. de tekstlaag).
 * @param {number} startX - X van het startpunt (t.o.v. de tekstlaag).
 * @param {number} startY - Y van het startpunt (t.o.v. de tekstlaag).
 * @returns {{lo:number, hi:number}|null} De band [lo,hi] in tekstlaag-X, of
 *          null wanneer er geen betrouwbare meerkoloms-context is (geen
 *          begrenzing toepassen).
 */
export function computeColumnBand(spans, startX, startY) {
  if (!spans || spans.length === 0) return null;

  // 1) Bepaal een representatieve regelhoogte rond het startpunt.
  //    Gebruik de mediane hoogte van spans dicht bij startY.
  const near = spans.filter(s => Math.abs(s.cy - startY) <= Math.max(s.h, 4) * 1.5);
  const heights = (near.length ? near : spans).map(s => s.h).sort((a, b) => a - b);
  const rowH = heights[Math.floor(heights.length / 2)] || 12;

  // 2) Verzamel de spans op DEZELFDE tekstregel als het startpunt
  //    (verticaal centrum binnen ~0.7 regelhoogte van startY).
  const rowTol = rowH * 0.7;
  const row = spans
    .filter(s => Math.abs(s.cy - startY) <= rowTol)
    .sort((a, b) => a.left - b.left);
  if (row.length === 0) return null;

  // 3) Cluster de regel op horizontale gaten > 2x regelhoogte.
  //    Grote gaten = kolomgrenzen (tabel). Kleine gaten = spaties/woorden.
  const gapThresh = rowH * 2;
  const clusters = [];
  let cur = [row[0]];
  for (let i = 1; i < row.length; i++) {
    const gap = row[i].left - cur[cur.length - 1].right;
    if (gap > gapThresh) {
      clusters.push(cur);
      cur = [row[i]];
    } else {
      cur.push(row[i]);
    }
  }
  clusters.push(cur);

  // 4) Eén cluster => gewone tekststroom => geen begrenzing.
  if (clusters.length <= 1) return null;

  // 5) Zoek de cluster die het startpunt bevat (met kleine marge). Valt het
  //    startpunt in een gat tussen clusters, kies de dichtstbijzijnde.
  let idx = clusters.findIndex(cl =>
    startX >= cl[0].left - gapThresh * 0.5 &&
    startX <= cl[cl.length - 1].right + gapThresh * 0.5
  );
  if (idx < 0) {
    // dichtstbijzijnde cluster op X
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      const mid = (cl[0].left + cl[cl.length - 1].right) / 2;
      const d = Math.abs(mid - startX);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    idx = best;
  }

  const c = clusters[idx];
  const lo = idx > 0
    ? (clusters[idx - 1][clusters[idx - 1].length - 1].right + c[0].left) / 2
    : -Infinity;
  const hi = idx < clusters.length - 1
    ? (c[c.length - 1].right + clusters[idx + 1][0].left) / 2
    : Infinity;

  return { lo, hi };
}

/**
 * Berekent de band en past hem toe: spans waarvan het horizontale centrum
 * buiten [lo,hi] valt, krijgen tijdelijk `user-select: none`, zodat de
 * native selectie ze niet meepakt tijdens de sleep. Reeds bestaande inline
 * user-select-waarden worden onthouden en bij clear hersteld.
 *
 * @param {HTMLElement} textLayer - de .textLayer waarin de sleep begon
 * @param {number} clientX - schermcoördinaat van drag-start
 * @param {number} clientY - schermcoördinaat van drag-start
 * @returns {Array<HTMLElement>} de spans die begrensd zijn (voor herstel)
 */
export function applyBandRestriction(textLayer, clientX, clientY) {
  if (!textLayer) return [];
  const layerRect = textLayer.getBoundingClientRect();
  const spanEls = Array.from(
    textLayer.querySelectorAll('span:not(.markedContent)')
  ).filter(s => s.firstChild); // alleen spans met tekst

  if (spanEls.length === 0) return [];

  // Defensief: ruim eventuele achtergebleven begrenzing van een eerdere,
  // niet-afgesloten sleep op (bv. mouseup buiten het venster gemist).
  textLayer.querySelectorAll('span[data-sel-guard-prev]').forEach(el => {
    el.style.userSelect = el.dataset.selGuardPrev || '';
    el.style.webkitUserSelect = el.dataset.selGuardPrev || '';
    delete el.dataset.selGuardPrev;
  });

  const stand = leesstand(layerRect);
  const geoms = spanEls.map(s => spanGeom(s, layerRect, stand));
  const start = stand
    ? naarPagina(clientX - layerRect.left, clientY - layerRect.top, stand.b, stand.h, stand.r)
    : { x: clientX - layerRect.left, y: clientY - layerRect.top };
  const startX = start.x;
  const startY = start.y;

  const band = computeColumnBand(geoms, startX, startY);
  if (!band) return [];

  const restricted = [];
  for (let i = 0; i < spanEls.length; i++) {
    const g = geoms[i];
    if (g.cx < band.lo || g.cx >= band.hi) {
      const el = spanEls[i];
      // onthoud de vorige inline waarde om exact te herstellen
      el.dataset.selGuardPrev = el.style.userSelect || '';
      el.style.userSelect = 'none';
      el.style.webkitUserSelect = 'none';
      restricted.push(el);
    }
  }
  return restricted;
}

/**
 * Heft de tijdelijke user-select-begrenzing weer op.
 * @param {Array<HTMLElement>} restricted
 */
export function clearBandRestriction(restricted) {
  if (!restricted) return;
  for (const el of restricted) {
    const prev = el.dataset.selGuardPrev;
    el.style.userSelect = prev || '';
    el.style.webkitUserSelect = prev || '';
    delete el.dataset.selGuardPrev;
  }
}
