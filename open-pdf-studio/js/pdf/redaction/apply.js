// Secure redaction of a PDF document (#762) — pdf-lib only, no app imports.
//
// redactDocument(pdfDoc, marks) removes everything under the marks from the
// document itself:
// - page content and nested Form XObjects (content.js: glyphs, path
//   geometry, image pixels, shadings),
// - annotations whose rectangle touches a mark (including links, popups and
//   replies of removed annotations, and their structure-tree references),
// - form fields with a widget under a mark (the widget, and the field with its
//   value when it has no other widget left),
// - replacement/alternate text (/ActualText, /Alt, /E) of structure elements
//   and marked content whose content was cut,
// and then paints the overlay (the mark's fill colour) into the page content.
//
// redactPdfBytes() does the same on bytes and writes a complete new file:
// only objects reachable from the trailer, no earlier revisions (the parser
// keeps one version of each object; a full write does not append), no object
// streams, verified by an independent parse of the written bytes.
//
// Known limits (what is NOT removed or only approximated):
// - A glyph is judged by its box (advance width × font ascent/descent); ink
//   outside that box (overhangs) does not count. A glyph partly in an area is
//   removed whole. Text in a font whose widths are unknown (predefined
//   non-Identity CMaps, missing font resources) is refused near an area.
// - Clipping paths are kept unchanged (they paint nothing). Strokes are cut
//   along their centre line; curves of cut subpaths become polylines
//   (0.05 pt). The cells of tiling patterns and shading functions are not
//   edited: the painted area is cut/clipped out instead.
// - Image pixels partly in an area are filled whole. A JPEG is re-encoded
//   (quality 95, slight change across the image); JPX/JBIG2/CCITT data is
//   written as Flate. Type3 glyph procedures are not edited.
// - Annotations are removed whole when their rectangle touches an area; the
//   appearances of kept annotations are not edited.
// - Document-level data (metadata, bookmarks, attachments, scripts) is not
//   touched here: that is Remove Hidden Information (hidden-information.js).

import { PDFDocument } from 'pdf-lib';
import {
  N, PDFDict, PDFArray, PDFName, PDFRef, PDFStream, get, nameOf, numbers, resolve, streamBytes,
} from './pdf-values.js';
import { rewriteContent, withXObjects, RedactionError, OVERLAY_TAG } from './content.js';
import { normaliseConvex, convexIntersect, rectQuad, IDENTITY } from './geometry.js';
import { fmtNum } from './lexer.js';
import { sweepUnreachable, purgeAnnotationReferences } from '../hidden-information.js';
import { readObjects } from '../hidden-information-scan.js';

export { RedactionError };
/** Page-dictionary key: marks applied since the last save (re-applied by the saver). */
export const PENDING_KEY = 'OPS_PendingRedactions';

/**
 * Validate marks: [{pageIndex, quad:[[x,y]×4], fill:[r,g,b]|null}] in default
 * user space. Throws REDACTION_INVALID_AREA listing every invalid mark.
 */
export function validateMarks(marks, pageCount) {
  if (!Array.isArray(marks) || !marks.length) throw new RedactionError('REDACTION_NO_AREAS', 'no redaction areas');
  const bad = [];
  const valid = marks.map((m, i) => {
    const pageOk = Number.isInteger(m?.pageIndex) && m.pageIndex >= 0 && m.pageIndex < pageCount;
    const poly = Array.isArray(m?.quad) ? normaliseConvex(m.quad) : null;
    let areaOk = false;
    if (poly) {
      let a = 0;
      for (let k = 0; k < poly.length; k++) { const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length]; a += x0 * y1 - x1 * y0; }
      areaOk = Math.abs(a / 2) >= 1e-4;
    }
    const fillOk = m?.fill === null || m?.fill === undefined || (Array.isArray(m.fill) && m.fill.length === 3 && m.fill.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
    if (!pageOk || !poly || !areaOk || !fillOk) bad.push({ index: i, id: m?.id ?? null, reason: !pageOk ? 'page' : !poly || !areaOk ? 'area' : 'fill' });
    return { ...m, quad: poly };
  });
  if (bad.length) throw Object.assign(new RedactionError('REDACTION_INVALID_AREA', bad), { invalid: bad });
  return valid;
}

