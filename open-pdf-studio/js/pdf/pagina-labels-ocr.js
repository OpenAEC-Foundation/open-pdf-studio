import { draaiVak, woordenInGebied } from './pagina-labels.js';

/** The selection is in app space; OCR renders with intrinsic PDF rotation only. */
export function labelOcrRegion(rect, page) {
  const extra = page?.extra || 0;
  if (!extra) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const swapped = extra === 90 || extra === 270;
  return draaiVak(rect, swapped ? page.hoogte : page.breedte,
    swapped ? page.breedte : page.hoogte, (360 - extra) % 360);
}

/** Cache by PDF instance, path, page and crop: edits/reloads cannot reuse stale OCR. */
export function createLabelOcrReader({ invoke, isTauri }) {
  const documents = new WeakMap();
  return async (doc, pageNum, rect, page) => {
    if (!doc.filePath || !isTauri()) {
      const words = (doc.ocrResults?.[pageNum] || []).map((word) => {
        if (!page?.extra) return word;
        const box = draaiVak({ x: word.left, y: word.top, width: word.width, height: word.height },
          page.breedte, page.hoogte, page.extra);
        return { ...word, left: box.x, top: box.y, width: box.width, height: box.height };
      });
      return woordenInGebied(words, rect);
    }
    const pdf = doc.pdfDoc;
    if (!pdf) return '';
    const path = doc.filePath;
    const region = labelOcrRegion(rect, page);
    const key = JSON.stringify([path, pageNum, region]);
    let cache = documents.get(pdf);
    if (!cache) { cache = new Map(); documents.set(pdf, cache); }
    if (!cache.has(key)) {
      if (cache.size >= 500) cache.clear();
      const request = Promise.resolve().then(() => invoke('ocr_pdf_page', {
        path, pageIndex: pageNum - 1, lang: 'auto', labelRegion: region,
      })).then((words) => {
        // Tesseract already returns reading order after correcting orientation.
        // Sorting by original page Y would reverse a bottom-to-top title.
        return Array.isArray(words) ? words.map((w) => w.text).join(' ').trim() : '';
      }).catch((error) => { cache.delete(key); throw error; });
      cache.set(key, request);
    }
    const text = await cache.get(key);
    return doc.pdfDoc === pdf && doc.filePath === path ? text : '';
  };
}
