import type { Annotation, AnnotationBounds } from '../../types/annotation.js';
import { state, getActiveDocument } from '../state.js';
import { buildStavenreeks } from '../../annotations/stavenreeks.js';
import { stavenreeksPxPerMm } from '../../annotations/stavenreeks-scale.js';
import { betonbalkHalfWidthPx } from '../../annotations/betonbalk-scale.js';
// @ts-ignore — pure JS-module zonder typedeclaraties
import { systeemrasterFlatContour } from '../../annotations/systeemraster.js';
// @ts-ignore — pure JS-module zonder typedeclaraties
import { isAnnotationHiddenInView } from '../../annotations/view-filters.js';

export function clearSelection(): void {
  const doc = getActiveDocument();
  if (doc) {
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
  }
  // Always exit edit-contour mode when selection is cleared
  if (state.editingContour) state.editingContour = null;
}

export function addToSelection(annotation: Annotation): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (!doc.selectedAnnotations.includes(annotation)) {
    doc.selectedAnnotations.push(annotation);
  }
  doc.selectedAnnotation = annotation;
}

export function removeFromSelection(annotation: Annotation): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.selectedAnnotations = doc.selectedAnnotations.filter(a => a !== annotation);
  doc.selectedAnnotation = doc.selectedAnnotations.length > 0
    ? doc.selectedAnnotations[doc.selectedAnnotations.length - 1]
    : null;
}

export function isSelected(annotation: Annotation): boolean {
  const doc = state.documents[state.activeDocumentIndex];
  return doc ? doc.selectedAnnotations.includes(annotation) : false;
}

export function selectAllOnPage(): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  // Weergavefilters (hidden-vlag, Zichtbaarheid Elementen, statusfilter
  // #333): wat niet getekend wordt, hoort ook niet in "alles selecteren".
  const pageAnnotations = doc.annotations.filter(
    a => a.page === doc.currentPage && !isAnnotationHiddenInView(a)
  );
  doc.selectedAnnotations = pageAnnotations;
  doc.selectedAnnotation = pageAnnotations.length > 0 ? pageAnnotations[0] : null;
}

