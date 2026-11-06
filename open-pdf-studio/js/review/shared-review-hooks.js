// What the PDF saver asks the shared review (#237), without loading it: the
// service registers itself here once a review runs. Without a review the
// saver writes the document's annotations, exactly as before.
let hooks = null;

export function registerSharedReviewHooks(value) {
  hooks = value;
}

/** The annotations a PDF save of `doc` writes. */
export function annotationsForSave(doc) {
  const list = doc?.annotations || [];
  try {
    return hooks?.annotationsForSave?.(doc) ?? list;
  } catch (e) {
    console.warn('[shared-review] save filter failed:', e);
    return list;
  }
}

/** After a successful PDF save: publish my changes when that is switched on. */
export function afterPdfSaved(doc) {
  try {
    hooks?.afterPdfSaved?.(doc);
  } catch (e) {
    console.warn('[shared-review] publish after save failed:', e);
  }
}
