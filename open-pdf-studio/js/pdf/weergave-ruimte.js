// Weergave draaien (#200): de koppeling tussen scherm en pagina voor de app.
//
// De weergaverotatie hoort bij het document (per tabblad), niet bij de PDF:
// doc.viewRotation. Hij verandert niets aan het document, staat niet in de
// ongedaan-maakgeschiedenis en wordt niet opgeslagen. Annotaties blijven in de
// paginaruimte; alleen de weg tussen scherm en pagina draait mee.
//
// Elke omrekening tussen een schermpositie (clientX/Y, een DOM-rechthoek) en
// een paginapositie hoort via deze module te gaan. Zo is er één plek die weet
// hoe de pagina op het scherm ligt, in elke weergave:
//  - enkele pagina via de viewport: scherm = canvas + verschuiving + zoom · weergavepunt
//  - enkele pagina zonder viewport (PDF.js tekent): scherm = canvas + schaal · weergavepunt
//  - doorlopend/boek/naast elkaar: scherm = paginacontainer + schaal · weergavepunt
// Het rekenwerk zelf staat in weergave-rotatie.js.

import { getActiveDocument } from '../core/state.js';
import {
  normaliseerRotatie,
  isKwartslag,
  naarPagina,
  naarWeergave,
  rectNaarPagina,
  rectNaarWeergave,
  vectorNaarPagina,
  vectorNaarWeergave,
  weergaveMatrix,
  viewportGeometrie,
} from './weergave-rotatie.js';

/** De weergaverotatie van een document (standaard het actieve): 0/90/180/270. */
export function weergaveRotatie(doc = getActiveDocument()) {
  return normaliseerRotatie(doc?.viewRotation);
}

function viewportVoor(doc) {
  const vp = typeof window !== 'undefined' ? window.__pdfViewport : null;
  // Zelfde poort als overal: de viewport tekent alleen documenten met een pad.
  return vp && vp.active && doc?.filePath ? vp : null;
}

/**
 * Maat van pagina `pageNum` in de paginaruimte (punten): na de eigen /Rotate
 * van de PDF en de paginarotatie van het document. null als onbekend.
 * @returns {{breedte: number, hoogte: number} | null}
 */
export function paginaMaat(pageNum, doc = getActiveDocument()) {
  if (!doc) return null;
  const dims = doc.pageDims?.[pageNum];
  const w = Number(dims?.widthPt);
  const h = Number(dims?.heightPt);
  if (w > 0 && h > 0) {
    const totaal = normaliseerRotatie((Number(dims.rotation) || 0) + (Number(doc.pageRotations?.[pageNum]) || 0));
    return isKwartslag(totaal) ? { breedte: h, hoogte: w } : { breedte: w, hoogte: h };
  }
  const vp = viewportVoor(doc);
  if (vp && vp.pageNum === pageNum && vp.pageW > 0 && vp.pageH > 0) {
    const g = viewportGeometrie(vp);
    return { breedte: g.paginaBreedte, hoogte: g.paginaHoogte };
  }
  // Doorlopend: de wrapper kent de weergavemaat op schaal 1; terugdraaien.
  if (typeof document !== 'undefined') {
    const wrapper = document.querySelector(`#continuous-container .page-wrapper[data-page="${pageNum}"]`);
    const bw = parseFloat(wrapper?.dataset?.baseW);
    const bh = parseFloat(wrapper?.dataset?.baseH);
    if (bw > 0 && bh > 0) {
      return isKwartslag(weergaveRotatie(doc)) ? { breedte: bh, hoogte: bw } : { breedte: bw, hoogte: bh };
    }
  }
  return null;
}

/** Punt in weergaveruimte (punten vanaf linksboven van de getoonde pagina) → paginaruimte. */
export function weergaveNaarPagina(pageNum, u, v, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  const m = r ? paginaMaat(pageNum, doc) : null;
  return m ? naarPagina(u, v, m.breedte, m.hoogte, r) : { x: u, y: v };
}

/** Punt in paginaruimte → weergaveruimte. */
export function paginaNaarWeergave(pageNum, x, y, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  const m = r ? paginaMaat(pageNum, doc) : null;
  return m ? naarWeergave(x, y, m.breedte, m.hoogte, r) : { x, y };
}

/** Rechthoek {x, y, width, height} in weergaveruimte → paginaruimte. */
export function weergaveRectNaarPagina(pageNum, rect, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  const m = r ? paginaMaat(pageNum, doc) : null;
  return m ? rectNaarPagina(rect, m.breedte, m.hoogte, r) : { ...rect };
}

/** Rechthoek in paginaruimte → weergaveruimte. */
export function paginaRectNaarWeergave(pageNum, rect, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  const m = r ? paginaMaat(pageNum, doc) : null;
  return m ? rectNaarWeergave(rect, m.breedte, m.hoogte, r) : { ...rect };
}

/** Verplaatsing op het scherm (weergaveruimte) → paginaruimte. */
export function weergaveVectorNaarPagina(du, dv, doc = getActiveDocument()) {
  return vectorNaarPagina(du, dv, weergaveRotatie(doc));
}

