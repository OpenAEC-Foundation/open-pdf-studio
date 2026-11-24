import { getActiveDocument } from '../core/state.js';

// Capture the requested tab before the first asynchronous chunk load. A tab
// switch while loading must never redirect Save or Save As to another PDF.
export async function savePDF(saveAsPath = null, opties = {}, doc = getActiveDocument()) {
  const saver = await import('./saver.js');
  return saver.savePDF(saveAsPath, opties, doc);
}

export async function savePDFAs(doc = getActiveDocument(), explicitPath = null, opties = {}) {
  const saver = await import('./saver.js');
  return saver.savePDFAs(doc, explicitPath, opties);
}