export function getAnnotationBounds(ann: Annotation): AnnotationBounds | null {
  switch (ann.type) {
    case 'draw':
      if (!ann.path || ann.path.length === 0) return null;
      const drawMinX = Math.min(...ann.path.map(p => p.x));
      const drawMinY = Math.min(...ann.path.map(p => p.y));
      const drawMaxX = Math.max(...ann.path.map(p => p.x));
      const drawMaxY = Math.max(...ann.path.map(p => p.y));
      return { x: drawMinX, y: drawMinY, width: drawMaxX - drawMinX, height: drawMaxY - drawMinY };
    case 'arc': {
      const arcR = ann.radius || 0;
      const arcCX = ann.centerX || 0;
      const arcCY = ann.centerY || 0;
      return { x: arcCX - arcR, y: arcCY - arcR, width: arcR * 2, height: arcR * 2 };
    }
    case 'spline': {
      if (!ann.controlPoints || ann.controlPoints.length === 0) return null;
      const spMinX = Math.min(...ann.controlPoints.map(p => p.x));
      const spMinY = Math.min(...ann.controlPoints.map(p => p.y));
      const spMaxX = Math.max(...ann.controlPoints.map(p => p.x));
      const spMaxY = Math.max(...ann.controlPoints.map(p => p.y));
      return { x: spMinX, y: spMinY, width: spMaxX - spMinX || 1, height: spMaxY - spMinY || 1 };
    }
    case 'line':
    case 'arrow':
      const lx = Math.min(ann.startX!, ann.endX!);
      const ly = Math.min(ann.startY!, ann.endY!);
      return { x: lx, y: ly, width: Math.abs(ann.endX! - ann.startX!), height: Math.abs(ann.endY! - ann.startY!) };
    case 'polyline':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
    case 'systeemraster': {
      // Boog-bewust: het selectiekader moet de boog-uitstulping omvatten,
      // dus de bounds komen uit de VLAKKE contour (flattenContour) en niet
      // uit de kale hoekpunten (de koorde zou de boog afsnijden).
      const srFlat = systeemrasterFlatContour(ann);
      if (!srFlat || srFlat.length < 3) return null;
      const srMinX = Math.min(...srFlat.map((p: { x: number }) => p.x));
      const srMinY = Math.min(...srFlat.map((p: { y: number }) => p.y));
      const srMaxX = Math.max(...srFlat.map((p: { x: number }) => p.x));
      const srMaxY = Math.max(...srFlat.map((p: { y: number }) => p.y));
      return { x: srMinX, y: srMinY, width: srMaxX - srMinX, height: srMaxY - srMinY };
    }
    case 'filledArea':
      // filledArea moves by shifting its points — bounds must derive from
      // the points too, NOT the static x/y/width/height captured at creation
      // (those don't update on move, leaving the selection box behind).
      if (!ann.points || ann.points.length === 0) return null;
      const plMinX = Math.min(...ann.points.map(p => p.x));
      const plMinY = Math.min(...ann.points.map(p => p.y));
      const plMaxX = Math.max(...ann.points.map(p => p.x));
      const plMaxY = Math.max(...ann.points.map(p => p.y));
      return { x: plMinX, y: plMinY, width: plMaxX - plMinX, height: plMaxY - plMinY };
    case 'stavenreeks': {
      // Volledige omhullende: reekslijn + poten + punten + label. Dezelfde
      // AABB die straks de PDF-/Rect wordt (één bron van waarheid).
      const sr = buildStavenreeks(ann as any, { pxPerMm: stavenreeksPxPerMm(ann as any) });
      return { x: sr.aabb.x, y: sr.aabb.y, width: sr.aabb.width, height: sr.aabb.height };
    }
    case 'betonbalk': {
      // Lijnstuk ± halve balkbreedte (schaalgebied-bewust): de band steekt
      // loodrecht buiten start/eind uit. Een eventuele tag valt binnen een
      // extra tekstregel-marge.
      const bbHalf = betonbalkHalfWidthPx(ann as any)
        + ((ann as any).tagTonen ? ((ann as any).tagFontSize || 12) * 1.6 : 0);
      const bbMinX = Math.min(ann.startX!, ann.endX!) - bbHalf;
      const bbMinY = Math.min(ann.startY!, ann.endY!) - bbHalf;
      return {
        x: bbMinX, y: bbMinY,
        width: Math.max(ann.startX!, ann.endX!) + bbHalf - bbMinX,
        height: Math.max(ann.startY!, ann.endY!) + bbHalf - bbMinY,
      };
    }
    case 'measureDistance': {
      const mdXs = [ann.startX!, ann.endX!];
      const mdYs = [ann.startY!, ann.endY!];
      if ((ann as any).leaderStartX !== undefined) {
        mdXs.push((ann as any).leaderStartX, (ann as any).leaderEndX);
        mdYs.push((ann as any).leaderStartY, (ann as any).leaderEndY);
      }
      const mdlx = Math.min(...mdXs);
      const mdly = Math.min(...mdYs);
      return { x: mdlx, y: mdly, width: Math.max(...mdXs) - mdlx, height: Math.max(...mdYs) - mdly };
    }
    case 'measureAngle': {
      if (!(ann as any).point1 || !(ann as any).vertex || !(ann as any).point2) return null;
      const maXs = [(ann as any).point1.x, (ann as any).vertex.x, (ann as any).point2.x];
      const maYs = [(ann as any).point1.y, (ann as any).vertex.y, (ann as any).point2.y];
      const malx = Math.min(...maXs);
      const maly = Math.min(...maYs);
      return { x: malx, y: maly, width: Math.max(...maXs) - malx, height: Math.max(...maYs) - maly };
    }
    case 'text':
      return { x: ann.x!, y: ann.y! - (ann.fontSize || 16), width: 100, height: ann.fontSize || 16 };
    case 'comment':
      return { x: ann.x!, y: ann.y!, width: ann.width || 24, height: ann.height || 24 };
    case 'box':
    case 'mask':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'callout':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
    case 'viewport':
    case 'scaleRegion':
    case 'scaleBar':
    case 'scheduleTable':
      return { x: ann.x!, y: ann.y!, width: ann.width!, height: ann.height! };
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      return { x: ann.x!, y: ann.y!, width: ann.width!, height: ann.height! };
    default:
      if (ann.x !== undefined && ann.width !== undefined) {
        return { x: ann.x, y: ann.y!, width: ann.width || 150, height: ann.height || 50 };
      }
      return null;
  }
}

export function getSelectionBounds(): AnnotationBounds | null {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || doc.selectedAnnotations.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ann of doc.selectedAnnotations) {
    const bounds = getAnnotationBounds(ann);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
