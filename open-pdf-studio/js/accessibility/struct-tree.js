// Structure tree of a tagged PDF (/StructTreeRoot), read with pdf-lib (#384).
//
// The tree is read once per version of the file bytes, only when the tags
// panel, the accessibility report or read aloud asks for it. Nothing here runs
// while a document loads or renders, and the PDFium worker is not involved
// (#634): the model is a plain object, the pdf-lib document can be dropped.
//
// Every structure element gets a `key`: the path of its indices in the /K
// arrays from the root ("0", "0.2", "0.2.1"). Edits (alt text, reading order,
// struct-edits.js) address elements by that key on the same bytes, and the
// saver resolves the same path in its own copy of the document.
//
// Pure pdf-lib, no app imports: testable under node.

import { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';

const N = (s) => PDFName.of(s);
const MAX_DEPTH = 256;

/** Standard structure types of ISO 32000-1 and -2. */
export const STANDARD_ROLES = new Set([
  'Document', 'DocumentFragment', 'Part', 'Art', 'Sect', 'Div', 'Aside', 'BlockQuote', 'Caption',
  'TOC', 'TOCI', 'Index', 'NonStruct', 'Private', 'Title', 'FENote',
  'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody',
  'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Em', 'Strong', 'Sub',
  'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP',
  'Figure', 'Formula', 'Form', 'Artifact',
]);

/** Roles whose content is an illustration: they need /Alt. */
export const ALT_ROLES = new Set(['Figure', 'Formula']);

/** Text of a PDF text string, or null. */
export function pdfText(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return null; }
  }
  return null;
}

function nameOf(obj) {
  return obj instanceof PDFName ? obj.decodeText() : null;
}

/**
 * Standard role of `role` through the /RoleMap (chains followed, cycles
 * stopped). A role that maps to nothing standard stays as it is.
 */
export function resolveRole(role, roleMap = {}) {
  let current = role;
  const seen = new Set();
  while (current && !STANDARD_ROLES.has(current) && roleMap[current] && !seen.has(current)) {
    seen.add(current);
    current = roleMap[current];
  }
  return current || role;
}

/** The /RoleMap of a /StructTreeRoot as { custom: target }. */
function readRoleMap(ctx, root) {
  const out = {};
  const map = ctx.lookup(root.get(N('RoleMap')));
  if (!(map instanceof PDFDict)) return out;
  for (const [key, value] of map.entries()) {
    const target = nameOf(ctx.lookup(value));
    if (target) out[key.decodeText()] = target;
  }
  return out;
}

/** The /K entries of a dictionary as an array of raw (unresolved) objects. */
export function kidsOf(ctx, dict) {
  const k = dict.get(N('K'));
  if (k === undefined) return [];
  const resolved = k instanceof PDFRef ? ctx.lookup(k) : k;
  if (resolved instanceof PDFArray) return resolved.asArray();
  return [k];
}

/** Is a resolved /K entry a structure element (and not an MCR/OBJR dictionary)? */
export function isStructElement(dict) {
  if (!(dict instanceof PDFDict)) return false;
  const type = nameOf(dict.get(N('Type')));
  if (type === 'MCR' || type === 'OBJR') return false;
  return dict.get(N('S')) instanceof PDFName;
}

/** Map of page-object ref ("12 0 R") to the 0-based page index. */
export function pageIndexMap(pdfDocLib) {
  const map = new Map();
  pdfDocLib.getPages().forEach((page, index) => map.set(page.ref.toString(), index));
  return map;
}

function pageOf(dict, inherited, pages) {
  const pg = dict.get(N('Pg'));
  if (pg instanceof PDFRef) {
    const index = pages.get(pg.toString());
    if (index !== undefined) return index;
  }
  return inherited;
}

/**
 * Read the structure tree.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @returns {{ tagged: boolean, marked: boolean, lang: string|null, roleMap: object,
 *   pageCount: number, root: object|null, elementCount: number }}
 */
