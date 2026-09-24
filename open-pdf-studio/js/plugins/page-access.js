function checkRequest(doc, pageNum, signal, isCurrent) {
  if (signal?.aborted) throw new DOMException('Page request aborted', 'AbortError');
  if (!doc || !doc.pdfDoc || !Number.isInteger(pageNum) || pageNum < 1 || pageNum > (doc.numPages || doc.pdfDoc.numPages)) {
    throw new RangeError('Invalid document page');
  }
  if (isCurrent && !isCurrent(doc)) throw new DOMException('Document changed', 'AbortError');
}

function multiplyTransform(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function pageView(doc, pageNum, options) {
  checkRequest(doc, pageNum, options.signal, options.isCurrent);
  const page = await doc.pdfDoc.getPage(pageNum);
  checkRequest(doc, pageNum, options.signal, options.isCurrent);
  const rotation = ((page.rotate + (options.rotation || 0)) % 360 + 360) % 360;
  const viewport = page.getViewport({ scale: 1, rotation });
  return { page, viewport, rotation };
}

export async function getPageInfoForDocument(doc, pageNum, options = {}) {
  const { viewport, rotation } = await pageView(doc, pageNum, options);
  return {
    documentId: doc.id, page: pageNum, width: viewport.width, height: viewport.height, rotation,
    pdfToAnnotation(x, y) {
      const [px, py] = viewport.convertToViewportPoint(x, y);
      return { x: px, y: py };
    },
    annotationToPdf(x, y) {
      const [px, py] = viewport.convertToPdfPoint(x, y);
      return { x: px, y: py };
    },
  };
}

/** Read PDF vector segments and positioned text in annotation coordinates. */
export async function readPageContentForDocument(doc, pageNum, options = {}) {
  const { page, viewport } = await pageView(doc, pageNum, options);
  const textContent = await page.getTextContent();
  checkRequest(doc, pageNum, options.signal, options.isCurrent);
  const text = [];
  for (let i = 0; i < textContent.items.length; i++) {
    const item = textContent.items[i];
    if (typeof item.str !== 'string' || !item.transform) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    text.push({ text: item.str, x, y, width: item.width, height: item.height,
      transform: multiplyTransform(viewport.transform, item.transform),
      direction: item.dir || 'ltr', fontName: item.fontName || null });
    if (i % 500 === 499) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkRequest(doc, pageNum, options.signal, options.isCurrent);
    }
  }
  const vectors = options.extractVectors
    ? await options.extractVectors(pageNum, { signal: options.signal, document: doc })
    : { points: [], edges: [] };
  checkRequest(doc, pageNum, options.signal, options.isCurrent);
  return { documentId: doc.id, page: pageNum, text, points: vectors.points, edges: vectors.edges };
}

/** Render one bounded tile; large sheets are never rasterized in one call. */
export async function renderPageTileForDocument(doc, pageNum, rect, options = {}) {
  const { page, viewport: base } = await pageView(doc, pageNum, options);
  const { x, y, width, height } = rect || {};
  const scale = options.scale ?? 1;
  if (![x, y, width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0 || scale <= 0 ||
      x < 0 || y < 0 || x + width > base.width || y + height > base.height ||
      width * scale > 2048 || height * scale > 2048 || width * height * scale * scale > 4_000_000) {
    throw new RangeError('Invalid or oversized raster tile');
  }
  const pixelWidth = Math.ceil(width * scale);
  const pixelHeight = Math.ceil(height * scale);
  const canvas = options.createCanvas?.(pixelWidth, pixelHeight) ||
    (typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : document.createElement('canvas'));
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot create tile canvas context');
  const render = page.render({ canvasContext: context,
    viewport: page.getViewport({ scale, rotation: base.rotation }),
    transform: [1, 0, 0, 1, -x * scale, -y * scale],
  });
  const abort = () => render.cancel();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await render.promise;
    checkRequest(doc, pageNum, options.signal, options.isCurrent);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    checkRequest(doc, pageNum, options.signal, options.isCurrent);
    if (!blob) throw new Error('Tile encoder returned no image');
    return { blob, mimeType: 'image/png', width: pixelWidth, height: pixelHeight,
      documentId: doc.id, page: pageNum, rect: { x, y, width, height } };
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
