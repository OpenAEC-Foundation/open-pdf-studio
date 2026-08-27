import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { goToPage } from './renderer.js';
import { openExternal } from '../core/platform.js';
import { destTopOffsetPt, isSafeLinkUrl, parseDestinationArray } from './link-destination.js';
import i18next from '../i18n/config.js';

/**
 * Link Layer Management Module
 * Creates clickable link overlays for PDF link annotations
 */

// Store references to link layers for cleanup
const linkLayers = new Map();

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

  // Create link elements for each annotation
  for (const ann of linkAnnotations) {
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
  const viewportRect = viewport.convertToViewportRectangle(ann.rect);

  // viewportRect is [x1, y1, x2, y2] but may need normalization
  const left = Math.min(viewportRect[0], viewportRect[2]);
  const top = Math.min(viewportRect[1], viewportRect[3]);
  const width = Math.abs(viewportRect[2] - viewportRect[0]);
  const height = Math.abs(viewportRect[3] - viewportRect[1]);

  // Create link element
  const linkEl = document.createElement('a');
  linkEl.className = 'pdf-link';
  linkEl.style.position = 'absolute';
  linkEl.style.left = `${left}px`;
  linkEl.style.top = `${top}px`;
  linkEl.style.width = `${width}px`;
  linkEl.style.height = `${height}px`;
  linkEl.style.pointerEvents = 'auto';
  linkEl.style.cursor = 'pointer';

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
  openExternal(url);
}

/**
 * Handles internal PDF link navigation
 * @param {string|Array} dest - Destination (named or explicit)
 */
export async function handleInternalLink(dest) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  try {
    // Benoemde bestemming eerst oplossen naar de expliciete array.
    let explicit = dest;
    if (typeof dest === 'string') {
      explicit = await doc.pdfDoc.getDestination(dest);
    }

    const destInfo = parseDestinationArray(explicit);
    if (!destInfo) return;

    const ref = destInfo.pageRef;
    let pageIndex;
    if (ref && typeof ref === 'object') {
      pageIndex = await doc.pdfDoc.getPageIndex(ref);
    } else if (typeof ref === 'number') {
      pageIndex = ref;
    }
    if (pageIndex === undefined || pageIndex === null || !Number.isFinite(pageIndex)) return;

    // PDF.js uses 0-based index, our app uses 1-based page numbers
    const targetPage = pageIndex + 1;

    // Verticale positie binnen de doelpagina bepalen VOOR de navigatie, zodat
    // we na de render meteen kunnen scrollen.
    let topOffsetPt = null;
    try {
      const targetPdfPage = await doc.pdfDoc.getPage(targetPage);
      const baseViewport = targetPdfPage.getViewport({ scale: 1 });
      const extraRotation = getPageRotation(targetPage) || 0;
      // Bestemmingscoördinaten staan in ongeroteerde gebruikersruimte. Bij een
      // gedraaide weergave laten we de pagina gewoon bovenaan beginnen in
      // plaats van naar een verkeerde plek te springen.
      if (extraRotation % 360 === 0 && (baseViewport.rotation || 0) % 360 === 0) {
        topOffsetPt = destTopOffsetPt(destInfo, baseViewport.height);
      }
    } catch { /* paginahoogte onbekend: bovenaan de pagina beginnen */ }

    // Bij een bestemming met een verticale positie doet deze module het
    // scrollen zelf (zie goToPage-optie), anders wint de vloeiende scroll van
    // goToPage die ná deze aanroep nog doorloopt.
    const ownScroll = topOffsetPt !== null && topOffsetPt !== undefined;
    await goToPage(targetPage, { skipScroll: ownScroll });
    if (ownScroll) scrollToDestination(targetPage, topOffsetPt);
  } catch (e) {
    console.warn('Failed to navigate to internal link:', e);
  }
}

// Marge boven de bestemming, zodat de aangesprongen kop niet tegen de
// bovenrand van het venster plakt.
const DEST_SCROLL_MARGIN_PX = 12;

/**
 * Scrollt naar de verticale positie van een bestemming binnen een pagina.
 * `topOffsetPt === null` betekent: gewoon de bovenkant van de pagina tonen —
 * dat heeft goToPage() al gedaan.
 * @param {number} pageNum
 * @param {number|null} topOffsetPt Afstand vanaf de paginabovenkant in punten
 */
function scrollToDestination(pageNum, topOffsetPt) {
  if (topOffsetPt === null || topOffsetPt === undefined) return;
  const doc = getActiveDocument();
  if (!doc) return;

  const scroller = document.getElementById('pdf-container');
  if (!scroller) return;

  const scale = Number(doc.scale) || 1;
  const offsetPx = topOffsetPt * scale;

  if (doc.viewMode === 'continuous') {
    const wrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (!wrapper) return;
    const wrapperTop = wrapper.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, wrapperTop + offsetPx - DEST_SCROLL_MARGIN_PX);
    return;
  }

  // Enkelpagina: alleen zinvol wanneer de pagina hoger is dan het venster.
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  if (maxScroll <= 0) return;
  scroller.scrollTop = Math.min(maxScroll, Math.max(0, offsetPx - DEST_SCROLL_MARGIN_PX));
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
