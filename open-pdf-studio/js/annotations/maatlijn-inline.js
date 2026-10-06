// Een maat met het bijschrift IN de lijn (PDF /CP /Inline, "the caption shall
// be centered inside the line"), zoals maten uit andere programma's die de
// lader overneemt (dimTextPosition 'inline', zie
// pdf/loader/maatlijn-uit-bestand.js).
//
// Puur, zonder canvas: het scherm (rendering/maat-inline-tekenen.js) en de
// opgeslagen appearance (saver/appearance-vectors.js) tekenen dezelfde
// lijnstukken, punten en tekstplek.
//
// De regels volgen de appearance van zo'n maat:
//   - de punten liggen één lijndikte binnen de eindpunten van het model (die
//     op de hulplijnen liggen): de verstekpunt van een omlijnde pijl steekt
//     precies één lijndikte voorbij zijn tip en raakt zo de hulplijn;
//   - de lijn is onderbroken over tekstbreedte + 1 pt, midden tussen de
//     punten, en de tekst staat midden op de lijn;
//   - past dat niet (twee punten + onderbreking langer dan de lijn), dan
//     staan de punten buiten de hulplijnen, naar binnen gericht, met een
//     staart naar buiten, en staat de tekst naast de lijn.

import { leesbareHoek } from './maat-label.js';

/** Extra ruimte in de onderbreking naast de tekstbreedte (pt). */
export const INLINE_MARGE = 1;

/** Hoofdletterhoogte van Helvetica/Arial als deel van de lettergrootte. */
export const HOOFDLETTER_HOOGTE = 0.718;

/** Afstand van de tekst tot de lijn bij een korte maat, x lettergrootte (12,1 pt bij 9 pt). */
export const KORTE_MAAT_TEKSTAFSTAND = 1.35;

// Breedtes van Helvetica (= Arial) per teken 32..126, in 1/1000 em.
const BREEDTES = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Breedte van een tekst in Helvetica/Arial (pt). Onbekende tekens tellen als een cijfer. */
export function helveticaBreedte(tekst, fontSize) {
  const fs = Number(fontSize) > 0 ? Number(fontSize) : 0;
  let som = 0;
  for (const teken of String(tekst ?? '')) {
    const c = teken.codePointAt(0);
    som += (c >= 32 && c <= 126) ? BREEDTES[c - 32] : 556;
  }
  return som * fs / 1000;
}

const isKop = (stijl) => !!stijl && stijl !== 'none';

/**
 * @param {object} o  startX/Y, endX/Y (maatlijn, eindpunten op de hulplijnen),
 *   leaderStartX/Y en leaderEndX/Y (gemeten punten, optioneel), lineWidth,
 *   headSize, startHead, endHead, tekstBreedte (pt), fontSize, tekstOffsetX/Y
 *   (verschoven tekst) en draaiing (radialen: hoe de weergave gedraaid is
 *   t.o.v. deze coördinaten, voor de leesrichting; 0 op het scherm).
 * @returns {{ lijnstukken: Array<{x1,y1,x2,y2}>,
 *   koppen: Array<{x, y, hoek, stijl}>, tekst: {x, y, hoek}, buiten: boolean }}
 *   `hoek` van een kop is de richting waarin zijn tip wijst; de tekst heeft
 *   zijn midden (hoofdletterhoogte) op x/y.
 */
