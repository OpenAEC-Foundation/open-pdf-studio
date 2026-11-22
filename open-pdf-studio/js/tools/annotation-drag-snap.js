import { state } from '../core/state.js';
import { collectSnapPoints } from './snap-engine.js';
import { createPointIndex, createMoveInferenceSession } from './move-inference.js';

// Capture geometry BEFORE the first move. Every mouse position is resolved
// against these originals, never against the already translated selection.
export function createAnnotationDragSnap({ annotations, originals, page, start }) {
  const excludeIds = new Set(originals.map(a => a.id));
  const ownPoints = collectSnapPoints(originals, page);
  const staticIndex = createPointIndex(collectSnapPoints(annotations, page, excludeIds));
  const inference = createMoveInferenceSession({
    annotations, ownPoints, staticIndex, page, start, excludeIds, pdfSegments: false,
  });
  return {
    snap(dx, dy, scale) {
      const free = { dx, dy, indicator: null, inferred: null };
      if (!state.preferences.enableObjectSnap) return free;
      const tolerance = (state.preferences.objectSnapRadius || 12) / scale;
      let best = null;
      for (const p of ownPoints) {
        const x = p.x + dx, y = p.y + dy;
        const near = staticIndex.nearest(x, y, tolerance);
        if (near && (!best || near.dist < best.dist)) {
          best = { ...near, dx: dx + near.point.x - x, dy: dy + near.point.y - y };
        }
      }
      // Exact point matches take priority over alignment / extension guides,
      // as in G-move. Apply one correction to the entire selection.
      if (best) return {
        dx: best.dx, dy: best.dy, inferred: null,
        indicator: { x: best.point.x, y: best.point.y, type: best.point.type, snapped: true, page },
      };
      const inferred = inference.infer({ x: start.x + dx, y: start.y + dy }, {
        prefs: state.preferences, scale,
      });
      return inferred ? { dx: inferred.x - start.x, dy: inferred.y - start.y, indicator: null, inferred } : free;
    },
    dispose: () => inference.dispose(),
  };
}
