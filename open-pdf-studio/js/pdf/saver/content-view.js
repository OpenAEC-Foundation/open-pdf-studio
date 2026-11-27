import { PDFName, PDFHexString, PDFString } from 'pdf-lib';
import { normalizeContentView } from '../content-view.js';
const KEY = PDFName.of('OPS_ContentView');
export function writeContentView(pdf, value) {
  // Unloaded/untouched metadata is preserved, including future versions.
  if (value === undefined) return;
  pdf.catalog.set(KEY, PDFHexString.fromText(JSON.stringify({ version: 1, ...normalizeContentView(value) })));
}
export function readContentView(pdf) {
  try {
    const raw = pdf.catalog.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)) return undefined;
    const text = raw.decodeText();
    if (text.length > 2048) return undefined;
    const value = JSON.parse(text);
    return value?.version === 1 ? normalizeContentView(value) : undefined;
  } catch { return undefined; }
}
