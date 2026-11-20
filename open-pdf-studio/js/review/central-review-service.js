import { state, getActiveDocument } from '../core/state.js';
import { createCentralReviewLive } from './central-review-live.js';
import { centralReviewConnections } from './central-review-registry.js';

export function startCentralReview(connection, role) {
  const doc = connection.resource.doc;
  let timer, polling = null, stopped = false, failures = 0;
  const controller = createCentralReviewLive(connection, {
    writable: role !== 'reader',
    canSync: () => getActiveDocument() !== doc || !(state.isDrawing || state.isDragging || state.isResizing ||
      state.isDrawingPolyline || state.isDrawingCloudPolyline || state.isDrawingSpline ||
      state.isDrawingSplineArrow || state.isDrawingDimension || state.editingAnnotation),
    onStatus: status => {
      // DocumentState is already a createMutable proxy: keep the UI reactive.
      if (state.documents.includes(doc)) doc.centralReview = status;
    },
  });
  function tick() {
    if (polling) return polling;
    polling = run().finally(() => { polling = null; });
    return polling;
  }
  async function run() {
    clearTimeout(timer);
    if (stopped) return;
    await controller.step();
    if (stopped) return;
    if (!connection.isCurrent() || !connection.resource.isCurrent()) { await stop(); return; }
    const error = doc.centralReview?.error;
    failures = error && error !== 'CONFLICT' ? Math.min(failures + 1, 5) : 0;
    // ACL/protocol failures require a deliberate retry, not an endless storm.
    if (['ACCESS_DENIED', 'SESSION_CLOSED', 'INVALID_RESPONSE', 'INVALID_REQUEST'].includes(error)) return;
    timer = setTimeout(tick, Math.min(2000 * 2 ** failures, 30000));
  }
  async function stop() {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    centralReviewConnections.delete(doc);
    await controller.stop();
  }
  const service = { stop, retry: tick, resolve(id, choice) { controller.resolve(id, choice); return tick(); } };
  centralReviewConnections.set(doc, service);
  void tick();
  return service;
}
