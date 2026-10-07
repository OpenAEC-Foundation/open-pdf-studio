import { state, getActiveDocument } from '../core/state.js';
import { saveFileDialog, writeBinaryFileAtomic } from '../core/platform.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { showMessage } from '../bridge.js';
import i18next from '../i18n/config.js';
import { textItemsToBoxes, recoverLayout, recoverDrawingLayout } from './office-layout.js';
import { buildOdt, buildXlsx } from './office-files.js';

async function pageImage(page, rotation) {
  const base = page.getViewport({ scale: 1, rotation });
  // Reference image, bounded even for large CAD sheets.
  const viewport = page.getViewport({ scale: Math.min(1.5, 2000 / Math.max(base.width, base.height)), rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0, background: 'white' }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create page image');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { canvas.width = 0; canvas.height = 0; }
}

export async function exportOffice({ format, pages, includeImages = false, decimal = '.', doc = getActiveDocument() }) {
  const t = key => i18next.t(`appMenu:exportPanel.${key}`);
  if (!doc?.pdfDoc || !['odt', 'xlsx'].includes(format)) return false;
  if (doc.textEdits?.some(edit => !edit.baked && !edit._pendingNew)) {
    showMessage(t('officeSaveEditsFirst'));
    return false;
  }
  const pdf = doc.pdfDoc;
  const sourcePath = doc.filePath;
  const ensureSource = () => {
    if (!state.documents.includes(doc) || doc.pdfDoc !== pdf || doc.filePath !== sourcePath) {
      throw new Error(i18next.t('documentChangedDuringExport', {
        defaultValue: 'The document changed during export. Start again.',
      }));
    }
  };
  const selected = [...new Set(pages)].filter(p => Number.isInteger(p) && p >= 1 && p <= pdf.numPages).sort((a, b) => a - b);
  if (!selected.length) return false;
  const base = (doc.fileName || 'document.pdf').replace(/\.pdf$/i, '');
  const path = await saveFileDialog(`${base}.${format}`, [{ name: format === 'odt' ? 'OpenDocument Text' : 'Excel Workbook', extensions: [format] }]);
  if (!path) return false;
  const outputPath = path.toLowerCase().endsWith(`.${format}`) ? path : `${path}.${format}`;
  showLoading(t('officeWorking'));
  try {
    ensureSource();
    const output = [];
    for (const number of selected) {
      const page = await pdf.getPage(number);
      ensureSource();
      const rotation = ((page.rotate + (doc.pageRotations?.[number] || 0)) % 360 + 360) % 360;
      const viewport = page.getViewport({ scale: 1, rotation });
      const content = await page.getTextContent();
      ensureSource();
      let boxes = textItemsToBoxes(content.items, viewport);
      if (!boxes.length && doc.ocrResults?.[number]?.length) {
        boxes = doc.ocrResults[number].map(word => ({ text: word.text, x: word.left, y: word.top, width: word.width, height: word.height }));
      }
      const blocks = format === 'xlsx'
        ? recoverDrawingLayout(boxes, viewport.width, viewport.height)
        : recoverLayout(boxes, { joinParagraphs: true });
      output.push({ number, blocks, width: viewport.width, height: viewport.height,
        emptyMessage: blocks.length ? '' : t('officeNoText'),
        image: format === 'odt' && (includeImages || !blocks.length) ? await pageImage(page, rotation) : null });
      ensureSource();
      // Let the loading overlay paint between pages.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const options = { title: doc.fileName || base, decimal, pageLabel: t('officePage'), tableLabel: t('officeTable'), textLabel: t('officeText') };
    const bytes = format === 'odt' ? buildOdt(output, options) : buildXlsx(output, options);
    ensureSource();
    await writeBinaryFileAtomic(outputPath, bytes);
    return true;
  } catch (error) {
    console.error('[office-export]', error);
    showMessage(`${t('officeFailed')}\n${error?.message || String(error)}`);
    return false;
  } finally { hideLoading(); }
}
