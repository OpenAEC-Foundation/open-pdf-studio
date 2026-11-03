import { paginaMaat, paginaRectNaarClient, clientRectNaarPagina, weergaveRotatie } from './weergave-ruimte.js';
import { firstVisiblePage } from './print-current-view.js';

// Vastleggen bij het openen van het printvenster, vóór een dialoog de pagina
// bedekt. Gebruik de documentruimte (ook de viewport bij hoge zoom).
export function capturePrintView(doc) {
  const container = document.getElementById('pdf-container');
  if (!container || !doc?.pdfDoc) return null;
  const bounds = container.getBoundingClientRect();
  const view = { x: bounds.left + container.clientLeft, y: bounds.top + container.clientTop,
    width: container.clientWidth, height: container.clientHeight };
  const numbers = doc.viewMode === 'continuous'
    ? [...document.querySelectorAll('#continuous-container .page-wrapper[data-page]')].map(w => Number(w.dataset.page))
    : [window.__pdfViewport?.active && doc.filePath ? window.__pdfViewport.pageNum : doc.currentPage];
  const pages = numbers.map(pageNum => {
    const m = paginaMaat(pageNum, doc);
    const rect = m && paginaRectNaarClient(pageNum, { x: 0, y: 0, width: m.breedte, height: m.hoogte }, doc);
    return rect ? { pageNum, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } } : null;
  }).filter(Boolean);
  const selected = firstVisiblePage(view, pages);
  if (!selected) return null;
  const rect = clientRectNaarPagina(selected.pageNum, { left: selected.rect.x, top: selected.rect.y, width: selected.rect.width, height: selected.rect.height }, doc);
  if (!rect || !(rect.width > 0 && rect.height > 0)) return null;
  return { pageNum: selected.pageNum, rect, rotation: weergaveRotatie(doc), docId: doc.id };
}
