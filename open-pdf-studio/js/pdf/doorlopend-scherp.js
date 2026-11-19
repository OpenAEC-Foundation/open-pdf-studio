// Scherpe uitsnede van een pagina in de doorlopende weergave (#1163).
//
// Een pagina waarvan het beeld op apparaatresolutie niet binnen de as-cap
// past, kreeg een bitmap op de grootste schaal die wel past en CSS rekte de
// rest op: wazig, en erger naarmate de zoom en het vel groter zijn (een A2 op
// 200% bij 150% schermschaal: 1,22 bitmappixel per CSS-pixel waar 1,5 nodig
// is; een A0 al vanaf ongeveer 60%).
//
// Boven de cap is het paginacanvas daarom geen opgerekt beeld van de hele
// pagina meer, maar een UITSNEDE: het zichtbare deel plus een marge, op volle
// apparaatresolutie, met left/top/width/height op zijn plek in de
// paginacontainer gezet. Eronder staat een beeld van de hele pagina op lage
// resolutie als achtergrond van de container, zodat een net in beeld
// geschoven deel de wazige pagina toont in plaats van wit tot de nieuwe
// uitsnede er is. Er komt geen element en geen laag bij: het is hetzelfde
// canvas, kleiner dan voorheen.
//
// Dit bestand is de meetkunde: welke uitsnede bij een venster hoort, hoe die
// binnen de pagina en binnen de cap blijft, wanneer een bestaande uitsnede
// nog volstaat en hoe ze bij een gedraaide pagina aan de tekenmachine wordt
// gevraagd. Puur, zodat het onder node te testen is.
//
// Alle rechthoeken zijn { x, y, breedte, hoogte } in CSS-pixels ten opzichte
// van de linkerbovenhoek van de pagina zoals die op het scherm ligt.

/** Marge rond het zichtbare deel, als deel van de vensterafmeting. */
export const SCHERP_MARGE_DEEL = 0.10;
/** Ondergrens van de marge voor kleine zichtbare paginadelen (CSS-px). */
export const SCHERP_MARGE_MIN_PX = 64;
/** Bovengrens op het aantal pixels van één uitsnede (48 MB RGBA). */
export const SCHERP_MAX_PIXELS = 12_000_000;

/**
 * Past de hele pagina op apparaatresolutie binnen de as-cap? Zo niet, dan
 * hoort er een scherpe uitsnede. Zelfde grens als continuousRenderScale().
 * @param {{breedte:number, hoogte:number, dpr:number, maxAs:number}} o
 *   breedte/hoogte: de pagina in CSS-px op de huidige zoom
 */
export function scherpeUitsnedeNodig({ breedte, hoogte, dpr, maxAs }) {
  const factor = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const as = Math.max(breedte, hoogte) * factor;
  return Number.isFinite(as) && as > maxAs;
}

/**
 * Het deel van de pagina dat in het venster staat, of null als de pagina
 * buiten beeld ligt.
 * @param {{left:number, top:number, right:number, bottom:number}} venster
 *   rechthoek van de scrollcontainer (getBoundingClientRect)
 * @param {{left:number, top:number, width:number, height:number}} pagina
 *   rechthoek van de paginacontainer (getBoundingClientRect)
 * @param {number} breedte  doelbreedte van de pagina in CSS-px
 * @param {number} hoogte   doelhoogte van de pagina in CSS-px
 */
export function zichtbaarDeel(venster, pagina, breedte, hoogte) {
  if (!venster || !pagina || !(pagina.width > 1) || !(pagina.height > 1)) return null;
  if (!(breedte > 0) || !(hoogte > 0)) return null;
  // Verhouding huidige rechthoek <-> doelmaat (de pagina kan net geresized zijn).
  const fx = breedte / pagina.width;
  const fy = hoogte / pagina.height;
  const links = Math.max(0, (venster.left - pagina.left) * fx);
  const boven = Math.max(0, (venster.top - pagina.top) * fy);
  const rechts = Math.min(breedte, (venster.right - pagina.left) * fx);
  const onder = Math.min(hoogte, (venster.bottom - pagina.top) * fy);
  if (!(rechts - links > 0.5) || !(onder - boven > 0.5)) return null;
  return { x: links, y: boven, breedte: rechts - links, hoogte: onder - boven };
}

