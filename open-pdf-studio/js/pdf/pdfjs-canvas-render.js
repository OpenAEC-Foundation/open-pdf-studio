// PDF.js owns a canvas until its render promise settles, including cancellation.
// A newer zoom must wait before resizing it (which also clears its pixels).
const renders = new WeakMap();

export function renderPdfJsCanvas({ page, viewport, canvas, dpr, onResize, renderOptions }) {
  const previous = renders.get(canvas);
  const current = { task: null, done: null };
  renders.set(canvas, current);
  previous?.task?.cancel();
  current.done = (async () => {
    if (previous) await previous.done.catch(() => {});
    if (renders.get(canvas) !== current) return false;
    const options = await renderOptions();
    if (renders.get(canvas) !== current) return false;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    onResize?.();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    current.task = page.render({ canvasContext: ctx, viewport, annotationMode: 0, ...options });
    try {
      await current.task.promise;
    } catch (error) {
      if (renders.get(canvas) !== current && error?.name === 'RenderingCancelledException') return false;
      throw error;
    }
    return renders.get(canvas) === current;
  })().finally(() => {
    if (renders.get(canvas) === current) renders.delete(canvas);
  });
  return current.done;
}
