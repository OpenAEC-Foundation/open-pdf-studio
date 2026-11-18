import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { goToPage, setZoom } from './renderer.js';
import { openExtern } from '../core/extern-openen.js';
import {
  destDoelbeeld, isSafeLinkUrl, klemPaginaPlek, paginaPlekInVenster, parseDestinationArray, weergaveMaatVan,
} from './link-destination.js';
import { linkRandStijl } from './link-rand.js';
import { weergaveRotatie } from './weergave-ruimte.js';
import { cssPxPerPtAt100 } from '../core/zoom-display.js';
import { werkelijkeGrootteZoom, kalibratieVoor } from './schermkalibratie.js';
import i18next from '../i18n/config.js';
import { viewportRectangle } from './pdfjs-record.js';

/**
 * Link Layer Management Module
 * Creates clickable link overlays for PDF link annotations
 */

// Store references to link layers for cleanup
const linkLayers = new Map();

// Links van de app (#953) staan als annotatie in het model: de app tekent en
// volgt ze zelf (annotations/link/). Hun klikvlak uit het bestand hoort dan
// niet in deze laag: het zou na verplaatsen of verwijderen op de oude plek
// blijven klikken, en in Selecteren het selecteren blokkeren. Per document de
// pdf.js-id's die ooit als app-link geladen of opgeslagen zijn; een verwijderde
// link blijft erin, zodat zijn oude klikvlak niet terugkomt.
const appLinkIds = new WeakMap();

function appLinksVan(doc) {
  if (!doc) return new Set();
  let ids = appLinkIds.get(doc);
  if (!ids) { ids = new Set(); appLinkIds.set(doc, ids); }
  for (const a of doc.annotations || []) {
    if (a?.type !== 'link') continue;
    if (a.pdfLinkId) ids.add(String(a.pdfLinkId));
    if (a.pdfBron?.ref) ids.add(String(a.pdfBron.ref));
  }
  return ids;
}

/**
 * Haal de klikvlakken van app-links uit de linklagen. Na het laden van de
 * annotaties van een pagina aanroepen: de laag kan eerder klaar zijn.
 * @param {object} [doc]
 * @param {ParentNode} [root]
 */
export function verbergAppLinks(doc = getActiveDocument(), root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const ids = appLinksVan(doc);
  if (ids.size === 0) return;
  root.querySelectorAll('.linkLayer .pdf-link[data-pdf-id]').forEach((el) => {
    if (ids.has(el.dataset.pdfId)) el.remove();
  });
}

/**
 * Gereedschappen waarbij hyperlinks aanklikbaar horen te zijn. De
 * tekengereedschappen en 'editText' hebben de muisgebeurtenissen zelf nodig
 * (annotatie-canvas resp. tekstspans), dus daar staat de linklaag uit.
 * @param {string} [tool]
 * @returns {boolean}
 */
export function linksInteractiveForTool(tool = state.currentTool) {
  return tool === 'select' || tool === 'hand' || tool === 'selectComments';
}

/**
 * Zet pointer-events van link- en formulierlagen goed voor het actieve
 * gereedschap. Wordt zowel na een herrender als bij een gereedschapswissel
 * aangeroepen, zodat beide paden dezelfde regel volgen.
 * @param {ParentNode} [root] Wortel waarbinnen gezocht wordt
 * @param {string} [tool]
 */
export function applyOverlayPointerEvents(root = document, tool = state.currentTool) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const interactive = linksInteractiveForTool(tool);
  root.querySelectorAll('.linkLayer .pdf-link').forEach(el => {
    el.style.pointerEvents = interactive ? 'auto' : 'none';
    // 'inherit' laat de cursor van het gereedschap (kruisdraad) doorkomen.
    el.style.cursor = interactive ? '' : 'inherit';
  });
  root.querySelectorAll('.formLayer section').forEach(el => {
    el.style.pointerEvents = interactive ? '' : 'none';
  });
}

/**
 * Creates a link layer for a PDF page
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 * @param {HTMLElement} container - Container element to append link layer to
 * @param {number} pageNum - Page number for tracking
 * @returns {Promise<HTMLElement>} The created link layer element
 */