/** Verplaatsing in paginaruimte → weergaveruimte. */
export function paginaVectorNaarWeergave(dx, dy, doc = getActiveDocument()) {
  return vectorNaarWeergave(dx, dy, weergaveRotatie(doc));
}

/**
 * Matrix paginaruimte → weergaveruimte voor een canvas dat de pagina in
 * weergavepunten tekent (na ctx.scale en een eventuele uitsnede-translate).
 * null zonder rotatie of zonder bekende paginamaat.
 */
export function weergaveTransform(pageNum, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  if (!r) return null;
  const m = paginaMaat(pageNum, doc);
  return m ? weergaveMatrix(m.breedte, m.hoogte, r) : null;
}

/**
 * Waar staat de linkerbovenhoek van de getoonde pagina op het scherm, en met
 * welke schaal (CSS-px per weergavepunt)? null als de pagina niet getoond wordt.
 * @returns {{links: number, boven: number, schaal: number} | null}
 */
export function paginaOorsprong(pageNum, doc = getActiveDocument()) {
  if (typeof document === 'undefined' || !doc) return null;
  if (doc.viewMode === 'continuous') {
    const cc = document.querySelector(`#continuous-container .page-wrapper[data-page="${pageNum}"] .canvas-container-cont`);
    if (!cc) return null;
    const r = cc.getBoundingClientRect();
    return { links: r.left, boven: r.top, schaal: Number(doc.scale) || 1 };
  }
  const canvas = document.getElementById('annotation-canvas');
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const vp = viewportVoor(doc);
  if (vp) return { links: r.left + vp.offsetX, boven: r.top + vp.offsetY, schaal: vp.zoom || 1 };
  return { links: r.left, boven: r.top, schaal: Number(doc.scale) || 1.5 };
}

/** Schermpositie (clientX/Y) → paginaruimte. null als de pagina niet getoond wordt. */
export function clientNaarPagina(pageNum, clientX, clientY, doc = getActiveDocument()) {
  const o = paginaOorsprong(pageNum, doc);
  if (!o) return null;
  return weergaveNaarPagina(pageNum, (clientX - o.links) / o.schaal, (clientY - o.boven) / o.schaal, doc);
}

/** Paginaruimte → schermpositie (clientX/Y). null als de pagina niet getoond wordt. */
export function paginaNaarClient(pageNum, x, y, doc = getActiveDocument()) {
  const o = paginaOorsprong(pageNum, doc);
  if (!o) return null;
  const w = paginaNaarWeergave(pageNum, x, y, doc);
  return { x: o.links + w.x * o.schaal, y: o.boven + w.y * o.schaal };
}

/**
 * Rechthoek in schermcoördinaten (bv. een DOMRect uit getClientRects) →
 * paginaruimte. Een kwartslag houdt hem recht, dus dit is exact.
 */
export function clientRectNaarPagina(pageNum, rect, doc = getActiveDocument()) {
  const o = paginaOorsprong(pageNum, doc);
  if (!o) return null;
  const inWeergave = {
    x: (rect.left - o.links) / o.schaal,
    y: (rect.top - o.boven) / o.schaal,
    width: rect.width / o.schaal,
    height: rect.height / o.schaal,
  };
  return weergaveRectNaarPagina(pageNum, inWeergave, doc);
}

/** Rechthoek in paginaruimte → schermrechthoek {left, top, width, height}. */
export function paginaRectNaarClient(pageNum, rect, doc = getActiveDocument()) {
  const o = paginaOorsprong(pageNum, doc);
  if (!o) return null;
  const w = paginaRectNaarWeergave(pageNum, rect, doc);
  return {
    left: o.links + w.x * o.schaal,
    top: o.boven + w.y * o.schaal,
    width: w.width * o.schaal,
    height: w.height * o.schaal,
  };
}

/**
 * Tekenhulp voor schermteksten (tooltips, snaplabels) die in de paginaruimte
 * getekend worden: draait de context rond het punt (x, y) terug over de
 * weergaverotatie, zodat de tekst rechtop op het scherm staat en een
 * verschuiving als "rechtsonder van de cursor" ook op het scherm klopt.
 * Aanroepen binnen ctx.save()/ctx.restore().
 * @returns {boolean} of er gedraaid is
 */
export function zetRechtopRond(ctx, x, y, doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  if (!r || !ctx) return false;
  ctx.translate(x, y);
  ctx.rotate((-r * Math.PI) / 180);
  ctx.translate(-x, -y);
  return true;
}

/**
 * Rotatie (graden, rechtsom) waarmee een NIEUWE tekst- of beeldannotatie
 * (tekstvak, stempel, geplakte afbeelding) rechtop op het scherm staat in een
 * gedraaide weergave: het tegendeel van de weergaverotatie. Zo ziet wat de
 * gebruiker plaatst eruit zoals in een ongedraaide weergave. 0 zonder
 * weergaverotatie.
 */
export function rechtopRotatie(doc = getActiveDocument()) {
  const r = weergaveRotatie(doc);
  return r ? 360 - r : 0;
}
