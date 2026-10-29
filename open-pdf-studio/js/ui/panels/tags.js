// Tags panel (#384): the structure tree of the document, its reading order
// and the alt text of its elements.
//
// The tree is read only when this panel is shown (accessibility-service.js),
// never while a document opens. Edits go to `doc.structEdits` and into the
// file at the next save (struct-edits.js, saver.js).

import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import {
  setTagTree as setTree, setTagCountText as setCountText, setTagEmptyMessage as setEmptyMessage,
  setTagSelected as setSelected, setTagHasTree as setHasTree,
} from '../../bridge.js';
import { markDocumentModified } from '../chrome/tabs.js';
import { getDisplayTree, getPageText } from '../../accessibility/accessibility-service.js';
import { editsOf, withAlt, withOrder, movedOrder } from '../../accessibility/struct-edits.js';
import { ALT_ROLES, findByKey } from '../../accessibility/struct-tree.js';
import { cleanText } from '../../accessibility/reading-order.js';
import { onStructEditsSaved } from '../../accessibility/struct-tree-events.js';

let currentRoot = null;
let currentDoc = null;
let selectedUid = null;
let loadToken = 0;

/** Row id: an element's key, or parent key + '#' + /K index for content. */
export function uidOf(parentKey, child) {
  return child.kind === 'element' ? child.key : `${parentKey}#${child.index}`;
}

function withUids(node) {
  return {
    ...node,
    children: (node.children || []).map((c) => (c.kind === 'element' ? { ...withUids(c), uid: c.key } : { ...c, uid: uidOf(node.key, c) })),
  };
}

function findParent(root, uid) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const children = node.children || [];
    const pos = children.findIndex((c) => c.uid === uid);
    if (pos >= 0) return { parent: node, pos, child: children[pos] };
    for (const c of children) if (c.kind === 'element') stack.push(c);
  }
  return null;
}

function publishSelection() {
  if (!currentRoot || !selectedUid) { setSelected(null); return; }
  const found = findParent(currentRoot, selectedUid);
  if (!found) { selectedUid = null; setSelected(null); return; }
  const { parent, pos, child } = found;
  const role = child.standardRole || child.role || '';
  setSelected({
    uid: child.uid,
    kind: child.kind,
    key: child.kind === 'element' ? child.key : null,
    role: child.role || '',
    standardRole: role,
    alt: child.alt || '',
    altRole: child.kind === 'element' && ALT_ROLES.has(role),
    canMoveUp: pos > 0,
    canMoveDown: pos < (parent.children || []).length - 1,
  });
}

async function render(doc) {
  const token = ++loadToken;
  const tree = await getDisplayTree(doc);
  if (token !== loadToken) return;
  currentDoc = doc;
  if (!tree?.tagged || !tree.root || !tree.root.children.length) {
    currentRoot = null;
    setHasTree(false);
    setTree([]);
    setSelected(null);
    setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noTags'));
    return;
  }
  currentRoot = withUids(tree.root);
  setHasTree(true);
  setEmptyMessage(null);
  setTree(currentRoot.children);
  setCountText(i18next.t('leftPanel.tagsCount', { count: tree.elementCount }));
  publishSelection();
}

export async function updateTagsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    loadToken++;
    currentRoot = null;
    currentDoc = null;
    setHasTree(false);
    setTree([]);
    setSelected(null);
    setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }
  if (activeDoc !== currentDoc) selectedUid = null;
  if (!currentRoot || activeDoc !== currentDoc) setEmptyMessage(i18next.t('loading'));
  try {
    await render(activeDoc);
  } catch (e) {
    console.warn('Failed to load tags:', e);
    currentRoot = null;
    setHasTree(false);
    setTree([]);
    setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.couldNotLoadTags'));
  }
}

export function selectTag(uid) {
  selectedUid = uid || null;
  publishSelection();
}

/** Move the selected row up (-1) or down (+1) within its parent. */
export async function moveSelectedTag(delta) {
  const doc = getActiveDocument();
  if (!doc || doc !== currentDoc || !currentRoot || !selectedUid) return;
  const found = findParent(currentRoot, selectedUid);
  if (!found) return;
  const order = movedOrder(found.parent, found.pos, delta);
  if (!order) return;
  doc.structEdits = withOrder(editsOf(doc), found.parent.key, found.parent.role, order);
  markDocumentModified(doc);
  await render(doc);
}

/** Set the alt text of the selected element. */
export async function setSelectedAlt(value) {
  const doc = getActiveDocument();
  if (!doc || doc !== currentDoc || !currentRoot || !selectedUid) return;
  const el = findByKey(currentRoot, selectedUid);
  if (!el || el.kind !== 'element') return;
  const next = String(value ?? '');
  if ((el.alt || '') === next) return;
  doc.structEdits = withAlt(editsOf(doc), el.key, el.role, next);
  markDocumentModified(doc);
  await render(doc);
}

/** Text of one piece of marked content, for the row in the tree. */
export async function contentSnippet(pageIndex, mcid) {
  const doc = getActiveDocument();
  if (!doc || pageIndex == null) return '';
  try {
    const info = await getPageText(doc, pageIndex);
    const text = cleanText(info.byMcid.get(mcid) || '');
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  } catch {
    return '';
  }
}

export function goToTagPage(pageIndex) {
  if (pageIndex == null) return;
  import('../../pdf/renderer.js').then((m) => m.goToPage(pageIndex + 1)).catch(() => {});
}

// After a save the edits are in the file and the tree is read again.
onStructEditsSaved((doc) => {
  if (doc === currentDoc) updateTagsList();
});
