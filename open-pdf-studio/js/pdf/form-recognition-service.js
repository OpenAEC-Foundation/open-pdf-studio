import { getActiveDocument } from '../core/state.js';
import { isTauri, fileExists, writeBinaryFileNew } from '../core/platform.js';
import { detectFormShapes, labelCandidates, createRecognizedForm, overlap } from './form-recognition.js';

export async function openFormRecognition(documentId) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.id !== documentId) throw new Error('DOCUMENT_CHANGED');
  if (doc.modified) throw new Error('SAVE_CHANGES_FIRST');
  const pdf = doc.pdfDoc,
    revision = doc.inhoudRevisie || 0;
  const check = () => {
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || doc.modified || (doc.inhoudRevisie || 0) !== revision) throw new Error('DOCUMENT_CHANGED');
  };
  const bytes = (await pdf.getData()).slice();
  check();
  const sourceId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  check();
  async function render(pageNumber, canvas, signal) {
    check();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const page = await pdf.getPage(pageNumber);
    check();
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale, rotation: 0 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({
      canvasContext: canvas.getContext('2d', { willReadFrequently: true }),
      viewport,
      annotationMode: 0,
      background: 'rgb(255,255,255)'
    });
    const abort = () => task.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await task.promise;
      check();
      return { page, base, viewport, scale };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    documentId,
    revision,
    sourceId,
    pageCount: pdf.numPages,
    check,
    render,
    async detect(pages, { ocr = false, lang = 'auto', signal, onProgress } = {}) {
      if (!Array.isArray(pages)
        || !pages.length
        || pages.length > 50
        || new Set(pages).size !== pages.length
        || pages.some(p => !Number.isInteger(p) || p < 1 || p > pdf.numPages)) throw new Error('INVALID_PAGES');
      const candidates = [],
        existing = [],
        warnings = [];
      for (const pageNumber of pages) {
        const canvas = document.createElement('canvas');
        try {
          const { page, base, scale } = await render(pageNumber, canvas, signal),
            text = await page.getTextContent();
          check();
          let words = text.items.filter(w => w.str?.trim()).map(w => {
            const [x, y] = base.convertToViewportPoint(w.transform[4], w.transform[5]);
            return { text: w.str, x, y: y - w.height, width: w.width, height: w.height };
          });
          if (!words.length && ocr) {
            if (!isTauri() || !doc.filePath) throw new Error('DESKTOP_OCR_REQUIRED');
            // Voorkeursengine (een extensie of de ingebouwde Tesseract, #970).
            const { herkenPagina } = await import('./ocr-engines.js');
            const raw = await herkenPagina(doc, pageNumber, { lang, signal });
            check();
            words = raw.map(w => ({ text: w.text, x: w.left, y: w.top, width: w.width, height: w.height }));
          }
          if (!words.length) warnings.push({ page: pageNumber, code: 'NO_TEXT_LABELS' });
          const widgets = (await page.getAnnotations()).filter(a => a.subtype === 'Widget');
          check();
          const existingPage = widgets.map(a => ({
            page: pageNumber,
            name: a.fieldName,
            bounds: { x: a.rect[0], y: a.rect[1], width: a.rect[2] - a.rect[0], height: a.rect[3] - a.rect[1] }
          }));
          existing.push(...existingPage);
          const found = labelCandidates(detectFormShapes(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), scale), words);
          for (const item of found) {
            const a = base.convertToPdfPoint(item.x, item.y + item.height),
              b = base.convertToPdfPoint(item.x + item.width, item.y);
            const bounds = {
              x: Math.min(a[0], b[0]),
              y: Math.min(a[1], b[1]),
              width: Math.abs(b[0] - a[0]),
              height: Math.abs(b[1] - a[1])
            };
            if (existingPage.some(e => overlap(e.bounds, bounds) > .35)) continue;
            const index = candidates.length + 1;
            candidates.push({
              ...item,
              id: `p${pageNumber}-${index}`,
              page: pageNumber,
              name: `recognized_p${pageNumber}_${index}`,
              order: index,
              bounds
            });
          }
          if (candidates.length > 1000) throw new Error('TOO_MANY_CANDIDATES');
          onProgress?.({ page: pageNumber, completed: pages.indexOf(pageNumber) + 1, total: pages.length });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      check();
      return { documentId, revision, sourceId, candidates, existing, warnings };
    },
    async prepare(candidates) {
      check();
      const result = await createRecognizedForm(bytes, candidates);
      check();
      return result;
    }
  };
}

export async function exportRecognizedForm(session, candidates, path) {
  if (!isTauri()) throw new Error('DESKTOP_EXPORT_REQUIRED');
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.pdf')) throw new Error('PDF_PATH_REQUIRED');
  if (await fileExists(path)) throw new Error('CHOOSE_NEW_FILE');
  const result = await session.prepare(candidates);
  session.check();
  await writeBinaryFileNew(path, result.bytes);
  return { path, created: result.created, fields: result.fields };
}

export async function formRecognitionRequest(request, options = {}) {
  const session = await openFormRecognition(request.documentId);
  if (request.action === 'detect') return session.detect(request.pages, { ...options, ocr: request.ocr, lang: request.lang });
  if (request.action === 'saveCopy') {
    if (request.sourceId !== session.sourceId || request.revision !== session.revision) throw new Error('DOCUMENT_CHANGED');
    return exportRecognizedForm(session, request.candidates, request.outputPath);
  }
  throw new Error('INVALID_ACTION');
}