/**
 * De uitsnede bij een zichtbaar deel: dat deel plus een marge, binnen de
 * pagina, binnen de as-cap en binnen het pixelbudget, op hele
 * apparaatpixels. Past het zichtbare deel met marge niet, dan krimpt eerst
 * de marge; past het zichtbare deel zelf niet (een heel groot venster), dan
 * daalt de resolutie (`pxPerCss` < dpr) zodat het venster gedekt blijft.
 *
 * @param {{x:number, y:number, breedte:number, hoogte:number}} zichtbaar
 * @param {number} breedte  de pagina in CSS-px
 * @param {number} hoogte
 * @param {{dpr:number, maxAs:number, maxPixels?:number, margeDeel?:number, margeMin?:number}} o
 * @returns {{x:number, y:number, breedte:number, hoogte:number, pxPerCss:number,
 *   bitmapB:number, bitmapH:number} | null}
 */
export function scherpeUitsnede(zichtbaar, breedte, hoogte, {
  dpr, maxAs, maxPixels = SCHERP_MAX_PIXELS, margeDeel = SCHERP_MARGE_DEEL, margeMin = SCHERP_MARGE_MIN_PX,
} = {}) {
  if (!zichtbaar || !(zichtbaar.breedte > 0) || !(zichtbaar.hoogte > 0)) return null;
  if (!(breedte > 0) || !(hoogte > 0) || !(maxAs > 0)) return null;
  const vol = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  // Resolutie: vol, tenzij het zichtbare deel zelf al niet past.
  let pxPerCss = Math.min(
    vol,
    maxAs / zichtbaar.breedte,
    maxAs / zichtbaar.hoogte,
    Math.sqrt(maxPixels / (zichtbaar.breedte * zichtbaar.hoogte)),
  );
  if (!(pxPerCss > 0)) return null;
  if (pxPerCss > vol * (1 - 1e-9)) pxPerCss = vol;

  // Marge: gevraagd, daarna gekrompen tot as-cap en pixelbudget het toelaten.
  const maxB = maxAs / pxPerCss;
  const maxH = maxAs / pxPerCss;
  let mx = Math.max(margeMin, zichtbaar.breedte * margeDeel);
  let my = Math.max(margeMin, zichtbaar.hoogte * margeDeel);
  mx = Math.max(0, Math.min(mx, (maxB - zichtbaar.breedte) / 2));
  my = Math.max(0, Math.min(my, (maxH - zichtbaar.hoogte) / 2));
  const oppervlak = (a, b) => (zichtbaar.breedte + 2 * a) * (zichtbaar.hoogte + 2 * b) * pxPerCss * pxPerCss;
  if (oppervlak(mx, my) > maxPixels) {
    // Beide marges met dezelfde factor omlaag (tweedelingszoeken: monotoon).
    let laag = 0;
    let hoog = 1;
    for (let i = 0; i < 24; i++) {
      const midden = (laag + hoog) / 2;
      if (oppervlak(mx * midden, my * midden) > maxPixels) hoog = midden; else laag = midden;
    }
    mx *= laag;
    my *= laag;
  }

  // Binnen de pagina, op hele apparaatpixels: naar buiten afronden zodat het
  // zichtbare deel gedekt blijft, en daarna aan de paginarand afknippen.
  const px = (v) => v * pxPerCss;
  const paginaB = Math.ceil(px(breedte) - 1e-6);
  const paginaH = Math.ceil(px(hoogte) - 1e-6);
  const x0 = Math.max(0, Math.floor(px(zichtbaar.x - mx) + 1e-6));
  const y0 = Math.max(0, Math.floor(px(zichtbaar.y - my) + 1e-6));
  const x1 = Math.min(paginaB, Math.ceil(px(zichtbaar.x + zichtbaar.breedte + mx) - 1e-6));
  const y1 = Math.min(paginaH, Math.ceil(px(zichtbaar.y + zichtbaar.hoogte + my) - 1e-6));
  const capAs = Math.floor(maxAs);
  const bitmapB = Math.min(capAs, x1 - x0);
  const bitmapH = Math.min(capAs, y1 - y0);
  if (!(bitmapB > 0) || !(bitmapH > 0)) return null;
  return {
    x: x0 / pxPerCss,
    y: y0 / pxPerCss,
    breedte: bitmapB / pxPerCss,
    hoogte: bitmapH / pxPerCss,
    pxPerCss,
    bitmapB,
    bitmapH,
  };
}

