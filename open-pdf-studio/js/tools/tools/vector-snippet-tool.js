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
import { state, getActiveDocument } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { getCachedPdfBytes } from '../../pdf/loader.js';
import { knipselAlsMiniPdf, normaliseerVak } from '../../pdf/vector-embed.js';
import { bewaar } from '../../annotations/vector-snippet-store.js';
import { zetKnipselOpKlembord } from '../../annotations/vector-snippet-clipboard.js';

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

/**
 * Rekent een vak in app-coördinaten (linksboven, y omlaag) om naar de
 * gebruikersruimte van de PDF-pagina (linksonder, y omhoog), inclusief de
 * CropBox-verschuiving — identiek aan convertX/convertY in de saver.
 */
export function appVakNaarPdfVak(vak, cropBox) {
  const links = cropBox.x;
  const boven = cropBox.y + cropBox.height;
  return normaliseerVak({
    left: vak.x + links,
    right: vak.x + vak.width + links,
    top: boven - vak.y,
    bottom: boven - (vak.y + vak.height),
  });
}

async function _knipsel(vak) {
  const doc = getActiveDocument();
  if (!doc?.filePath) return { fout: 'geen bestand' };

  const bronBytes = getCachedPdfBytes(doc.filePath);
  if (!bronBytes) return { fout: 'bronbytes niet in de cache' };

  const paginaNr = doc.currentPage || 1;
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const pagina = bron.getPage(paginaNr - 1);
  const srcBox = appVakNaarPdfVak(vak, pagina.getCropBox());
  if (!srcBox) return { fout: 'vak te klein' };

  // De hele bronpagina gaat mee, niet het bijgesneden vak: dat is wat het
  // inbedden nodig heeft. Zie js/pdf/vector-embed.js.
  const mini = await knipselAlsMiniPdf(bronBytes, paginaNr - 1);
  const sleutel = bewaar(mini);

  return {
    snippetKey: sleutel,
    srcBox,
    srcLabel: `${doc.fileName || 'document'}, blad ${paginaNr}`,
    breedte: srcBox.right - srcBox.left,
    hoogte: srcBox.top - srcBox.bottom,
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
        state.statusMessage = 'Knippen mislukt';
        return;
      }
      zetKnipselOpKlembord(r);
      state.statusMessage = 'Knipsel gekopieerd — plak het in een andere tekening';
    }).catch((err) => {
      console.warn('[knipsel] knippen mislukt:', err);
      state.statusMessage = 'Knippen mislukt';
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
