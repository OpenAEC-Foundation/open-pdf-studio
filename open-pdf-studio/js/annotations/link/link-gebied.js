// The area a link shows (#1226): the user drags a rectangle on the target
// page, and it becomes the area of the destination in PDF units of that page.
//
// The picking itself is the shared drag-a-box tool (label-gebied-tool.js); this
// module turns the box from app space into the page's own coordinates, the
// way a /FitR destination wants them.

/**
 * A box in app space as { left, bottom, right, top } in PDF units.
 * @param {{x:number, y:number, width:number, height:number}} vak
 * @param {(x:number, y:number) => [number, number]} naarPdf  the page viewport's convertToPdfPoint
 * @returns {{left:number, bottom:number, right:number, top:number}|null}
 */
export function gebiedNaarPdf(vak, naarPdf) {
  if (!vak || typeof naarPdf !== 'function') return null;
  const a = naarPdf(vak.x, vak.y);
  const b = naarPdf(vak.x + vak.width, vak.y + vak.height);
  const getallen = [a?.[0], a?.[1], b?.[0], b?.[1]];
  if (!getallen.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const r = (n) => Math.round(n * 100) / 100;
  const gebied = {
    left: r(Math.min(a[0], b[0])), bottom: r(Math.min(a[1], b[1])),
    right: r(Math.max(a[0], b[0])), top: r(Math.max(a[1], b[1])),
  };
  // A click without a drag is not an area.
  if (gebied.right - gebied.left < 2 || gebied.top - gebied.bottom < 2) return null;
  return gebied;
}

/**
 * Let the user drag the area on a page of the active document.
 * @param {string} hint  the instruction shown above the page
 * @returns {Promise<{page:number, gebied:{left:number, bottom:number, right:number, top:number}}|null>}
 *   null when cancelled or when no area was dragged
 */
export async function kiesLinkGebied(hint) {
  const [{ getActiveDocument }, { kiesLabelGebied }] = await Promise.all([
    import('../../core/state.js'),
    import('../../tools/tools/label-gebied-tool.js'),
  ]);
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  const keuze = await kiesLabelGebied(hint);
  if (!keuze || getActiveDocument() !== doc) return null;
  const page = await doc.pdfDoc.getPage(keuze.page);
  const extra = (((doc.pageRotations?.[keuze.page] || 0) % 360) + 360) % 360;
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + extra) % 360 });
  const gebied = gebiedNaarPdf(keuze.rect, (x, y) => viewport.convertToPdfPoint(x, y));
  return gebied ? { page: keuze.page, gebied } : null;
}
