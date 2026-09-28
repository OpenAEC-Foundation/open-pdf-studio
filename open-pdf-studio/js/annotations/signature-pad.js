// Ink of the draw pad in the signature dialog, kept out of the Solid component
// so it can be tested under node.
//
// The pad never holds on to a 2D context: it draws into the canvas that is
// attached at that moment and asks that canvas for its context each time.
// The dialog builds a new canvas every time the Draw tab is shown again. A
// context taken once from the first canvas kept painting into that detached
// element, so the pad on screen stayed blank and "Place" cropped an empty
// canvas (#492). Attaching a canvas repaints the strokes drawn so far, so a
// signature survives a look at the Saved tab.

export const SIGNATURE_LINE_WIDTH = 2;

export function createSignaturePad() {
  let canvas = null;
  let strokes = [];
  let current = null;
  let snapshot = null;

  function context() {
    return canvas ? canvas.getContext('2d') : null;
  }

  function paint(ctx, stroke) {
    if (stroke.points.length < 2) return;
    ctx.lineWidth = SIGNATURE_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  function repaint() {
    const ctx = context();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) paint(ctx, stroke);
  }

  return {
    /** The canvas the pad draws into; the dialog crops the signature from it. */
    get canvas() {
      return canvas;
    },

    /** Binds the pad to the canvas on screen and repaints the ink on it. */
    attach(el) {
      canvas = el || null;
      current = null;
      snapshot = null;
      repaint();
    },

    hasInk() {
      return strokes.length > 0;
    },

    /** Pointer down at (x, y) in canvas pixels. */
    begin(x, y, color) {
      const ctx = context();
      if (!ctx) return;
      current = { color, points: [{ x, y }] };
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    },

    /** Pointer moved while down: redraws the stroke in progress. */
    extend(x, y) {
      const ctx = context();
      if (!current || !ctx) return;
      current.points.push({ x, y });
      ctx.putImageData(snapshot, 0, 0);
      paint(ctx, current);
    },

    /** Pointer up or out: keeps the stroke unless it was a click in place. */
    end() {
      if (current && current.points.length > 1) strokes.push(current);
      current = null;
      snapshot = null;
    },

    undo() {
      if (strokes.length === 0) return;
      strokes.pop();
      repaint();
    },

    clear() {
      strokes = [];
      current = null;
      snapshot = null;
      repaint();
    },
  };
}
