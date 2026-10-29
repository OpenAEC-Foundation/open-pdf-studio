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
import { getCachedPdfBytes } from '../../pdf/loader.js';
import { knipselAlsMiniPdf, appVakNaarPdfVak, paginaRotatie } from '../../pdf/vector-embed.js';
import { bewaar } from '../../annotations/vector-snippet-store.js';
import { zetKnipselOpKlembord } from '../../annotations/vector-snippet-clipboard.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { applyToolTransform } from '../tool-transform.js';
import { getEffectiveScale } from '../effective-scale.js';
import { previewCtx, redrawForViewMode } from '../preview-target.js';

/** Kleiner dan dit in app-punten is een misklik, geen knipsel. */
const MIN_SLEEP_PT = 8;

const _plaatsing = { firstX: null, firstY: null };
const _reset = () => { _plaatsing.firstX = _plaatsing.firstY = null; };

// Het kader op het canvas dat de gebruiker ziet: `doelCtx` is de canvasCtx
// van de gereedschapscontext — in de doorlopende weergave het paginacanvas,
// niet de overlay die daar niet op het scherm staat (#616).
function _tekenVoorbeeld(curX, curY, doelCtx = null) {
  if (_plaatsing.firstX === null) return;
  const ctx = previewCtx(doelCtx);
  if (!ctx) return;
  redrawForViewMode();
  ctx.save();
  // Zelfde transform als de annotatieweergave (ook met een gedraaide weergave, #200).
  applyToolTransform(ctx);
  const x1 = Math.min(_plaatsing.firstX, curX);
  const y1 = Math.min(_plaatsing.firstY, curY);
  const w = Math.abs(curX - _plaatsing.firstX);
  const h = Math.abs(curY - _plaatsing.firstY);
  // Schermpixels van de weergave; een inactieve viewport (doorlopend) houdt
  // een oude zoom vast.
  const eenheid = 1 / (getEffectiveScale() || 1.5);
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

  // De bronpagina gaat mee op volle maat (srcBox blijft in haar coördinaten),
  // maar teruggesnoeid tot wat het vak raakt (#509). Zie js/pdf/vector-cull.js.
  const mini = await knipselAlsMiniPdf(bronBytes, paginaNr - 1, appRotatie, bron, srcBox);
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
      _tekenVoorbeeld(ctx.x, ctx.y, ctx.canvasCtx);
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
    _tekenVoorbeeld(ctx.x, ctx.y, ctx.canvasCtx);
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
