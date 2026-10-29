// Accessibility report (#384): missing alt text and untagged content.
//
// Input: the structure tree (struct-tree.js, edits applied), what pdf.js
// found per page (reading-order.js mcidTextMap) and the annotations of the
// document as the app holds them (these are what the next save writes).
//
// Issues, each with a `kind` the dialog translates:
//   notTagged            the document has no structure tree
//   notMarked            /MarkInfo /Marked is not true
//   noLanguage           the catalog has no /Lang
//   figureNoAlt          a Figure or Formula without /Alt (or /ActualText)
//   pageNotTagged        a page with text, none of it tagged
//   untaggedContent      a page with some text outside tagged content, or
//                        tagged content the structure tree never refers to
//   annotationNoText     an annotation without a description (/Contents or
//                        alt text)
//
// No app imports: testable under node.

import { ALT_ROLES, walkElements } from './struct-tree.js';

/** Annotation types that carry no meaning of their own for a screen reader. */
const SKIPPED_ANNOTATION_TYPES = new Set(['mask', 'viewport', 'scaleRegion', 'redaction']);

/** MCIDs per page that the structure tree refers to. */
export function referencedMcids(root) {
  const out = new Map();
  const add = (page, mcid) => {
    if (!out.has(page)) out.set(page, new Set());
    out.get(page).add(mcid);
  };
  const visit = (node) => {
    for (const child of node?.children || []) {
      if (child.kind === 'mcid' && child.pageIndex != null) add(child.pageIndex, child.mcid);
      else if (child.kind === 'element') visit(child);
    }
  };
  visit(root);
  return out;
}

function annotationHasText(ann) {
  const fields = [ann.text, ann.contents, ann.altText, ann.comment];
  return fields.some((v) => typeof v === 'string' && v.trim());
}

/**
 * @param {{ tree: object, pages: Array<{ pageIndex: number, mcids: Set<number>,
 *   untaggedItems: number, taggedItems: number }>, annotations?: object[] }} input
 * @returns {{ issues: object[], counts: Record<string, number> }}
 */
export function buildAccessibilityReport({ tree, pages = [], annotations = [] }) {
  const issues = [];
  if (!tree?.tagged || !tree.root) {
    issues.push({ kind: 'notTagged', severity: 'error' });
  } else {
    if (!tree.marked) issues.push({ kind: 'notMarked', severity: 'warning' });
    for (const el of walkElements(tree.root)) {
      const role = el.standardRole || el.role;
      if (!ALT_ROLES.has(role)) continue;
      if ((el.alt && el.alt.trim()) || (el.actualText && el.actualText.trim())) continue;
      issues.push({ kind: 'figureNoAlt', severity: 'error', key: el.key, role: el.role, pageIndex: el.pageIndex ?? null });
    }
  }
  if (!tree?.lang || !tree.lang.trim()) issues.push({ kind: 'noLanguage', severity: 'warning' });

  if (tree?.tagged && tree.root) {
    const referenced = referencedMcids(tree.root);
    for (const page of pages) {
      const inTree = referenced.get(page.pageIndex) || new Set();
      const orphan = [...(page.mcids || [])].filter((m) => !inTree.has(m)).length;
      if (page.taggedItems === 0 && page.untaggedItems > 0) {
        issues.push({ kind: 'pageNotTagged', severity: 'error', pageIndex: page.pageIndex, count: page.untaggedItems });
      } else if (page.untaggedItems > 0 || orphan > 0) {
        issues.push({ kind: 'untaggedContent', severity: 'warning', pageIndex: page.pageIndex,
          count: page.untaggedItems + orphan });
      }
    }
  }

  for (const ann of annotations || []) {
    if (!ann || SKIPPED_ANNOTATION_TYPES.has(ann.type)) continue;
    if (annotationHasText(ann)) continue;
    issues.push({ kind: 'annotationNoText', severity: 'warning', pageIndex: (ann.page ?? 1) - 1,
      annotationId: ann.id, annotationType: ann.type });
  }

  issues.sort((a, b) => (a.pageIndex ?? -1) - (b.pageIndex ?? -1));
  const counts = {};
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;
  return { issues, counts };
}
