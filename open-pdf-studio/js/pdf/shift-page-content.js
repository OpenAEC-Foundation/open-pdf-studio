// PDF-side half of Shift Page: moves what is ON a page without replacing the
// page. Imports pdf-lib only, so it runs under plain `node --test`.
//
// A shift is a plain translation, so the page object stays where it is and
// its content streams are wrapped in `q 1 0 0 1 dx dy cm … Q`. Everything
// that hangs on the page dictionary therefore survives untouched: MediaBox
// with a non-zero origin, CropBox/BleedBox/TrimBox/ArtBox, /Rotate (own or
// inherited), UserUnit, /Annots (links, form fields, signature widgets) and
// every destination elsewhere in the file that points at this page object
// (bookmarks, table-of-contents links, named destinations). What describes a
// PLACE on the content — /Annots and the measure viewports /VP — is moved
// along explicitly (shiftPageAnnotations, shiftPageViewports).
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream } from "pdf-lib";

// Plain decimal notation with at most 4 decimals — a content stream has no
// exponent syntax, so "1e-7" or "Infinity" would corrupt the page.
function formatNumber(value) {
  const text = value.toFixed(4).replace(/\.?0+$/, "");
  return text === "-0" || text === "" ? "0" : text;
}

function assertOffset(cx, cy) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || Math.abs(cx) > 1e6 || Math.abs(cy) > 1e6) {
    throw new RangeError(`Shift offset out of range: ${cx}, ${cy}`);
  }
}

/**
 * The streams of an encrypted file cannot be extended: the added transform
 * would be written unencrypted and read back as garbage, wrecking the page.
 * Throws an error with `code: "encrypted"` for such a document.
 */
export function assertShiftable(pdfDoc) {
  if (pdfDoc.isEncrypted) {
    throw Object.assign(new Error("Cannot shift pages of an encrypted document"), { code: "encrypted" });
  }
}

/**
 * Translate a page's content by (cx, cy) in the page's own unrotated user
 * space (PDF points, y up), in place.
 *
 * @returns {boolean} false when the page has no content to shift (a blank
 *   page without /Contents) — the page is left untouched.
 */
export function shiftPageContent(pdfDoc, page, cx, cy) {
  assertOffset(cx, cy);
  const context = pdfDoc.context;
  const node = page.node;
  const contentsEntry = node.get(PDFName.of("Contents"));
  const contents = contentsEntry ? context.lookup(contentsEntry) : undefined;

  let streams;
  if (contents instanceof PDFStream) streams = [contentsEntry];
  else if (contents instanceof PDFArray) streams = contents.asArray();
  else return false;
  if (streams.length === 0) return false;

  // The newline before Q keeps it a separate token even when the last
  // original stream does not end in whitespace.
  const open = context.register(context.stream(`q 1 0 0 1 ${formatNumber(cx)} ${formatNumber(cy)} cm\n`));
  const close = context.register(context.stream("\nQ\n"));
  // A NEW array: the old one may be an indirect object shared with other pages.
  node.set(PDFName.of("Contents"), context.obj([open, ...streams, close]));
  return true;
}

// Annotation entries that hold absolute page coordinates as a flat
// [x1 y1 x2 y2 …] array. InkList (an array of such arrays) is handled apart.
const COORDINATE_ARRAYS = ["Rect", "QuadPoints", "Vertices", "L", "CL"];

function shiftedCoordinates(context, array, cx, cy) {
  const values = [];
  for (let i = 0; i < array.size(); i++) {
    const item = array.lookup(i);
    if (!(item instanceof PDFNumber)) return null; // not a coordinate list: leave it alone
    values.push(item.asNumber() + (i % 2 === 0 ? cx : cy));
  }
  return context.obj(values);
}

/**
 * Move the annotations stored ON the page (links, form fields, signature
 * widgets, markup the app has not loaded) by the same content-space offset,
 * so they stay on the content they belong to. An annotation's appearance is
 * positioned through its /Rect, so moving the rectangle moves what is drawn.
 *
 * @param {Set<object>} [seen] - annotation dictionaries already moved; pass
 *   one set for a whole run so a dictionary referenced twice moves once.
 * @returns {number} how many annotations were moved
 */
export function shiftPageAnnotations(pdfDoc, page, cx, cy, seen = new Set()) {
  assertOffset(cx, cy);
  const context = pdfDoc.context;
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return 0;

  let moved = 0;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i);
    if (!(dict instanceof PDFDict) || seen.has(dict)) continue;
    seen.add(dict);

    for (const key of COORDINATE_ARRAYS) {
      const name = PDFName.of(key);
      const array = dict.lookup(name);
      if (!(array instanceof PDFArray)) continue;
      const shifted = shiftedCoordinates(context, array, cx, cy);
      if (shifted) dict.set(name, shifted);
    }

    const inkName = PDFName.of("InkList");
    const inkList = dict.lookup(inkName);
    if (inkList instanceof PDFArray) {
      const strokes = [];
      let valid = true;
      for (let s = 0; s < inkList.size(); s++) {
        const stroke = inkList.lookup(s);
        const shifted = stroke instanceof PDFArray ? shiftedCoordinates(context, stroke, cx, cy) : null;
        if (!shifted) { valid = false; break; }
        strokes.push(shifted);
      }
      if (valid) dict.set(inkName, context.obj(strokes));
    }
    moved++;
  }
  return moved;
}

/**
 * Move the measure viewports stored ON the page (/VP: CAD plots and the
 * DWG/DXF import) by the same content-space offset. A viewport describes a
 * region of the content: /BBox and the import's own outline /OPS_Clip shift
 * with it, and /OPS_ModelMatrix (page → model, for the way back to CAD) takes
 * the inverse translation first, so the same content still maps to the same
 * model coordinates. /Measure itself is a ratio and stays as it is.
 *
 * @returns {number} how many viewports were moved
 */
export function shiftPageViewports(pdfDoc, page, cx, cy) {
  assertOffset(cx, cy);
  const context = pdfDoc.context;
  const viewports = page.node.lookup(PDFName.of("VP"));
  if (!(viewports instanceof PDFArray)) return 0;

  let moved = 0;
  for (let i = 0; i < viewports.size(); i++) {
    const dict = viewports.lookup(i);
    if (!(dict instanceof PDFDict)) continue;

    for (const key of ["BBox", "OPS_Clip"]) {
      const name = PDFName.of(key);
      const array = dict.lookup(name);
      if (!(array instanceof PDFArray)) continue;
      const shifted = shiftedCoordinates(context, array, cx, cy);
      if (shifted) dict.set(name, shifted);
    }

    const matrixName = PDFName.of("OPS_ModelMatrix");
    const matrix = dict.lookup(matrixName);
    if (matrix instanceof PDFArray && matrix.size() === 6) {
      const m = [];
      for (let k = 0; k < 6; k++) {
        const item = matrix.lookup(k);
        if (!(item instanceof PDFNumber)) { m.length = 0; break; }
        m.push(item.asNumber());
      }
      if (m.length === 6) {
        // model = M·(page' − t), with t = (cx, cy): only e and f change.
        const [a, b, c, d, e, f] = m;
        dict.set(matrixName, context.obj([a, b, c, d, e - cx * a - cy * c, f - cx * b - cy * d]));
      }
    }
    moved++;
  }
  return moved;
}
