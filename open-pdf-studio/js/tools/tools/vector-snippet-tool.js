/**
 * Vectorknipsel — het knipgereedschap.
 *
 * Twee klikken spannen een kader op, net als bij het schaalgebied: klik 1 is de
 * linkerbovenhoek, klik 2 de rechteronder. Esc of rechtermuisklik annuleert.
 *
 * Bij de tweede klik wordt de bronpagina als zelfstandige mini-PDF opzij gezet
 * en het vak omgerekend naar de gebruikersruimte van die pagina — dezelfde
 * omrekening als de saver doet, inclusief de CropBox-verschuiving. Daarna staat
 * het knipsel op het klembord en kun je het in een ander tabblad plakken.
 */
import { getActiveDocument, getPageRotation } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { getCachedPdfBytes } from '../../pdf/loader.js';
import { knipselAlsMiniPdf, appVakNaarPdfVak, paginaRotatie } from '../../pdf/vector-embed.js';
import { bewaar } from '../../annotations/vector-snippet-store.js';
import { zetKnipselOpKlembord } from '../../annotations/vector-snippet-clipboard.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';

/** Kleiner dan dit in app-punten is een misklik, geen knipsel. */
const MIN_SLEEP_PT = 8;

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

const _plaatsing = { firstX: null, firstY: null };
const _reset = () => { _plaatsing.firstX = _plaatsing.firstY = null; };

function _tekenVoorbeeld(curX, curY) {
  if (_plaatsing.firstX === null || !annotationCtx) return;
  redraw();
  const vp = window.__pdfViewport;
  const doc = getActiveDocument();
  const ctx = annotationCtx;
  ctx.save();
  if (vp && vp.active) {
    ctx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    ctx.scale(doc?.scale || 1.5, doc?.scale || 1.5);
  }
  const x1 = Math.min(_plaatsing.firstX, curX);
  const y1 = Math.min(_plaatsing.firstY, curY);
  const w = Math.abs(curX - _plaatsing.firstX);
  const h = Math.abs(curY - _plaatsing.firstY);
  const eenheid = 1 / (vp?.zoom || doc?.scale || 1.5);
  ctx.strokeStyle = '#1565c0';
  ctx.fillStyle = 'rgba(21, 101, 192, 0.08)';
  ctx.lineWidth = 1.5 * eenheid;
  ctx.setLineDash([6 * eenheid, 4 * eenheid]);
  ctx.fillRect(x1, y1, w, h);
  ctx.strokeRect(x1, y1, w, h);
  ctx.restore();
}

async function _knipsel(vak) {
  return knipselVanVak(vak, null);
}

/**
 * Knipt een vak (app-coördinaten) uit een pagina van het actieve document.
 * Gedeeld door het gereedschap en de MCP-tool app_snippet_cut.
 * @param {{x:number,y:number,width:number,height:number}} vak
 * @param {number|null} paginaNr  null = huidige pagina
 */
export async function knipselVanVak(vak, paginaNr) {
  const doc = getActiveDocument();
  if (!doc?.filePath) return { fout: 'geen bestand' };

  const bronBytes = getCachedPdfBytes(doc.filePath);
  if (!bronBytes) return { fout: 'bronbytes niet in de cache' };

  paginaNr = paginaNr || doc.currentPage || 1;
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const pagina = bron.getPage(paginaNr - 1);
  // Het vak is getrokken op het blad zoals je het ziet: de /Rotate uit het
  // bestand plus een draaiing die alleen in de app bestaat.
  const appRotatie = getPageRotation(paginaNr) || 0;
  const srcBox = appVakNaarPdfVak(vak, pagina.getCropBox(), paginaRotatie(pagina) + appRotatie);
  if (!srcBox) return { fout: 'vak te klein' };

  // De hele bronpagina gaat mee, niet het bijgesneden vak: dat is wat het
  // inbedden nodig heeft. Zie js/pdf/vector-embed.js.
  const mini = await knipselAlsMiniPdf(bronBytes, paginaNr - 1, appRotatie);
  const sleutel = bewaar(mini);

  return {
    snippetKey: sleutel,
    srcBox,
    srcLabel: `${doc.fileName || 'document'}, blad ${paginaNr}`,
    // Wat je op het scherm trok — bij een kwartgedraaid blad is dat niet de
    // breedte van het PDF-vak.
    breedte: vak.width,
    hoogte: vak.height,
  };
}

export const vectorSnippetTool = {
  name: 'vectorSnippet',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      if (_plaatsing.firstX !== null) { _reset(); ctx.redraw(); e.preventDefault?.(); }
      return;
    }
    if (e.button !== 0) return;

    if (_plaatsing.firstX === null) {
      _plaatsing.firstX = ctx.x;
      _plaatsing.firstY = ctx.y;
      _tekenVoorbeeld(ctx.x, ctx.y);
      return;
    }

    const vak = {
      x: Math.min(_plaatsing.firstX, ctx.x),
      y: Math.min(_plaatsing.firstY, ctx.y),
      width: Math.abs(ctx.x - _plaatsing.firstX),
      height: Math.abs(ctx.y - _plaatsing.firstY),
    };
    _reset();
    ctx.redraw();
    if (vak.width < MIN_SLEEP_PT || vak.height < MIN_SLEEP_PT) return;

    _knipsel(vak).then((r) => {
      if (r.fout) {
        console.warn('[knipsel] knippen mislukt:', r.fout);
        updateStatusMessage(i18next.t('vectorSnippet.failed'));
        return;
      }
      zetKnipselOpKlembord(r);
      updateStatusMessage(i18next.t('vectorSnippet.copied'));
    }).catch((err) => {
      console.warn('[knipsel] knippen mislukt:', err);
      updateStatusMessage(i18next.t('vectorSnippet.failed'));
    });

    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx) {
    if (_plaatsing.firstX === null) return;
    _tekenVoorbeeld(ctx.x, ctx.y);
  },

  onEscape(ctx) {
    if (_plaatsing.firstX === null) return false;
    _reset();
    ctx.redraw();
    return true;
  },

  onDeactivate() {
    _reset();
  },
};
