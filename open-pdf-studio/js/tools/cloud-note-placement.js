import { getActiveDocument } from '../core/state.js';
import { closestCloudVertex } from '../annotations/cloud-note.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import i18next from '../i18n/config.js';

let pending = null;

export function beginCloudNote(ctx, cloud) {
  if (!ctx.state.preferences.cloudAttachNote || !cloud) return false;
  pending = { documentId: getActiveDocument()?.id, page: cloud.page, cloudId: cloud.id };
  updateStatusMessage(i18next.t('drawing.calloutStep2', { ns: 'ribbon' }), 6000);
  return true;
}

export function cancelCloudNote() {
  const wasPending = !!pending;
  pending = null;
  return wasPending;
}

function pendingCloud(ctx) {
  const doc = getActiveDocument();
  if (!pending) return null;
  const cloud = doc?.id === pending.documentId && ctx.state.preferences.cloudAttachNote
    && doc.annotations.find(a => a.id === pending.cloudId);
  if (!cloud) cancelCloudNote();
  return cloud;
}

export function previewCloudNote(ctx, event) {
  const cloud = pendingCloud(ctx);
  if (!cloud) return false;
  if (cloud.page !== (ctx.pageNum || getActiveDocument().currentPage)) return true;
  const point = closestCloudVertex(cloud, ctx.x, ctx.y);
  if (point) {
    ctx.state.startX = point.x;
    ctx.state.startY = point.y;
    ctx.drawShapePreview(ctx.x, ctx.y, event, undefined, 'callout');
  }
  return true;
}

export function placeCloudNote(ctx, event) {
  const cloud = pendingCloud(ctx);
  if (!cloud) return false;
  if (event.button === 2) {
    ctx.state._suppressNextContextmenu = true;
    cancelCloudNote();
    ctx.redraw();
    return true;
  }
  if (event.button !== 0 || event.detail === 2) return true;
  const doc = getActiveDocument();
  if (cloud.page !== (ctx.pageNum || doc.currentPage)) {
    cancelCloudNote();
    return false;
  }
  const point = closestCloudVertex(cloud, ctx.x, ctx.y);
  if (!point) return true;
  const note = ctx.createAnnotationFromTool('callout', point.x, point.y, ctx.x, ctx.y, event);
  if (!note) return true;
  Object.assign(note, { page: cloud.page, inReplyTo: cloud.id, replyType: 'reply', cloudVertex: point.index });
  cancelCloudNote();
  doc.annotations.push(note);
  ctx.recordAdd(note);
  doc.selectedAnnotations = [note];
  doc.selectedAnnotation = note;
  ctx.redraw();
  ctx.showProperties(note);
  event.preventDefault?.();
  ctx.startTextEditing(note, { nieuw: true });
  import('./manager.js').then(m => m.maybeRevertToSelect());
  return true;
}
