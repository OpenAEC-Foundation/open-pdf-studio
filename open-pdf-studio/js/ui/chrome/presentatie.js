// Presentation view: what full screen shows (decisions in presentatie-beleid.js).
//
// While the window is full screen the working interface is hidden, the
// document shows one page at a time fitted to the screen, the arrow and page
// keys turn the pages, and a small bar at the bottom appears when the mouse
// moves. Leaving full screen puts the view mode and zoom back.

import { weergaveNaam, presentatieActie, doelPagina, isTypend } from './presentatie-beleid.js';

const KLASSE = 'presentation-mode';
const BALK_ZICHTBAAR_MS = 2500;

let actief = false;
let vorige = null;        // { sleutel, weergave, schaal }
let balk = null;
let balkTimer = null;
let pasTimer = null;

const heeftPagina = () => typeof document !== 'undefined' && !!document.documentElement?.classList;

// Een document herkennen zonder op objectgelijkheid te leunen.
const sleutelVan = (doc) => doc?.id ?? doc?.filePath ?? null;

async function renderer() { return import('../../pdf/renderer.js'); }
async function actiefDocument() {
  const { getActiveDocument } = await import('../../core/state.js');
  return getActiveDocument();
}

export function isPresentatie() { return actief; }

/** Eén pagina, passend op het scherm. Ook na een ander tabblad of formaat. */
async function maakPassend() {
  if (!actief) return;
  try {
    const doc = await actiefDocument();
    if (!doc?.pdfDoc) return;
    const r = await renderer();
    if (weergaveNaam(doc) !== 'single') {
      // Onthoud alleen de weergave van het document waarmee de presentatie begon.
      if (!vorige) vorige = { sleutel: sleutelVan(doc), weergave: weergaveNaam(doc), schaal: doc.scale };
      await r.setViewMode('single');
    }
    await r.fitPage();
    werkBalkBij();
  } catch (e) { console.warn('[presentation] fit failed:', e); }
}

function planPassend(ms = 120) {
  clearTimeout(pasTimer);
  pasTimer = setTimeout(maakPassend, ms);
}

async function blader(actie) {
  const doc = await actiefDocument();
  if (!doc?.pdfDoc) return;
  const doel = doelPagina(actie, doc.currentPage, doc.pdfDoc.numPages);
  if (doel === doc.currentPage) return;
  const r = await renderer();
  await r.goToPage(doel);
  // Pagina's kunnen van formaat verschillen: elke pagina opnieuw passend.
  await r.fitPage();
  werkBalkBij();
}

async function dialoogOpen() {
  try {
    const { getDialogs } = await import('../../solid/stores/dialogStore.js');
    return (getDialogs() || []).length > 0;
  } catch { return false; }
}

function opToets(e) {
  if (!actief) return;
  const actie = presentatieActie(e, { typend: isTypend(document.activeElement) });
  if (!actie) return;
  // Synchroon beslissen wie de toets krijgt; een open dialoog houdt hem.
  if (document.querySelector('.modal-overlay, .dialog-overlay, [role="dialog"]')) return;
  e.preventDefault();
  e.stopPropagation();
  dialoogOpen().then((open) => { if (!open) blader(actie); });
}

// --- De balk onderaan -------------------------------------------------------

async function vertaal() {
  try {
    const i18n = (await import('i18next')).default;
    return (k, terugval) => (i18n.exists(k) ? i18n.t(k) : terugval);
  } catch { return (_k, terugval) => terugval; }
}

function knop(tekst, titel, klik) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = tekst;
  b.title = titel;
  b.setAttribute('aria-label', titel);
  b.addEventListener('click', (e) => { e.stopPropagation(); klik(); toonBalk(); });
  return b;
}

async function bouwBalk() {
  if (balk || !heeftPagina()) return;
  const t = await vertaal();
  balk = document.createElement('div');
  balk.className = 'presentation-bar';
  balk.setAttribute('role', 'toolbar');
  const teller = document.createElement('span');
  teller.className = 'presentation-bar-count';
  balk.append(
    knop('◀', t('context:page.previousPage', 'Previous Page'), () => blader('prev')),
    teller,
    knop('▶', t('context:page.nextPage', 'Next Page'), () => blader('next')),
    knop('✕', t('common:close', 'Close'), async () => {
      const fs = await import('./fullscreen.js');
      fs.exitFullscreen();
    }),
  );
  document.body.appendChild(balk);
  werkBalkBij();
}

async function werkBalkBij() {
  if (!balk) return;
  const doc = await actiefDocument();
  const teller = balk.querySelector('.presentation-bar-count');
  if (teller) teller.textContent = doc?.pdfDoc ? `${doc.currentPage} / ${doc.pdfDoc.numPages}` : '';
}

function toonBalk() {
  if (!balk) return;
  balk.classList.add('visible');
  clearTimeout(balkTimer);
  balkTimer = setTimeout(() => balk?.classList.remove('visible'), BALK_ZICHTBAAR_MS);
}

function opMuis() { if (actief) toonBalk(); }
function opFormaat() { if (actief) planPassend(200); }
function opGeladen() { if (actief) planPassend(50); }

// --- Aan en uit -------------------------------------------------------------

export async function zetPresentatie(aan) {
  aan = !!aan;
  if (aan === actief || !heeftPagina()) return;
  actief = aan;
  document.documentElement.classList.toggle(KLASSE, aan);
  if (aan) {
    vorige = null;
    try {
      const doc = await actiefDocument();
      if (doc?.pdfDoc) vorige = { sleutel: sleutelVan(doc), weergave: weergaveNaam(doc), schaal: doc.scale };
    } catch {}
    document.addEventListener('keydown', opToets, true);
    document.addEventListener('mousemove', opMuis);
    document.addEventListener('pdf-loaded', opGeladen);
    window.addEventListener('resize', opFormaat);
    await bouwBalk();
    toonBalk();
    // Het venster groeit nog: nu passend maken en nog eens als het klaar is.
    await maakPassend();
    planPassend(350);
    return;
  }
  document.removeEventListener('keydown', opToets, true);
  document.removeEventListener('mousemove', opMuis);
  document.removeEventListener('pdf-loaded', opGeladen);
  window.removeEventListener('resize', opFormaat);
  clearTimeout(pasTimer);
  clearTimeout(balkTimer);
  balk?.remove();
  balk = null;
  const terug = vorige;
  vorige = null;
  try {
    const doc = await actiefDocument();
    // Alleen terugzetten in het document waar de weergave bij hoort.
    if (terug && doc && sleutelVan(doc) === terug.sleutel && doc.pdfDoc) {
      const r = await renderer();
      if (weergaveNaam(doc) !== terug.weergave) await r.setViewMode(terug.weergave);
      if (Number.isFinite(terug.schaal) && terug.schaal > 0) await r.setZoom(terug.schaal);
    }
  } catch (e) { console.warn('[presentation] restore failed:', e); }
}