export function readStructTree(pdfDocLib) {
  const ctx = pdfDocLib.context;
  const catalog = pdfDocLib.catalog;
  const markInfo = ctx.lookup(catalog.get(N('MarkInfo')));
  const markedObj = markInfo instanceof PDFDict ? ctx.lookup(markInfo.get(N('Marked'))) : null;
  const marked = !!(markedObj && typeof markedObj.asBoolean === 'function' && markedObj.asBoolean());
  const lang = pdfText(ctx.lookup(catalog.get(N('Lang'))));
  const pageCount = pdfDocLib.getPageCount();
  const rootDict = ctx.lookup(catalog.get(N('StructTreeRoot')));
  if (!(rootDict instanceof PDFDict)) {
    return { tagged: false, marked, lang, roleMap: {}, pageCount, root: null, elementCount: 0 };
  }
  const roleMap = readRoleMap(ctx, rootDict);
  const pages = pageIndexMap(pdfDocLib);
  const visited = new Set();
  let elementCount = 0;

  function readKids(dict, parentKey, page, depth) {
    const children = [];
    kidsOf(ctx, dict).forEach((raw, index) => {
      const child = readKid(raw, index, parentKey, page, depth);
      if (child) children.push(child);
    });
    return children;
  }

  function readKid(raw, index, parentKey, page, depth) {
    if (raw instanceof PDFNumber) {
      return { kind: 'mcid', index, mcid: raw.asNumber(), pageIndex: page };
    }
    const obj = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
    if (!(obj instanceof PDFDict)) return null;
    const type = nameOf(obj.get(N('Type')));
    if (type === 'MCR') {
      const mcid = ctx.lookup(obj.get(N('MCID')));
      if (!(mcid instanceof PDFNumber)) return null;
      return { kind: 'mcid', index, mcid: mcid.asNumber(), pageIndex: pageOf(obj, page, pages) };
    }
    if (type === 'OBJR') {
      const target = obj.get(N('Obj'));
      return { kind: 'objr', index, objRef: target instanceof PDFRef ? target.toString() : null, pageIndex: pageOf(obj, page, pages) };
    }
    if (!isStructElement(obj)) return null;
    if (raw instanceof PDFRef) {
      if (visited.has(raw.toString())) return null;
      visited.add(raw.toString());
    }
    if (depth > MAX_DEPTH) return null;
    const key = parentKey === '' ? String(index) : `${parentKey}.${index}`;
    return readElement(obj, raw instanceof PDFRef ? raw.toString() : null, index, key, page, depth + 1);
  }

  function readElement(dict, ref, index, key, inheritedPage, depth) {
    elementCount++;
    const role = nameOf(dict.get(N('S')));
    const page = pageOf(dict, inheritedPage, pages);
    return {
      kind: 'element',
      index,
      key,
      ref,
      role,
      standardRole: resolveRole(role, roleMap),
      alt: pdfText(ctx.lookup(dict.get(N('Alt')))),
      actualText: pdfText(ctx.lookup(dict.get(N('ActualText')))),
      title: pdfText(ctx.lookup(dict.get(N('T')))),
      lang: pdfText(ctx.lookup(dict.get(N('Lang')))),
      pageIndex: page,
      kidCount: kidsOf(ctx, dict).length,
      children: readKids(dict, key, page, depth),
    };
  }

  const root = {
    kind: 'root', key: '', role: 'StructTreeRoot', standardRole: 'StructTreeRoot',
    pageIndex: null, kidCount: kidsOf(ctx, rootDict).length, children: readKids(rootDict, '', null, 0),
  };
  return { tagged: true, marked, lang, roleMap, pageCount, root, elementCount };
}

/** Depth-first walk over the elements of a (display) tree. */
export function* walkElements(node) {
  for (const child of node?.children || []) {
    if (child.kind !== 'element') continue;
    yield child;
    yield* walkElements(child);
  }
}

/** Find an element by key in a tree. */
export function findByKey(root, key) {
  if (!root) return null;
  if (key === '' || key == null) return root;
  for (const el of walkElements(root)) if (el.key === key) return el;
  return null;
}
