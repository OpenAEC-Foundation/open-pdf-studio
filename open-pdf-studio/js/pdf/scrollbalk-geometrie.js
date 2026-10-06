// Maatvoering van de canvas-scrollbalken (CanvasScrollbars.jsx) over de
// enkelpagina-viewport.
//
// Een balk verschijnt alleen op een as waar de pagina niet in het canvas past.
// Staan beide balken er, dan laat elke balk de hoek vrij voor de andere. De
// duim is minstens 20 px; zijn plek volgt de verschuiving (offsetX/Y loopt van
// 0 aan de linker-/bovenrand tot -overloop aan de andere kant).
//
// Puur rekenwerk, zonder DOM: getest met node --test (scrollbalk-geometrie.test.mjs).

export const SB_SIZE = 14; // Windows-standard scrollbar width

/**
 * @param {object} o
 * @param {number} o.canvasW  canvas in CSS-px
 * @param {number} o.canvasH
 * @param {number} o.paginaW  pagina op het scherm in CSS-px (schermPaginaMaat() × zoom)
 * @param {number} o.paginaH
 * @param {number} o.offsetX  viewport.offsetX
 * @param {number} o.offsetY  viewport.offsetY
 * @returns {{h: {right: number, thumbPx: number, thumbStart: number} | null,
 *            v: {bottom: number, thumbPx: number, thumbStart: number} | null}}
 *          null = balk verborgen
 */
export function scrollbalkGeometrie({ canvasW, canvasH, paginaW, paginaH, offsetX, offsetY }) {
  const hVisible = paginaW > canvasW + 0.5;
  const vVisible = paginaH > canvasH + 0.5;
  let h = null;
  let v = null;

  // Horizontal
  if (hVisible) {
    const overflow = paginaW - canvasW; // total scrollable px
    // offsetX ranges from (canvasW - paginaW)..0 — we map to 0..overflow
    const scrolled = -offsetX; // 0 at left edge, overflow at right
    const trackPx = canvasW - SB_SIZE; // reserve corner if vertical also shown
    const usableTrack = vVisible ? trackPx : canvasW;
    const ratio = canvasW / paginaW;
    const thumbPx = Math.max(20, usableTrack * ratio);
    const maxThumbStart = usableTrack - thumbPx;
    const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
    h = {
      right: vVisible ? SB_SIZE : 0,
      thumbPx,
      thumbStart: Math.max(0, Math.min(maxThumbStart, thumbStart)),
    };
  }

  // Vertical
  if (vVisible) {
    const overflow = paginaH - canvasH;
    const scrolled = -offsetY;
    const trackPx = canvasH - (hVisible ? SB_SIZE : 0);
    const ratio = canvasH / paginaH;
    const thumbPx = Math.max(20, trackPx * ratio);
    const maxThumbStart = trackPx - thumbPx;
    const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
    v = {
      bottom: hVisible ? SB_SIZE : 0,
      thumbPx,
      thumbStart: Math.max(0, Math.min(maxThumbStart, thumbStart)),
    };
  }

  return { h, v };
}