/**
 * Dekt een bestaande uitsnede het zichtbare deel nog? Dan hoeft er niets
 * opnieuw getekend te worden.
 * @param {{x:number, y:number, breedte:number, hoogte:number} | null} uitsnede
 * @param {{x:number, y:number, breedte:number, hoogte:number} | null} zichtbaar
 * @param {number} [speling] CSS-px die aan een rand mag ontbreken
 */
export function uitsnedeVolstaat(uitsnede, zichtbaar, speling = 0.75) {
  if (!uitsnede || !zichtbaar) return false;
  return uitsnede.x <= zichtbaar.x + speling
    && uitsnede.y <= zichtbaar.y + speling
    && uitsnede.x + uitsnede.breedte >= zichtbaar.x + zichtbaar.breedte - speling
    && uitsnede.y + uitsnede.hoogte >= zichtbaar.y + zichtbaar.hoogte - speling;
}

/** Het oppervlak dat twee rechthoeken delen (0 als ze elkaar niet raken). */
export function overlapOppervlak(a, b) {
  if (!a || !b) return 0;
  const b0 = Math.min(a.x + a.breedte, b.x + b.breedte) - Math.max(a.x, b.x);
  const h0 = Math.min(a.y + a.hoogte, b.y + b.hoogte) - Math.max(a.y, b.y);
  return b0 > 0 && h0 > 0 ? b0 * h0 : 0;
}

/**
 * Een rechthoek op de gedraaide pagina (zoals ze op het scherm ligt) in de
 * ongedraaide pagina. De tekenmachine tekent uitsnedes alleen ongedraaid; de
 * draaiing gebeurt bij het tekenen op het canvas (zie draaiTransform).
 * @param {{x:number, y:number, breedte:number, hoogte:number}} r
 * @param {number} rotatie  0/90/180/270, rechtsom
 * @param {number} breedte  de gedraaide pagina (zoals op het scherm)
 * @param {number} hoogte
 */
export function naarOngedraaid(r, rotatie, breedte, hoogte) {
  const rot = ((Math.round((Number(rotatie) || 0) / 90) * 90) % 360 + 360) % 360;
  if (rot === 90) return { x: r.y, y: breedte - (r.x + r.breedte), breedte: r.hoogte, hoogte: r.breedte };
  if (rot === 180) return { x: breedte - (r.x + r.breedte), y: hoogte - (r.y + r.hoogte), breedte: r.breedte, hoogte: r.hoogte };
  if (rot === 270) return { x: hoogte - (r.y + r.hoogte), y: r.x, breedte: r.hoogte, hoogte: r.breedte };
  return { x: r.x, y: r.y, breedte: r.breedte, hoogte: r.hoogte };
}

/**
 * De argumenten voor het regio-rendercommando: de uitsnede in de ongedraaide
 * pagina, in pagina-eenheden, en de schaal in bitmappixels per pagina-eenheid.
 * @param {{x:number, y:number, breedte:number, hoogte:number, pxPerCss:number}} uitsnede
 * @param {{schaal:number, rotatie:number, breedte:number, hoogte:number}} o
 *   schaal: CSS-px per pagina-eenheid (de zoom); breedte/hoogte: de pagina in
 *   CSS-px zoals ze op het scherm ligt
 */
