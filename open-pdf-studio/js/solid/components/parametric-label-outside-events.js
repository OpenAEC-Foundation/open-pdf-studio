export function createOutsideCommitController({
  isActive,
  commit,
  isCanvasTarget,
}) {
  let pendingOutsideClick = false;

  const isInside = (target, root) =>
    !!(root && target != null && root.contains(target));

  return {
    pointerDown(event, root) {
      pendingOutsideClick = false;
      if (isInside(event.target, root)) return;
      if (isCanvasTarget(event.target)) {
        if (isActive()) commit();
        return;
      }
      pendingOutsideClick = true;
    },

    click(event, root) {
      if (!pendingOutsideClick) return;
      pendingOutsideClick = false;
      if (isInside(event.target, root) || !isActive()) return;
      commit();
    },

    reset() {
      pendingOutsideClick = false;
    },
  };
}
