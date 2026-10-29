// Reading order of a document for read aloud and the tags panel (#384).
//
// Tagged document: the order of the structure tree (depth first through the
// /K arrays), not the order of the content streams. Each block element (P,
// H1, LI, TD, ...) becomes one segment; inline elements (Span, Link, ...)
// stay in the segment of their block. A Figure or Formula with /Alt is read
// as its alt text, an element with /ActualText as that text, and Artifact
// elements are not read.
//
// The text of marked content comes from pdf.js: getTextContent with
// includeMarkedContent gives begin/end markers with an id that ends in
// "_mc<MCID>". Segments only point to (page, MCID); the text of a page is
// fetched when a segment on it is about to be read.
//
// Untagged document: the text of each page in content order.
//
// No app imports: testable under node.

export const INLINE_ROLES = new Set([
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Em', 'Strong', 'Sub',
  'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP', 'Lbl', 'LBody',
]);

const MCID_ID = /_mc(\d+)$/;

/** MCID of a pdf.js marked-content id ("p12R_mc3" -> 3), or null. */
export function mcidFromId(id) {
  const m = typeof id === 'string' ? MCID_ID.exec(id) : null;
  return m ? Number(m[1]) : null;
}

function itemText(item) {
  return item.str + (item.hasEOL ? ' ' : '');
}

/** Collapse whitespace. */
export function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Text per MCID of one page, from getTextContent({ includeMarkedContent: true }).
 * @param {Array<object>} items  textContent.items
 * @returns {{ byMcid: Map<number,string>, mcids: Set<number>, untaggedItems: number,
 *   taggedItems: number, artifactItems: number }}
 */
export function mcidTextMap(items) {
  const byMcid = new Map();
  const mcids = new Set();
  const stack = [];
  let untaggedItems = 0;
  let taggedItems = 0;
  let artifactItems = 0;
  for (const item of items || []) {
    if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') {
      const mcid = item.type === 'beginMarkedContentProps' ? mcidFromId(item.id) : null;
      if (mcid !== null) mcids.add(mcid);
      stack.push({ mcid, artifact: item.tag === 'Artifact' });
      continue;
    }
    if (item.type === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (typeof item.str !== 'string') continue;
    let mcid = null;
    let artifact = false;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].artifact) artifact = true;
      if (mcid === null && stack[i].mcid !== null) mcid = stack[i].mcid;
    }
    if (artifact) {
      if (item.str.trim()) artifactItems++;
      continue;
    }
    if (mcid !== null) {
      byMcid.set(mcid, (byMcid.get(mcid) || '') + itemText(item));
      if (item.str.trim()) taggedItems++;
    } else if (item.str.trim()) {
      untaggedItems++;
    }
  }
  return { byMcid, mcids, untaggedItems, taggedItems, artifactItems };
}

/** Text of a page in content-stream order (marked content ignored). */
export function contentOrderText(items) {
  let out = '';
  for (const item of items || []) if (typeof item.str === 'string') out += itemText(item);
  return cleanText(out);
}

/**
 * Segments of a structure tree in reading order.
 * @param {object} root  tree (with edits applied) from struct-tree.js
 * @returns {Array<{ key: string, role: string, pageIndex: number|null,
 *   parts: Array<{ text: string } | { pageIndex: number, mcid: number }> }>}
 */
export function structureSegments(root) {
  const segments = [];
  let current = null;
  const flush = () => {
    if (current && current.parts.length) {
      current.pageIndex = current.parts.find((p) => p.pageIndex != null)?.pageIndex ?? current.pageIndex;
      segments.push(current);
    }
    current = null;
  };
  const open = (node) => {
    flush();
    current = { key: node.key, role: node.standardRole || node.role, pageIndex: node.pageIndex ?? null, parts: [] };
  };
  const ensure = (node) => { if (!current) open(node); };

  const visit = (node, owner) => {
    for (const child of node.children || []) {
      if (child.kind === 'mcid') {
        if (child.pageIndex == null) continue;
        ensure(owner);
        current.parts.push({ pageIndex: child.pageIndex, mcid: child.mcid });
        continue;
      }
      if (child.kind !== 'element') continue;
      const role = child.standardRole || child.role;
      if (role === 'Artifact') continue;
      const inline = INLINE_ROLES.has(role);
      const replacement = cleanText(child.actualText) || ((role === 'Figure' || role === 'Formula') ? cleanText(child.alt) : '');
      if (inline) {
        if (replacement) {
          ensure(child);
          current.parts.push({ text: replacement, pageIndex: child.pageIndex });
        } else {
          visit(child, owner);
        }
        continue;
      }
      open(child);
      if (replacement) current.parts.push({ text: replacement, pageIndex: child.pageIndex });
      else visit(child, child);
      flush();
    }
  };
  if (root) visit(root, root);
  flush();
  return segments;
}

/**
 * Text of a segment.
 * @param {object} segment
 * @param {(pageIndex: number) => Map<number,string>|undefined} byMcidOfPage
 */
export function segmentText(segment, byMcidOfPage) {
  const pieces = [];
  for (const part of segment.parts) {
    if (typeof part.text === 'string') pieces.push(part.text);
    else pieces.push(byMcidOfPage(part.pageIndex)?.get(part.mcid) || '');
  }
  return cleanText(pieces.join(' '));
}

/** Pages a segment needs text for. */
export function segmentPages(segment) {
  const pages = new Set();
  for (const part of segment.parts) if (part.mcid !== undefined && part.pageIndex != null) pages.add(part.pageIndex);
  return [...pages];
}

/** Index of the first segment on or after page `pageIndex`, or -1. */
export function firstSegmentFromPage(segments, pageIndex) {
  const exact = segments.findIndex((s) => s.pageIndex === pageIndex);
  if (exact >= 0) return exact;
  return segments.findIndex((s) => s.pageIndex != null && s.pageIndex > pageIndex);
}

/**
 * Split text into pieces of at most `max` characters, at sentence ends where
 * possible, then at spaces. Speech engines cut off or stall on long input.
 */
export function splitForSpeech(text, max = 280) {
  const clean = cleanText(text);
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?;:。！？]+[.!?;:。！？]*\s*/g) || [clean];
  const out = [];
  let buf = '';
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const sentence of sentences) {
    if ((buf + sentence).length <= max) { buf += sentence; continue; }
    push();
    if (sentence.length <= max) { buf = sentence; continue; }
    let rest = sentence;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    buf = rest;
  }
  push();
  return out.filter(Boolean);
}