export async function createLinkLayer(page, viewport, container, pageNum) {
  // Get annotations from PDF page with intent 'display' to include link annotations
  const annotations = await page.getAnnotations({ intent: 'display' });

  // Filter for link annotations
  const linkAnnotations = annotations.filter(ann => ann.subtype === 'Link');

  if (linkAnnotations.length === 0) {
    return null; // No links on this page
  }

  // Create link layer div
  const linkLayerDiv = document.createElement('div');
  linkLayerDiv.className = 'linkLayer';
  linkLayerDiv.dataset.page = pageNum;
  // De linkrechthoeken staan in de pixelruimte van DEZE viewport. De
  // viewport-sync in pdf-viewport.js rekent daarmee terug naar punten en
  // schaalt naar de actuele zoom — zonder deze twee waarden zou de laag
  // vastgeplakt blijven op de bouwschaal (links naast de tekst).
  linkLayerDiv.dataset.scale = String(viewport.scale || 1);
  linkLayerDiv.dataset.rotation = String(viewport.rotation || 0);

  // Set link layer dimensions to match canvas
  linkLayerDiv.style.width = `${viewport.width}px`;
  linkLayerDiv.style.height = `${viewport.height}px`;
  linkLayerDiv.style.position = 'absolute';
  linkLayerDiv.style.top = '0';
  linkLayerDiv.style.left = '0';
  linkLayerDiv.style.transformOrigin = '0 0';
  linkLayerDiv.style.pointerEvents = 'none'; // Let clicks pass through except on links

  // Create link elements for each annotation (behalve de links van de app)
  const eigen = appLinksVan(getActiveDocument());
  for (const ann of linkAnnotations) {
    if (ann.id && eigen.has(String(ann.id))) continue;
    const linkElement = createLinkElement(ann, viewport, pageNum);
    if (linkElement) {
      linkLayerDiv.appendChild(linkElement);
    }
  }

  // Append link layer at the end so it's on top of everything
  container.appendChild(linkLayerDiv);

  // Store reference for cleanup
  linkLayers.set(pageNum, linkLayerDiv);

  // Direct de juiste pointer-events voor het actieve gereedschap: een
  // nieuwe laag mag niet klikbaar zijn terwijl er getekend wordt, en moet
  // dat wél zijn bij het standaardgereedschap.
  applyOverlayPointerEvents(linkLayerDiv);

  return linkLayerDiv;
}

/**
 * Creates a clickable link element from a PDF annotation
 * @param {Object} ann - PDF annotation object
 * @param {Object} viewport - PDF.js viewport
 * @param {number} pageNum - Current page number
 * @returns {HTMLElement|null} The link element or null
 */
function createLinkElement(ann, viewport, pageNum) {
  if (!ann.rect || ann.rect.length < 4) return null;

  // Lege rechthoeken leveren een onklikbaar element op. Meten in PDF-punten,
  // niet in pixels: bij een (tijdelijk) minieme schaal zou een pixeltoets élke
  // link wegfilteren.
  const [rx1, ry1, rx2, ry2] = ann.rect;
  if (Math.abs(rx2 - rx1) < 0.5 || Math.abs(ry2 - ry1) < 0.5) return null;

  // PDF coordinates have origin at bottom-left, viewport has origin at top-left
  const viewportRect = viewportRectangle(viewport, ann.rect);

  // viewportRect is [x1, y1, x2, y2] but may need normalization
  const left = Math.min(viewportRect[0], viewportRect[2]);
  const top = Math.min(viewportRect[1], viewportRect[3]);
  const width = Math.abs(viewportRect[2] - viewportRect[0]);
  const height = Math.abs(viewportRect[3] - viewportRect[1]);

  // Create link element
  const linkEl = document.createElement('a');
  linkEl.className = 'pdf-link';
  if (ann.id) linkEl.dataset.pdfId = String(ann.id);
  linkEl.style.position = 'absolute';
  linkEl.style.left = `${left}px`;
  linkEl.style.top = `${top}px`;
  linkEl.style.width = `${width}px`;
  linkEl.style.height = `${height}px`;
  linkEl.style.pointerEvents = 'auto';
  linkEl.style.cursor = 'pointer';

  // De rand zoals het bestand hem vraagt (/C met /Border of /BS, #1146). De
  // paginarender tekent geen annotaties, dus zonder dit is een link van een
  // ander programma onzichtbaar. Zonder zichtbare rand blijft de markering
  // bij aanwijzen (text-layer.css) de enige aanduiding.
  const rand = linkRandStijl(ann, viewport.scale || 1);
  if (rand) {
    linkEl.classList.add('pdf-link-rand');
    Object.assign(linkEl.style, rand);
  }

  // Determine link type and set up click handler.
  //
  // PDF.js normaliseert /A-acties: een /GoTo landt als `ann.dest`, een /URI
  // als `ann.url` (alleen bij een veilig schema; `unsafeUrl` bevat de rauwe
  // waarde) en een benoemde actie (/Named) als de string `ann.action`.
  // Word-inhoudsopgaven gebruiken /Dest of /A /S /GoTo — die lopen dus via
  // de `dest`-tak.
  if (ann.url) {
    return bindExternalLink(linkEl, ann.url) ? linkEl : null;
  }
  if (ann.dest) {
    linkEl.title = i18next.t('leftPanel.goToPageLink', { ns: 'common' });
    linkEl.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleInternalLink(ann.dest);
    });
    return linkEl;
  }
  if (ann.action) {
    return setupActionLink(linkEl, ann.action, pageNum) ? linkEl : null;
  }
  // Unknown link type, make it non-interactive
  return null;
}

