import { PDFName } from 'pdf-lib';

function nameOf(value) {
  return value ? String(value) : '';
}

function numberOf(context, value) {
  const resolved = context.lookup(value) || value;
  if (typeof resolved?.asNumber === 'function') return resolved.asNumber();
  if (typeof resolved?.value === 'number') return resolved.value;
  const parsed = Number(resolved);
  return Number.isFinite(parsed) ? parsed : null;
}

function rectKey(context, annotation) {
  const raw = annotation.get(PDFName.of('Rect'));
  const rect = raw && (context.lookup(raw) || raw);
  if (!rect || typeof rect.size !== 'function' || rect.size() < 4) return null;
  const values = [0, 1, 2, 3].map(index => numberOf(context, rect.get(index)));
  return values.every(Number.isFinite) ? values.join(',') : null;
}

function appearanceStream(context, annotation) {
  const apRaw = annotation.get(PDFName.of('AP'));
  const ap = apRaw && context.lookup(apRaw);
  if (!ap || typeof ap.get !== 'function') return null;
  const normalRaw = ap.get(PDFName.of('N'));
  return normalRaw ? context.lookup(normalRaw) : null;
}

export function annotationIdOf(value) {
  const match = String(value || '').match(/^(\d+)\s+(\d+)\s+R$/);
  if (!match) return null;
  return match[2] === '0' ? `${match[1]}R` : `${match[1]}R${match[2]}`;
}

export function findImageAnnotationSources(pageNum, pdfDoc) {
  const page = pdfDoc.getPages()[pageNum - 1];
  if (!page) return [];

  const context = pdfDoc.context;
  const annotsRaw = page.node.get(PDFName.of('Annots'));
  const annotations = annotsRaw && context.lookup(annotsRaw);
  if (!annotations || typeof annotations.size !== 'function') return [];

  const sources = [];
  for (let index = 0; index < annotations.size(); index += 1) {
    const annotationRaw = annotations.get(index);
    const annotation = context.lookup(annotationRaw);
    if (!annotation || typeof annotation.get !== 'function') continue;

    const subtype = nameOf(annotation.get(PDFName.of('Subtype')));
    const intent = nameOf(annotation.get(PDFName.of('IT')));
    const isStamp = subtype === '/Stamp';
    const isSquareImage = subtype === '/Square' && intent === '/SquareImage';
    if (!isStamp && !isSquareImage) continue;

    const key = rectKey(context, annotation);
    if (!key) continue;

    const imageRaw = isSquareImage ? annotation.get(PDFName.of('Image')) : null;
    const stream = (imageRaw && context.lookup(imageRaw)) || appearanceStream(context, annotation);
    if (!stream) continue;

    sources.push({
      annotationId: annotationIdOf(annotationRaw),
      kind: isSquareImage ? 'square-image' : 'stamp',
      rectKey: key,
      stream,
    });
  }
  return sources;
}

export function findImageForAnnotation(imageMap, annotation, expectedKind, tolerance = 1) {
  if (!imageMap || !annotation) return null;

  // PDF.js exposes indirect annotation references as ids such as "131R".
  // When an id exists, it is authoritative: falling back to the rectangle
  // could attach an image to a different annotation with identical bounds.
  if (annotation.id) {
    const match = imageMap.get(`id:${annotation.id}`);
    return match?.kind === expectedKind ? match.dataUrl : null;
  }

  const rect = annotation.rect;
  if (!rect || rect.length < 4) return null;
  const exact = imageMap.get(`rect:${rect[0]},${rect[1]},${rect[2]},${rect[3]}`);
  if (exact?.kind === expectedKind) return exact.dataUrl;

  for (const [key, value] of imageMap.entries()) {
    if (!key.startsWith('rect:') || value?.kind !== expectedKind) continue;
    const candidate = key.slice(5).split(',').map(Number);
    if (candidate.length === 4 && candidate.every((number, index) => Math.abs(number - rect[index]) < tolerance)) {
      return value.dataUrl;
    }
  }
  return null;
}
