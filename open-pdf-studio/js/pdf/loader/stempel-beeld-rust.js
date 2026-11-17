// The picture a stamp with a drawn appearance is cut from, rendered by the
// PDFium worker (desktop) instead of by PDF.js on the interface thread.
//
// A stamp whose appearance is not a wrapped image gets its image from a
// render of the page with the annotation appearances drawn in
// (image-extraction.js). With PDF.js that is a render of the whole page at
// the first view of it: 160-870 ms on the interface thread on the test
// drawings. The worker renders only the part of the page the stamps are on,
// in its own process (command render_annotated_region).
//
// What comes back is the same kind of picture as before: the page as the file
// shows it, in display space, so everything after it (space 'visual', source
// 'render') is unchanged. The pixels are PDFium's, not PDF.js's.
//
// The JS path stays: browser build, Android/iOS, a document without a file on
// disk, a missing or older backend, and any failure (one warning, then
// PDF.js). OPDS_RUST_STAMPS=0 in the environment of the app forces PDF.js.

// Pure module apart from the `invoke` handed to createStempelRender(), so it
// runs under node in stempel-beeld-rust.test.mjs.

const _absolute = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));

/**
 * The part of the page (whole pixels, within the page) that covers all stamp
 * rectangles. `rechthoeken` are [x1, y1, x2, y2] in pixels of the whole-page
 * render, corners in any order.
 * @returns {{x:number,y:number,width:number,height:number}|null} null when
 *   nothing of the stamps is on the page
 */
export function stempelUitsnede(rechthoeken, paginaBreedte, paginaHoogte) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rechthoeken) {
    if (!r || !r.every(Number.isFinite)) continue;
    x0 = Math.min(x0, r[0], r[2]); x1 = Math.max(x1, r[0], r[2]);
    y0 = Math.min(y0, r[1], r[3]); y1 = Math.max(y1, r[1], r[3]);
  }
  if (x0 > x1 || y0 > y1) return null;
  // One pixel around it: the crop rounds to the nearest pixel.
  const x = Math.max(0, Math.floor(x0) - 1);
  const y = Math.max(0, Math.floor(y0) - 1);
  const rechts = Math.min(paginaBreedte, Math.ceil(x1) + 1);
  const onder = Math.min(paginaHoogte, Math.ceil(y1) + 1);
  if (rechts <= x || onder <= y) return null;
  return { x, y, width: rechts - x, height: onder - y };
}

/** Answer of render_annotated_region: width and height (u32 LE), then RGBA. */
export function decodeGebied(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 8) throw new Error('STAMP_REGION_ANSWER');
  const kop = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const width = kop.getUint32(0, true);
  const height = kop.getUint32(4, true);
  if (!width || !height || bytes.byteLength !== 8 + width * height * 4) throw new Error('STAMP_REGION_ANSWER');
  return { width, height, rgba: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, width * height * 4) };
}

/**
 * @param {{ invoke: Function, pad: string }} dep - `pad` is the file on disk
 * @returns {null | ((pageNum:number, scale:number, deel:{x,y,width,height}) => Promise<{width,height,rgba}|null>)}
 *   null when this document cannot go through the worker; the function gives
 *   null after a failure (and then stops trying for this document).
 */
export function createStempelRender({ invoke, pad, warn = console.warn }) {
  if (typeof invoke !== 'function' || !_absolute(pad)) return null;
  let uit = false;
  return async (pageNum, scale, deel) => {
    if (uit) return null;
    try {
      const antwoord = await invoke('render_annotated_region', {
        path: pad, pageIndex: pageNum - 1, scale,
        regionXPt: deel.x / scale, regionYPt: deel.y / scale,
        regionWPt: deel.width / scale, regionHPt: deel.height / scale,
      });
      return decodeGebied(antwoord);
    } catch (e) {
      uit = true;
      if (!/PDF_STAMPS_DISABLED/.test(String(e?.message || e))) warn('[stamp images] worker render failed, using PDF.js:', e);
      return null;
    }
  };
}
