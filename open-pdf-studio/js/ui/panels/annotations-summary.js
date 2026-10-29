// "Opmerkingen samenvatten" in het opmerkingenpaneel (#383): de opmerkingen
// zoals de lijst ze toont (filter en volgorde) als PDF-rapport, elk met een
// uitsnede van haar plek op de pagina, en de status van veel opmerkingen
// tegelijk zetten.
//
// Het rekenwerk zit in annotations/opmerkingen-overzicht.js en
// annotations/opmerkingen-rapport.js; hier alleen het renderen van de
// uitsneden, de vertalingen en de bestandsdialoog.

import { state, getActiveDocument, getAnnotationBounds } from '../../core/state.js';
import i18next from '../../i18n/config.js';
import { showLoading, hideLoading } from '../chrome/dialogs.js';
import { updateStatusMessage } from '../chrome/status-bar.js';
import { saveFileDialog, writeBinaryFile, extractFileName } from '../../core/platform.js';
import { getAnnotationDisplayName } from '../../utils/helpers.js';
import { renderPageOffscreen, canvasToBytes } from '../../pdf/exporter.js';
import { csvDatum, inhoudVan } from '../../annotations/opmerkingen-export.js';
import { uitsnedeVoor, statusDoelen, zetStatus } from '../../annotations/opmerkingen-overzicht.js';
import { bouwOpmerkingenRapport } from '../../annotations/opmerkingen-rapport.js';
import { recordBulkModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { StandardFonts } from 'pdf-lib';

const tp = (key, opties) => i18next.t(key, { ns: 'properties', ...(opties || {}) });

export function statusLabel(status) {
  const s = String(status || 'none');
  const hoofd = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return i18next.t(`annotation.status${hoofd}`, { ns: 'context', defaultValue: hoofd });
}

async function paginaMaat(doc, pageNum, cache) {
  if (cache.has(pageNum)) return cache.get(pageNum);
  const page = await doc.pdfDoc.getPage(pageNum);
  const extra = doc.pageRotations?.[pageNum] || 0;
  const vp = page.getViewport(extra ? { scale: 1, rotation: (page.rotate + extra) % 360 } : { scale: 1 });
  const maat = { breedte: vp.width, hoogte: vp.height };
  cache.set(pageNum, maat);
  return maat;
}

async function uitsnedeVan(doc, ann, cache) {
  const bounds = getAnnotationBounds(ann);
  const maat = await paginaMaat(doc, ann.page, cache);
  const gebied = uitsnedeVoor(bounds, maat);
  if (!gebied) return null;
  const canvas = await renderPageOffscreen(ann.page, gebied.schaal, { deel: gebied.deel });
  try {
    // Een kader om de opmerking, zodat in de uitsnede te zien is welke het is.
    const ctx = canvas.getContext('2d');
    const k = gebied.kader;
    ctx.save();
    ctx.strokeStyle = '#e81123';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(k.x - 3, k.y - 3, k.breedte + 6, k.hoogte + 6);
    ctx.restore();
    const bytes = await canvasToBytes(canvas, 'jpeg', 0.85);
    return { bytes, soort: 'jpeg' };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// Helvetica waar dat kan; tekst die Helvetica niet kan tonen (Grieks, Cyrillisch,
// Chinees, ...) krijgt het gebundelde Noto-font als het er is.
function maakFontKeuze(teksten) {
  return async (pdf) => {
    const normaal = await pdf.embedFont(StandardFonts.Helvetica);
    const vet = await pdf.embedFont(StandardFonts.HelveticaBold);
    const set = new Set(normaal.getCharacterSet());
    const allesLatijn = teksten.every((t) => [...String(t || '')].every((c) => c === '\n' || c === '\r' || c === '\t' || set.has(c.codePointAt(0))));
    if (allesLatijn) return { normaal, vet };
    try {
      const { embedOcrFont, loadDefaultOcrFontBytes } = await import('../../pdf/saver/ocr-text-layer.js');
      const font = await embedOcrFont(pdf, await loadDefaultOcrFontBytes());
      return { normaal: font, vet: font };
    } catch {
      return { normaal, vet };
    }
  };
}

/**
 * Het rapport van de gegeven opmerkingen (in deze volgorde) bouwen en
 * opslaan. Geeft true als het bestand geschreven is.
 */
export async function exportAnnotationsSummaryPdf(annotations) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || !annotations?.length) return false;
  const byId = new Map(doc.annotations.map((a) => [a.id, a]));
  const documentNaam = doc.filePath ? extractFileName(doc.filePath) : (doc.fileName || '');
  const baseName = doc.filePath ? doc.filePath.replace(/\.pdf$/i, '') : 'annotations';
  const pad = await saveFileDialog(baseName + '-summary.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!pad) return false;

  const bericht = tp('leftPanel.summaryBusy');
  showLoading(bericht, { voortgang: 0 });
  try {
    const cache = new Map();
    const ingangen = [];
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      if (getActiveDocument() !== doc) throw new Error(tp('leftPanel.summaryFailed'));
      let uitsnede = null;
      try {
        uitsnede = await uitsnedeVan(doc, ann, cache);
      } catch (err) {
        console.warn(`[Summary] crop failed for ${ann.id}:`, err);
      }
      const status = ann.status && String(ann.status).toLowerCase() !== 'none' ? statusLabel(ann.status) : '';
      ingangen.push({
        pagina: ann.page,
        type: getAnnotationDisplayName(ann, byId),
        auteur: ann.author || 'User',
        datum: csvDatum(ann.modifiedAt || ann.createdAt),
        status,
        onderwerp: ann.subject || '',
        inhoud: inhoudVan(ann),
        reacties: (ann.replies || []).filter(Boolean).map((r) => ({
          auteur: r.author || 'User', datum: csvDatum(r.createdAt), tekst: r.text || '',
        })),
        uitsnede,
      });
      showLoading(bericht, { voortgang: (i + 1) / annotations.length });
    }
    const labels = {
      titel: tp('leftPanel.summaryTitle'),
      document: tp('leftPanel.summaryDocument'),
      gemaakt: tp('leftPanel.summaryCreated'),
      aantal: tp('leftPanel.summaryCount'),
      pagina: i18next.t('page', { ns: 'common' }),
      auteur: tp('leftPanel.csvAuthor'),
      datum: tp('leftPanel.csvModified'),
      status: tp('leftPanel.csvStatus'),
      onderwerp: tp('leftPanel.csvSubject'),
      reacties: tp('leftPanel.csvReplies'),
      geenTekst: tp('leftPanel.summaryNoText'),
    };
    const teksten = [documentNaam, ...Object.values(labels)];
    for (const ing of ingangen) {
      teksten.push(ing.type, ing.auteur, ing.status, ing.onderwerp, ing.inhoud);
      for (const r of ing.reacties) teksten.push(r.auteur, r.tekst);
    }
    const { bytes } = await bouwOpmerkingenRapport({
      documentNaam,
      gemaakt: csvDatum(new Date()),
      labels,
      ingangen,
      kiesFonts: maakFontKeuze(teksten),
    });
    await writeBinaryFile(pad, bytes);
    updateStatusMessage(tp('leftPanel.summaryExported'));
    return true;
  } catch (err) {
    console.error('[Summary] export failed:', err);
    updateStatusMessage(tp('leftPanel.summaryFailed'));
    return false;
  } finally {
    hideLoading();
  }
}

/**
 * Zet de status van de gegeven opmerkingen in één ongedaan-stap. Vergrendelde
 * opmerkingen en opmerkingen die de status al hebben blijven ongemoeid.
 * @returns {number} hoeveel opmerkingen er veranderd zijn
 */
export function setStatusOfAnnotations(annotations, status) {
  const doelen = statusDoelen(annotations, status);
  if (doelen.length === 0) return 0;
  const originelen = doelen.map((a) => cloneAnnotation(a));
  const nu = new Date().toISOString();
  const door = state.defaultAuthor || 'User';
  for (const ann of doelen) zetStatus(ann, status, { door, nu });
  recordBulkModify(doelen, originelen);
  updateStatusMessage(tp('leftPanel.statusChanged', { count: doelen.length }));
  return doelen.length;
}
