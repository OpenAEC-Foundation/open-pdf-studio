// Pure core of the filled-area tool's "undo last point" — deliberately has
// NO imports (not core/state.ts, not the tool itself), so it can be tested
// directly with `node --test` — see filled-area-undo.test.mjs. Kept in its
// own file rather than inline in filled-area-tool.js because that file
// imports core/state.ts, which isn't resolvable outside a bundler/Vite.
//
// Only ever touches the ACTIVE contour's own point list (the caller passes
// state.filledAreaPoints, which is the outer contour OR whichever hole is
// currently being drawn — never both, and never a completed hole/outer,
// since those live in separate arrays entirely).
export function computeUndoLastPoint(points) {
  if (!points || points.length === 0) {
    return { changed: false, points: points || [] };
  }
  const next = points.slice(0, -1);
  return { changed: true, points: next, reArmTypeLength: next.length === 0 };
}