export function uitsnedeAanvraag(uitsnede, { schaal, rotatie, breedte, hoogte }) {
  const o = naarOngedraaid(uitsnede, rotatie, breedte, hoogte);
  return {
    scale: schaal * uitsnede.pxPerCss,
    regionXPt: o.x / schaal,
    regionYPt: o.y / schaal,
    regionWPt: o.breedte / schaal,
    regionHPt: o.hoogte / schaal,
  };
}

/**
 * De canvas-transform [a, b, c, d, e, f] die een ongedraaid getekend beeld
 * van bitmapB × bitmapH pixels gedraaid op het canvas zet, en de maat van dat
 * canvas.
 * @param {number} rotatie  0/90/180/270, rechtsom
 * @param {number} bitmapB  het ongedraaide beeld
 * @param {number} bitmapH
 */
export function draaiTransform(rotatie, bitmapB, bitmapH) {
  const rot = ((Math.round((Number(rotatie) || 0) / 90) * 90) % 360 + 360) % 360;
  if (rot === 90) return { breedte: bitmapH, hoogte: bitmapB, matrix: [0, 1, -1, 0, bitmapH, 0] };
  if (rot === 180) return { breedte: bitmapB, hoogte: bitmapH, matrix: [-1, 0, 0, -1, bitmapB, bitmapH] };
  if (rot === 270) return { breedte: bitmapH, hoogte: bitmapB, matrix: [0, -1, 1, 0, 0, bitmapB] };
  return { breedte: bitmapB, hoogte: bitmapH, matrix: [1, 0, 0, 1, 0, 0] };
}

/**
 * Een uitsnede meegeschaald met een zoomgebaar: plek en maat schalen mee met
 * de pagina, de bitmap blijft wat hij was (tijdelijk opgerekt).
 */
export function schaalUitsnede(uitsnede, factor) {
  if (!uitsnede || !(factor > 0)) return uitsnede;
  return {
    ...uitsnede,
    x: uitsnede.x * factor,
    y: uitsnede.y * factor,
    breedte: uitsnede.breedte * factor,
    hoogte: uitsnede.hoogte * factor,
    pxPerCss: uitsnede.pxPerCss / factor,
  };
}

/**
 * Hoort dit beeld bij deze aanvraag? De tekenmachine rondt de maat naar boven
 * af; meer dan een paar pixels verschil betekent een ander beeld (een andere
 * pagina-eenheid, een afgekapte regio) en dat mag niet op het scherm.
 */
export function beeldPastBijAanvraag(beeldB, beeldH, bitmapB, bitmapH, speling = 2) {
  return Math.abs(beeldB - bitmapB) <= speling && Math.abs(beeldH - bitmapH) <= speling;
}

/**
 * Sleutel van alles wat een uitsnede ongeldig maakt behalve haar plek: zoom,
 * schermschaal, draaiing en lijnstand.
 */
export function uitsnedeSleutel({ schaal, dpr, rotatie, dunneLijnen }) {
  return `${Math.round(schaal * 100000)}|${Math.round((dpr || 1) * 1000)}|${rotatie || 0}|${dunneLijnen ? 'dun' : 'vol'}`;
}

/**
 * De maat van het achtergrondbeeld: de hele pagina binnen `maxAs` op de
 * langste as, nooit groter dan de bron.
 */
export function achtergrondMaat(bronB, bronH, maxAs) {
  if (!(bronB > 0) || !(bronH > 0)) return null;
  const f = Math.min(1, maxAs / Math.max(bronB, bronH));
  return { breedte: Math.max(1, Math.round(bronB * f)), hoogte: Math.max(1, Math.round(bronH * f)) };
}