/**
 * Koppelt een externe URL aan het linkelement. Een PDF is onvertrouwde
 * invoer: alleen veilige schema's worden gekoppeld, en er komt bewust GEEN
 * `href` op het element — zo kan een midden-/ctrl-klik nooit binnen de
 * WebView navigeren.
 * @param {HTMLElement} linkEl
 * @param {string} url
 * @returns {boolean} of de link bruikbaar is
 */
function bindExternalLink(linkEl, url) {
  if (!isSafeLinkUrl(url)) {
    console.warn('[link-layer] Onveilig linkschema genegeerd:', String(url).slice(0, 80));
    return false;
  }
  linkEl.title = url;
  linkEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openExternalLink(url);
  });
  // Midden-/rechtermuisknop mag evenmin een navigatie starten.
  linkEl.addEventListener('auxclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return true;
}

/**
 * Opens an external URL in the default browser
 * @param {string} url - URL to open
 */
function openExternalLink(url) {
  if (!isSafeLinkUrl(url)) return;
  openExtern(url);
}

/**
 * Handles internal PDF link navigation
 * @param {string|Array} dest - Destination (named or explicit)
 */
// Elke sprong krijgt een volgnummer. Een bestemming opzoeken duurt even
// (benoemde bestemming, paginanummer, de pagina tonen); klikt de gebruiker
// intussen een andere koppeling aan of wisselt hij van document, dan mag de
// oude sprong de nieuwe plek niet meer overschrijven.
let _sprongBeurt = 0;

/** Is dit nog de laatste sprong, in hetzelfde document? */
export function sprongNogGeldig(beurt, laatste, doc, actief) {
  return beurt === laatste && !!doc && doc === actief;
}

export async function handleInternalLink(dest) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const pdf = doc.pdfDoc;
  const beurt = ++_sprongBeurt;
  const geldig = () => sprongNogGeldig(beurt, _sprongBeurt, doc, getActiveDocument()) && doc.pdfDoc === pdf;

  try {
    // Benoemde bestemming eerst oplossen naar de expliciete array.
    let explicit = dest;
    if (typeof dest === 'string') {
      explicit = await pdf.getDestination(dest);
      if (!geldig()) return;
    }

    const destInfo = parseDestinationArray(explicit);
    if (!destInfo) return;

    const ref = destInfo.pageRef;
    let pageIndex;
    if (ref && typeof ref === 'object') {
      pageIndex = await pdf.getPageIndex(ref);
      if (!geldig()) return;
    } else if (typeof ref === 'number') {
      pageIndex = ref;
    }
    if (pageIndex === undefined || pageIndex === null || !Number.isFinite(pageIndex)) return;

    // PDF.js uses 0-based index, our app uses 1-based page numbers
    const targetPage = pageIndex + 1;

    // De doelpagina tonen; het beeld (zoom en plek) zet deze module daarna
    // zelf. Zonder skipScroll loopt de vloeiende scroll van goToPage ná deze
    // aanroep nog door en zou die de plek weer overschrijven.
    await goToPage(targetPage, { skipScroll: true });
    if (!geldig()) return;
    let getoond = false;
    try {
      getoond = await toonDoelbeeld(doc, targetPage, destInfo, geldig);
    } catch (e) {
      console.warn('[link-layer] beeld van de bestemming niet gezet:', e);
    }
    // Een bestemming waarvan het beeld niet te lezen is: alleen de pagina.
    if (!getoond && geldig()) await goToPage(targetPage);
  } catch (e) {
    console.warn('Failed to navigate to internal link:', e);
  }
}

