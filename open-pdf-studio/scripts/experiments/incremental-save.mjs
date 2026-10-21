// Opt-in evaluation only. Not imported by the application's normal save path.
import * as mupdf from 'mupdf';

const fail = code => { throw new Error(code); };
const MAX_INPUT = 32 * 1024 * 1024;

/** Append one new note to a copy. Coordinates use MuPDF's page space.
 * Existing objects, deletion, forms and signed/encrypted PDFs are out of scope.
 * Returns bytes only: publication must remain atomic and revision-guarded.
 */
export function appendNotePrototype(input, { pageIndex = 0, rect = [20,20,40,40], text, operation = 'add-note' } = {}) {
  if (operation !== 'add-note') fail('INCREMENTAL_UNSUPPORTED_OPERATION');
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > MAX_INPUT) fail('INCREMENTAL_INPUT_LIMIT');
  if (typeof text !== 'string' || !text.trim() || text.length > 4096) fail('INCREMENTAL_INVALID_TEXT');
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some(n => !Number.isFinite(n)) || rect[2] <= rect[0] || rect[3] <= rect[1]) fail('INCREMENTAL_INVALID_RECT');
  // Conservative denylist before parsing: false positives are preferable in a
  // prototype. A later structural scan also catches compressed dictionaries.
  if (/\/(?:Encrypt|ByteRange|DocMDP|FieldMDP)\b/.test(new TextDecoder('latin1').decode(input))) fail('INCREMENTAL_PROTECTED_INPUT');
  let doc, page, annotation, buffer;
  const objects = [];
  const keep = o => { objects.push(o); return o; };
  try {
    doc = mupdf.Document.openDocument(input.slice(), 'application/pdf');
    if (!(doc instanceof mupdf.PDFDocument) || doc.needsPassword() || doc.wasRepaired() || !doc.canBeSavedIncrementally()) fail('INCREMENTAL_UNSUPPORTED_INPUT');
    const trailer = keep(doc.getTrailer());
    if (!keep(trailer.get('Encrypt')).isNull()) fail('INCREMENTAL_PROTECTED_INPUT');
    const count = doc.countObjects();
    if (count > 100000) fail('INCREMENTAL_OBJECT_LIMIT');
    let visited = 0;
    for (let i = 1; i < count; i++) {
      const ref = doc.newIndirect(i);
      let obj;
      try {
        obj = ref.resolve();
        // Traverse direct children too; indirect objects get their own scan.
        const visit = (v, depth = 0) => {
          if (++visited > 1000000) fail('INCREMENTAL_OBJECT_LIMIT');
          if (depth > 64) fail('INCREMENTAL_OBJECT_DEPTH');
          if (v.isDictionary()) {
            v.forEach((child, key) => {
              try {
                if (['ByteRange','DocMDP','FieldMDP'].includes(key) ||
                    (['FT','Type'].includes(key) && child.isName() && child.asName() === 'Sig')) fail('INCREMENTAL_PROTECTED_INPUT');
                if (!child.isIndirect()) visit(child, depth + 1);
              } finally { child.destroy(); }
            });
          } else if (v.isArray()) v.forEach(child => { try { if (!child.isIndirect()) visit(child, depth + 1); } finally { child.destroy(); } });
        };
        visit(obj);
      } finally { obj?.destroy(); ref.destroy(); }
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.countPages()) fail('INCREMENTAL_INVALID_PAGE');
    page = doc.loadPage(pageIndex);
    const box = page.getBounds();
    if (rect[0] < box[0] || rect[1] < box[1] || rect[2] > box[2] || rect[3] > box[3]) fail('INCREMENTAL_RECT_OUTSIDE_PAGE');
    annotation = page.createAnnotation('Text');
    annotation.setRect(rect);
    annotation.setContents(text);
    annotation.update();
    buffer = doc.saveToBuffer('incremental=yes');
    const output = buffer.asUint8Array().slice();
    if (output.length <= input.length || !input.every((b,i) => b === output[i])) fail('INCREMENTAL_PREFIX_CHANGED');
    return output;
  } finally {
    buffer?.destroy(); annotation?.destroy(); page?.destroy();
    for (const o of objects.reverse()) o.destroy();
    doc?.destroy();
  }
}