export function inlineMaatlijn(o = {}) {
  const sx = o.startX, sy = o.startY, ex = o.endX, ey = o.endY;
  const lengte = Math.hypot(ex - sx, ey - sy);
  const lijnhoek = Math.atan2(ey - sy, ex - sx);
  const u = lengte > 1e-9 ? { x: (ex - sx) / lengte, y: (ey - sy) / lengte } : { x: 1, y: 0 };
  const n = { x: -u.y, y: u.x };
  const w = Number(o.lineWidth) > 0 ? Number(o.lineWidth) : 0;
  const kop = Number(o.headSize) > 0 ? Number(o.headSize) : 0;
  const kopBegin = isKop(o.startHead) ? kop : 0;
  const kopEind = isKop(o.endHead) ? kop : 0;
  const tb = Number(o.tekstBreedte) > 0 ? Number(o.tekstBreedte) : 0;
  const fs = Number(o.fontSize) > 0 ? Number(o.fontSize) : 11;
  const onderbreking = tb > 0 ? tb + INLINE_MARGE : 0;
  const draaiing = Number(o.draaiing) || 0;
  const ox = Number(o.tekstOffsetX) || 0, oy = Number(o.tekstOffsetY) || 0;
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const tekstHoek = leesbareHoek(lijnhoek + draaiing) - draaiing;
  const p = (x, y, t) => ({ x: x + u.x * t, y: y + u.y * t });

  const buiten = kopBegin + kopEind + onderbreking > lengte - 2 * w;
  if (buiten) {
    // Punten één lijndikte buiten de hulplijnen, naar binnen gericht; de
    // staart (twee zijden van de punt plus een lijndikte) loopt naar buiten.
    const t1 = p(sx, sy, -w), t2 = p(ex, ey, w);
    const staart = 2 * Math.max(kopBegin, kopEind) / Math.cos(Math.PI / 6) + w;
    const lijnstukken = [
      { x1: t1.x - u.x * staart, y1: t1.y - u.y * staart, x2: t1.x, y2: t1.y },
      { x1: t2.x, y1: t2.y, x2: t2.x + u.x * staart, y2: t2.y + u.y * staart },
    ];
    const koppen = [];
    if (kopBegin) koppen.push({ x: t1.x, y: t1.y, hoek: lijnhoek, stijl: o.startHead });
    if (kopEind) koppen.push({ x: t2.x, y: t2.y, hoek: lijnhoek + Math.PI, stijl: o.endHead });
    // De tekst naast de lijn, aan de kant die van het gemeten punt af ligt
    // (zonder hulplijnen: boven de leesbare tekst).
    let kant;
    if (Number.isFinite(o.leaderStartX) && Number.isFinite(o.leaderStartY)) {
      const d = (sx - o.leaderStartX) * n.x + (sy - o.leaderStartY) * n.y;
      kant = Math.abs(d) > 1e-9 ? Math.sign(d) : 1;
    } else {
      const boven = { x: Math.sin(tekstHoek), y: -Math.cos(tekstHoek) };
      kant = (boven.x * n.x + boven.y * n.y) >= 0 ? 1 : -1;
    }
    const afstand = KORTE_MAAT_TEKSTAFSTAND * fs;
    return {
      lijnstukken, koppen, buiten: true,
      tekst: { x: mx + n.x * kant * afstand + ox, y: my + n.y * kant * afstand + oy, hoek: tekstHoek },
    };
  }

  const t1 = p(sx, sy, w), t2 = p(ex, ey, -w);
  const koppen = [];
  if (kopBegin) koppen.push({ x: t1.x, y: t1.y, hoek: lijnhoek + Math.PI, stijl: o.startHead });
  if (kopEind) koppen.push({ x: t2.x, y: t2.y, hoek: lijnhoek, stijl: o.endHead });
  // De onderbreking ligt onder de tekst: langs de lijn verschoven met de
  // tekst mee. Staat de tekst er (versleept) naast, dan blijft de lijn heel.
  const langs = ox * u.x + oy * u.y;
  const dwars = ox * n.x + oy * n.y;
  const binnen = lengte - 2 * w;
  let lijnstukken = [{ x1: t1.x, y1: t1.y, x2: t2.x, y2: t2.y }];
  if (onderbreking > 0 && Math.abs(dwars) <= fs * HOOFDLETTER_HOOGTE) {
    const midden = binnen / 2 + langs;
    const a = Math.max(0, Math.min(binnen, midden - onderbreking / 2));
    const b = Math.max(0, Math.min(binnen, midden + onderbreking / 2));
    lijnstukken = [];
    if (a > 0) lijnstukken.push({ x1: t1.x, y1: t1.y, x2: t1.x + u.x * a, y2: t1.y + u.y * a });
    if (b < binnen) lijnstukken.push({ x1: t1.x + u.x * b, y1: t1.y + u.y * b, x2: t2.x, y2: t2.y });
  }
  return { lijnstukken, koppen, buiten: false, tekst: { x: mx + ox, y: my + oy, hoek: tekstHoek } };
}