// Marge boven de bestemming, zodat de aangesprongen kop niet tegen de
// bovenrand van het venster plakt. Niet bij een bestemming met een eigen
// zoom: dat is een vastgelegd beeld, dat hoort precies zo terug te komen.
const DEST_SCROLL_MARGIN_PX = 12;

// Grenzen voor de zoom van een bestemming buiten de vector-viewport (die
// begrenst zelf).
const DEST_ZOOM_MIN = 0.05;
const DEST_ZOOM_MAX = 64;

/** De zoom bij 100%: zoals 'Werkelijke grootte' (renderer.js, actualSize). */
function zoomBijHonderd() {
  const kalibratie = kalibratieVoor(state.preferences?.screenCalibration, window.devicePixelRatio || 1);
  return kalibratie != null ? werkelijkeGrootteZoom(kalibratie) : cssPxPerPtAt100(state.preferences?.zoomDpi);
}

/**
 * Zet zoom en plek zoals de bestemming ze vraagt (#1146): elke vorm uit
 * link-destination.js (destDoelbeeld), met de draaiing van de pagina, de
 * paginarotatie en de weergaverotatie (#200), en een CropBox die niet op 0
 * begint. De pagina staat al in beeld (goToPage). Geeft false als er geen
 * beeld te zetten viel.
 * @param {object} doc
 * @param {number} pageNum
 * @param {ReturnType<typeof parseDestinationArray>} destInfo
 */
async function toonDoelbeeld(doc, pageNum, destInfo, geldig) {
  const pdfPage = await doc.pdfDoc.getPage(pageNum);
  if (!geldig()) return false;
  const rotatie = (pdfPage.rotate || 0) + (getPageRotation(pageNum) || 0) + weergaveRotatie(doc);
  const pagina = { view: Array.from(pdfPage.view), rotatie };
  const honderd = zoomBijHonderd();

  // Vector-viewport (één pagina, bureaublad): zoom en verschuiving van de
  // viewport zelf. Zelfde voorwaarde als setZoom() in renderer.js.
  const vp = window.__pdfViewport;
  if (vp && vp.active && doc.filePath) {
    const m = await import('./pdf-viewport.js');
    if (!geldig()) return false;
    const { cssW, cssH } = m.viewportCanvasMaat();
    const venster = { breedte: cssW, hoogte: cssH, honderd };
    const beeld = destDoelbeeld(destInfo, pagina, venster);
    if (!beeld) return false;
    if (beeld.zoom) m.setZoomAtPoint(cssW / 2, cssH / 2, beeld.zoom);
    const zoom = vp.zoom;
    const maat = weergaveMaatVan(pagina.view, rotatie);
    // De pagina blijft in het venster, zoals bij schuiven: een pagina die
    // past, staat in het midden.
    const plek = klemPaginaPlek(
      paginaPlekInVenster(beeld, zoom, venster, beeld.zoom ? 0 : DEST_SCROLL_MARGIN_PX),
      { breedte: maat.breedte * zoom, hoogte: maat.hoogte * zoom },
      venster,
    );
    m.zetViewportStand({
      zoom,
      offsetX: plek.x ?? vp.offsetX,
      offsetY: plek.y ?? vp.offsetY,
      verankerd: true,
    });
    return true;
  }

  // Anders schuift #pdf-container over de pagina('s).
  const scroller = document.getElementById('pdf-container');
  if (!scroller || !(scroller.clientWidth > 0 && scroller.clientHeight > 0)) return false;
  const venster = { breedte: scroller.clientWidth, hoogte: scroller.clientHeight, honderd };
  const beeld = destDoelbeeld(destInfo, pagina, venster);
  if (!beeld) return false;

  if (beeld.zoom) {
    const zoom = Math.min(DEST_ZOOM_MAX, Math.max(DEST_ZOOM_MIN, beeld.zoom));
    if (Math.abs(zoom - (Number(doc.scale) || 0)) > 1e-6) await setZoom(zoom);
    if (!geldig()) return false;
  }

  const paginaEl = doc.viewMode === 'continuous' || doc.facingSpread
    ? (document.querySelector(`.page-wrapper[data-page="${pageNum}"] .canvas-container-cont`)
      || document.querySelector(`.page-wrapper[data-page="${pageNum}"]`))
    : document.getElementById('pdf-canvas');
  if (!paginaEl) return false;
  const r = paginaEl.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const c = scroller.getBoundingClientRect();
  // De zoom zoals de pagina werkelijk op het scherm ligt.
  const maat = weergaveMaatVan(pagina.view, rotatie);
  const zoom = r.width / maat.breedte;
  const plek = paginaPlekInVenster(beeld, zoom, venster, beeld.zoom ? 0 : DEST_SCROLL_MARGIN_PX);
  // Waar de pagina nu ligt binnen de schuifbare inhoud.
  const paginaLinks = r.left - c.left - scroller.clientLeft + scroller.scrollLeft;
  const paginaBoven = r.top - c.top - scroller.clientTop + scroller.scrollTop;
  if (plek.x !== null) scroller.scrollLeft = Math.max(0, paginaLinks - plek.x);
  if (plek.y !== null) scroller.scrollTop = Math.max(0, paginaBoven - plek.y);
  return true;
}