function rectOf(context, d) {
  const r = numbers(context, get(context, d, 'Rect'));
  if (!r || r.length !== 4) return null;
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

function contentStreams(context, page) {
  const c = resolve(context, page.node.get(N('Contents')));
  if (c instanceof PDFStream) return [{ ref: page.node.get(N('Contents')), stream: c }];
  if (c instanceof PDFArray) {
    return c.asArray().map((r) => ({ ref: r, stream: resolve(context, r) })).filter((x) => x.stream instanceof PDFStream);
  }
  return [];
}

function copyStream(context, original, bytes) {
  const entries = {};
  for (const [k, v] of original.dict.entries()) {
    const key = k.decodeText();
    if (key === 'Length' || key === 'Filter' || key === 'DecodeParms' || key === 'DL') continue;
    entries[key] = v;
  }
  return context.register(context.flateStream(bytes, entries));
}

function overlaySyntax(marks) {
  let s = `/${OVERLAY_TAG} BMC\nq\n`;
  for (const m of marks) {
    if (!m.fill) continue;
    s += `${m.fill.map(fmtNum).join(' ')} rg\n`;
    m.quad.forEach(([x, y], i) => { s += `${fmtNum(x)} ${fmtNum(y)} ${i ? 'l' : 'm'}\n`; });
    s += 'h f\n';
  }
  return s + 'Q\nEMC\n';
}

/** Remove annotations (and widgets with their fields) touching the regions. */
function removeAnnotations(pdf, page, regions, removed, stats) {
  const context = pdf.context;
  const annots = resolve(context, page.node.get(N('Annots')));
  if (!(annots instanceof PDFArray)) return;
  const keep = [];
  const local = new Set();
  const items = annots.asArray();
  // First pass: by rectangle.
  for (const ref of items) {
    const d = resolve(context, ref);
    const r = d instanceof PDFDict ? rectOf(context, d) : null;
    const hit = r && regions.some((C) => convexIntersect(rectQuad(IDENTITY, r[0], r[1], r[2], r[3]), C));
    if (hit) { if (ref instanceof PDFRef) { removed.add(ref.toString()); local.add(ref.toString()); } stats.annotations++; if (nameOf(get(context, d, 'Subtype')) === 'Widget') stats.widgets++; }
  }
  // Popups and replies of removed annotations go too (repeat for chains).
  let grew = true;
  while (grew) {
    grew = false;
    for (const ref of items) {
      if (!(ref instanceof PDFRef) || removed.has(ref.toString())) continue;
      const d = resolve(context, ref);
      if (!(d instanceof PDFDict)) continue;
      for (const k of ['Parent', 'IRT']) {
        const p = d.get(N(k));
        if (p instanceof PDFRef && removed.has(p.toString()) && nameOf(get(context, d, 'Subtype')) !== 'Widget') { removed.add(ref.toString()); local.add(ref.toString()); stats.annotations++; grew = true; break; }
      }
    }
  }
  for (const ref of items) {
    if (ref instanceof PDFRef && local.has(ref.toString())) continue;
    keep.push(ref);
  }
  if (keep.length !== items.length) page.node.set(N('Annots'), context.obj(keep));
}

/** Remove widgets from the field tree; fields left without widgets go (with their values). */
function pruneFields(pdf, removed) {
  const context = pdf.context;
  const acro = get(context, pdf.catalog, 'AcroForm');
  if (!(acro instanceof PDFDict)) return 0;
  let fieldsRemoved = 0;
  // Returns true when the node should be removed from its parent.
  const visit = (ref, depth) => {
    if (depth > 64) return false;
    const d = resolve(context, ref);
    if (!(d instanceof PDFDict)) return false;
    const isRemovedWidget = ref instanceof PDFRef && removed.has(ref.toString());
    const kids = get(context, d, 'Kids');
    if (kids instanceof PDFArray) {
      const before = kids.size();
      for (let i = kids.size() - 1; i >= 0; i--) if (visit(kids.get(i), depth + 1)) kids.remove(i);
      if (before > 0 && kids.size() === 0) { fieldsRemoved++; return true; }
      return isRemovedWidget;
    }
    if (isRemovedWidget) { fieldsRemoved++; return true; }
    return false;
  };
  const fields = get(context, acro, 'Fields');
  if (fields instanceof PDFArray) for (let i = fields.size() - 1; i >= 0; i--) if (visit(fields.get(i), 0)) fields.remove(i);
  // /CO (calculation order) may point at removed fields.
  const co = get(context, acro, 'CO');
  if (co instanceof PDFArray) {
    for (let i = co.size() - 1; i >= 0; i--) {
      const f = co.get(i);
      if (f instanceof PDFRef && !reachableFrom(context, fields, f)) co.remove(i);
    }
  }
  return fieldsRemoved;
}

function reachableFrom(context, root, target) {
  const seen = new Set();
  const stack = [root];
  const t = target.toString();
  while (stack.length) {
    let v = stack.pop();
    if (v instanceof PDFRef) { if (v.toString() === t) return true; if (seen.has(v.toString())) continue; seen.add(v.toString()); v = context.lookup(v); }
    if (v instanceof PDFArray) stack.push(...v.asArray());
    else if (v instanceof PDFDict) { const k = v.get(N('Kids')); if (k) stack.push(k); }
  }
  return false;
}

/** Strip /Alt, /ActualText and /E from structure elements on `pageRef` holding the MCIDs. */
function stripStructureText(pdf, pageRef, mcids, stats) {
  if (!mcids.size) return;
  const context = pdf.context;
  const root = get(context, pdf.catalog, 'StructTreeRoot');
  if (!(root instanceof PDFDict)) return;
  const seen = new Set();
  const visit = (node, pg, depth) => {
    if (depth > 256) return false;
    if (node instanceof PDFRef) { if (seen.has(node.toString())) return false; seen.add(node.toString()); }
    const d = resolve(context, node);
    if (typeof d?.asNumber === 'function') return pg === pageRef?.toString() && mcids.has(d.asNumber());
    if (d instanceof PDFArray) { let any = false; for (const k of d.asArray()) if (visit(k, pg, depth + 1)) any = true; return any; }
    if (!(d instanceof PDFDict)) return false;
    const type = nameOf(get(context, d, 'Type'));
    const p = d.get(N('Pg'));
    const myPg = p instanceof PDFRef ? p.toString() : pg;
    if (type === 'MCR') {
      const mc = get(context, d, 'MCID');
      return myPg === pageRef?.toString() && typeof mc?.asNumber === 'function' && mcids.has(mc.asNumber());
    }
    if (type === 'OBJR') return false;
    const k = d.get(N('K'));
    const hit = k !== undefined && visit(k, myPg, depth + 1);
    if (hit) {
      for (const key of ['Alt', 'ActualText', 'E']) if (d.has(N(key))) { d.delete(N(key)); stats.alternateTexts++; }
    }
    return hit;
  };
  visit(root.get(N('K')), null, 0);
}

/**
 * Redact a loaded pdf-lib document in place.
 * @param {PDFDocument} pdf
 * @param {{pageIndex:number, quad:number[][], fill?:number[]|null, id?:string}[]} marks
 * @param {{overlay?:boolean, annotations?:boolean, pending?:boolean}} [opts]
 *   overlay: paint the fill colour (default true); annotations: remove
 *   annotations/fields under the marks (default true); pending: record the
 *   marks on the page so the app's saver re-applies them (default false).
 */
export async function redactDocument(pdf, marks, { overlay = true, annotations = true, pending = false } = {}) {
  const pages = pdf.getPages();
  const valid = validateMarks(marks, pages.length);
  const context = pdf.context;
  const stats = { pages: 0, glyphs: 0, paths: 0, images: 0, forms: 0, shadings: 0, annotations: 0, widgets: 0, fields: 0, alternateTexts: 0, zeroSizeGlyphs: 0 };
  const byPage = new Map();
  for (const m of valid) { if (!byPage.has(m.pageIndex)) byPage.set(m.pageIndex, []); byPage.get(m.pageIndex).push(m); }
  const removedAnnots = new Set();
  const fontCache = new Map();
  for (const [pageIndex, pageMarks] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const page = pages[pageIndex];
    const regions = pageMarks.map((m) => m.quad);
    const fill = (pageMarks.find((m) => m.fill)?.fill) || [0, 0, 0];
    const mb = page.getMediaBox();
    const env = {
      context, regions, fill, stats, mcids: new Set(), fontCache,
      pageBox: [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height],
    };
    const list = contentStreams(context, page);
    let decoded;
    try { decoded = list.map((x) => streamBytes(x.stream)); } catch (e) {
      throw new RedactionError('REDACTION_UNSUPPORTED_CONTENT', `page ${pageIndex + 1}: content cannot be decoded (${e?.message || e})`);
    }
    const resources = page.node.Resources();
    const r = await rewriteContent(env, decoded, resources instanceof PDFDict ? resources : null, { ctm: IDENTITY.slice() });
    const refs = list.map((x, i) => (r.outputs[i] ? copyStream(context, x.stream, r.outputs[i]) : x.ref));
    if (overlay && pageMarks.some((m) => m.fill)) {
      refs.unshift(context.register(context.flateStream('q\n')));
      refs.push(context.register(context.flateStream('Q\n' + overlaySyntax(pageMarks))));
    }
    if (r.xobjects.size) page.node.set(N('Resources'), withXObjects(context, resources, r.xobjects));
    page.node.set(N('Contents'), context.obj(refs));
    if (annotations) removeAnnotations(pdf, page, regions, removedAnnots, stats);
    stripStructureText(pdf, page.ref, env.mcids, stats);
    if (pending) {
      const prev = get(context, page.node, PENDING_KEY);
      const all = prev instanceof PDFArray ? prev.asArray().map((q) => numbers(context, q)).filter(Boolean) : [];
      for (const m of pageMarks) all.push(m.quad.flat());
      page.node.set(N(PENDING_KEY), context.obj(all));
    }
    stats.pages++;
  }
  if (removedAnnots.size) {
    stats.fields = pruneFields(pdf, removedAnnots);
    purgeAnnotationReferences(pdf, removedAnnots);
  }
  return stats;
}

/**
 * Re-apply the marks recorded on the pages (content only: no overlay, the
 * overlay is already in the content) and remove the record. Used by the saver
 * after it wrote text edits, OCR text and watermarks into the pages.
 */
export async function applyPendingRedactions(pdf, { keepRecord = false } = {}) {
  const context = pdf.context;
  const marks = [];
  pdf.getPages().forEach((page, pageIndex) => {
    const rec = get(context, page.node, PENDING_KEY);
    if (!(rec instanceof PDFArray)) return;
    for (const q of rec.asArray()) {
      const n = numbers(context, q);
      if (n && n.length >= 6 && n.length % 2 === 0) {
        const quad = [];
        for (let i = 0; i < n.length; i += 2) quad.push([n[i], n[i + 1]]);
        marks.push({ pageIndex, quad, fill: null });
      }
    }
    if (!keepRecord) page.node.delete(N(PENDING_KEY));
  });
  if (!marks.length) return null;
  return redactDocument(pdf, marks, { overlay: false, annotations: false });
}

/** Unreferenced objects in written bytes (independent parse). */
export function unreferencedObjects(bytes) {
  const { objects, trailers } = readObjects(bytes);
  const refsIn = function* (v) {
    if (v && typeof v === 'object' && 'num' in v && 'gen' in v && typeof v.key === 'string') yield v.key;
    else if (v instanceof Map) for (const c of v.values()) yield* refsIn(c);
    else if (Array.isArray(v)) for (const c of v) yield* refsIn(c);
  };
  const seen = new Set();
  const stack = [];
  for (const t of trailers) for (const r of refsIn(t)) stack.push(r);
  while (stack.length) { const k = stack.pop(); if (seen.has(k)) continue; seen.add(k); const o = objects.get(k); if (o) for (const r of refsIn(o.value)) stack.push(r); }
  return [...objects.keys()].filter((k) => !seen.has(k));
}

/**
 * Redact PDF bytes and write a complete new file.
 * @returns {Promise<{bytes: Uint8Array, stats: object}>}
 */
export async function redactPdfBytes(bytes, marks, opts = {}) {
  const pdf = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const stats = await redactDocument(pdf, marks, opts);
  await pdf.flush();
  sweepUnreachable(pdf);
  const out = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  const left = unreferencedObjects(out);
  if (left.length) throw new RedactionError('REDACTION_VERIFICATION_FAILED', `unreferenced objects remain: ${left.join(', ')}`);
  return { bytes: out, stats };
}
