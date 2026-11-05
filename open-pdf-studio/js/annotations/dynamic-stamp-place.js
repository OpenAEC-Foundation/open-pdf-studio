// Placing and editing dynamic stamps in the app (#629). The pure parts are in
// dynamic-stamp.js / dynamic-stamp-layout.js.

import { state, getActiveDocument } from '../core/state.js';
import i18next from '../i18n/config.js';
import { createAnnotation, cloneAnnotation } from './factory.js';
import { recordAdd, recordModify } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../bridge.js';
import { rechtopRotatie } from '../pdf/weergave-ruimte.js';
import { extractFileName } from '../core/platform.js';
import {
  createDynamicStamp, customFields, applyDynamicStampToAnnotation, setDynamicStampValue,
  refreshAutomaticValues, lockDynamicStamp,
} from './dynamic-stamp.js';
import { naturalStampSize, refitAfterEdit } from './dynamic-stamp-layout.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Values for the built-in fields from the active document.
 * @param {object} [doc]
 * @param {number} [page]
 */
export async function stampContext(doc = getActiveDocument(), page = doc?.currentPage) {
  let title = '';
  try {
    const meta = await doc?.pdfDoc?.getMetadata?.();
    title = meta?.info?.Title ? String(meta.info.Title) : '';
  } catch (_) { title = ''; }
  return {
    now: new Date(),
    locale: i18next.language || 'en',
    user: state.preferences?.authorName || state.defaultAuthor || '',
    page: Number.isFinite(page) ? page : undefined,
    pages: doc?.pdfDoc?.numPages,
    filename: doc?.filePath ? extractFileName(doc.filePath) : (doc?.fileName || ''),
    title,
  };
}

/**
 * Place a stamp from a template at (x, y) on the current page. With fields to
 * fill in, the fill-in dialog comes first.
 */
export async function placeDynamicStamp(template, x, y) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const page = doc.currentPage || 1;
  const ctx = await stampContext(doc, page);
  if (customFields(template).length) {
    openDialog('dynamic-stamp-fields', {
      template, context: ctx,
      onConfirm: (values) => plaats(template, ctx, values, x, y, page),
    });
    return;
  }
  plaats(template, ctx, {}, x, y, page);
}

function plaats(template, ctx, values, x, y, page) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const ds = createDynamicStamp(template, ctx, values);
  if (!ds) return null;
  const { width, height } = naturalStampSize(ds.template, ds.values);
  const ann = createAnnotation({
    type: 'stamp',
    page,
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    dynamicStamp: ds,
    opacity: 1,
    rotation: rechtopRotatie(),
  });
  applyDynamicStampToAnnotation(ann);
  doc.annotations.push(ann);
  recordAdd(ann);
  if (state.preferences.autoSelectAfterCreate) {
    doc.selectedAnnotation = ann;
    doc.selectedAnnotations = [ann];
    showProperties(ann);
  }
  redraw();
  updateStatusMessage(`Stamp "${ds.template.name}" placed`);
  return ann;
}

// One undoable edit of a placed stamp: `change` mutates and returns whether
// anything changed.
function edit(ann, change) {
  if (!ann?.dynamicStamp) return false;
  const before = cloneAnnotation(ann);
  if (!change(ann)) return false;
  refitAfterEdit(ann, before.dynamicStamp);
  ann.modifiedAt = new Date().toISOString();
  recordModify(ann.id, before, ann);
  redraw();
  return true;
}

/** Change one field value of a placed stamp (refused when locked). */
export function editDynamicStampField(ann, key, value) {
  return edit(ann, (a) => setDynamicStampValue(a, key, value));
}

/** Recompute date, user, page ... of a placed stamp. */
export async function refreshDynamicStamp(ann) {
  const doc = getActiveDocument();
  const ctx = await stampContext(doc, ann?.page);
  return edit(ann, (a) => refreshAutomaticValues(a, ctx));
}

/** Make a placed stamp final. */
export function lockPlacedDynamicStamp(ann) {
  const done = edit(ann, (a) => !a.dynamicStamp.locked && lockDynamicStamp(a));
  // The General section shows Locked / Read-only from the panel store.
  if (done) showProperties(ann);
  return done;
}