/**
 * Sets up a link element for action-based links
 * @param {HTMLElement} linkEl - Link element
 * @param {Object|string} action - PDF action object of benoemde actie
 * @param {number} pageNum - Paginanummer waarop de link staat
 * @returns {boolean} of de link bruikbaar is
 */
function setupActionLink(linkEl, action, pageNum) {
  if (!action) return false;

  // PDF.js levert benoemde acties (/S /Named) als kale string.
  if (typeof action === 'string') {
    return bindNamedAction(linkEl, action, pageNum);
  }

  switch (action.action) {
    case 'URI':
      return bindExternalLink(linkEl, action.uri);

    case 'GoTo':
      if (!action.dest) return false;
      linkEl.title = i18next.t('leftPanel.goToPageLink', { ns: 'common' });
      linkEl.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleInternalLink(action.dest);
      });
      return true;

    case 'GoToR':
      // GoToR is "Go to Remote" - opens another PDF file
      // For now, just show a tooltip
      if (!action.filename) return false;
      linkEl.title = i18next.t('leftPanel.openExternalFile', { ns: 'common', filename: action.filename });
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // GoToR links to external PDFs not implemented
      });
      return true;

    case 'Launch':
      // Launch action - opens a file
      return bindExternalLink(linkEl, action.url);

    default:
      return false;
  }
}

/**
 * Benoemde acties (/Named): bladeren binnen het document.
 * @param {HTMLElement} linkEl
 * @param {string} name
 * @param {number} pageNum
 * @returns {boolean}
 */
function bindNamedAction(linkEl, name, pageNum) {
  const doc = getActiveDocument();
  const lastPage = doc?.pdfDoc?.numPages || 1;
  const targets = {
    NextPage: () => Math.min(lastPage, (pageNum || 1) + 1),
    PrevPage: () => Math.max(1, (pageNum || 1) - 1),
    FirstPage: () => 1,
    LastPage: () => lastPage,
  };
  const resolve = targets[name];
  if (!resolve) return false;

  linkEl.title = i18next.t('leftPanel.goToPageLink', { ns: 'common' });
  linkEl.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await goToPage(resolve());
  });
  return true;
}

/**
 * Creates link layer for single page mode
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 */
export async function createSinglePageLinkLayer(page, viewport) {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // Remove existing link layer
  clearSinglePageLinkLayer();

  const doc = getActiveDocument();
  await createLinkLayer(page, viewport, container, doc ? doc.currentPage : 1);
}

/**
 * Clears link layer for single page mode
 */
export function clearSinglePageLinkLayer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // querySelectorAll: bij een eerdere dubbele opbouw bleef met querySelector
  // een tweede, verouderde laag achter met klikdoelen op de oude posities.
  container.querySelectorAll('.linkLayer').forEach(layer => layer.remove());

  // Clear from tracking map
  const clDoc = getActiveDocument();
  linkLayers.delete(clDoc ? clDoc.currentPage : 1);
}

/**
 * Clears all link layers (for re-render or cleanup)
 */
export function clearLinkLayers() {
  // Remove all link layer elements
  document.querySelectorAll('.linkLayer').forEach(layer => {
    layer.remove();
  });

  // Clear the tracking map
  linkLayers.clear();
}

/**
 * Gets the link layer for a specific page
 * @param {number} pageNum - Page number
 * @returns {HTMLElement|null} The link layer element or null
 */
export function getLinkLayer(pageNum) {
  return linkLayers.get(pageNum) || null;
}
