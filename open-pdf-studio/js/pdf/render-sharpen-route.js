// Page sharpening in Rust instead of on the interface thread.
//
// sharpenRgba() (render-sharpen.js) costs about 21 ms per megapixel and ran in
// the WebView on every freshly rendered page bitmap and tile; the window does
// not respond while it runs. On the desktop the render commands can do it
// before the bitmap crosses to the WebView (src-tauri/src/verscherpen.rs, the
// same filter byte for byte): a caller that sharpens passes `sharpen: true` to
// renderPdfPage() or invokeTileRegion(), which hand the strength to Rust and
// mark the bitmap that comes back, so sharpenPageRgba() leaves it alone.
//
// The JS filter stays for the web build, mobile, an older backend and
// OPDS_RUST_SHARPEN=0 in the environment of the app: then the backend says no
// (or does not know the question) and nothing is asked of it.

// Pure apart from the dependencies handed in, so it runs under node.

/**
 * @param {{invoke: ((cmd:string, args?:object) => Promise<any>)|null, sterkte: () => number}} deps
 *   invoke: the Tauri invoke, or null outside Tauri; sterkte: the strength of
 *   the current preference (0 = off).
 */
export function maakSharpenRoute({ invoke, sterkte }) {
  const verscherpt = new WeakSet(); // ArrayBuffers that came back sharpened
  let kan = null; // Promise<boolean>, asked once
  const backendKan = () => {
    if (!kan) {
      kan = invoke
        ? Promise.resolve().then(() => invoke('sharpen_rust_beschikbaar')).then((v) => v === true, () => false)
        : Promise.resolve(false);
    }
    return kan;
  };
  const bufferVan = (beeld) => (beeld instanceof ArrayBuffer ? beeld : beeld?.buffer instanceof ArrayBuffer ? beeld.buffer : null);
  return {
    /** The strength to pass to the render command, or 0: sharpen in JS. */
    async aanvraag() {
      const s = Number(sterkte()) || 0;
      if (!(s > 0)) return 0;
      return (await backendKan()) ? s : 0;
    },
    /** Remember that this answer (bytes or buffer) was sharpened with `gevraagd`. */
    markeer(beeld, gevraagd) {
      const buffer = gevraagd > 0 ? bufferVan(beeld) : null;
      if (buffer) verscherpt.add(buffer);
    },
    /** Did the pixels in this view come back sharpened already? */
    isVerscherpt(rgba) {
      const buffer = bufferVan(rgba);
      return !!buffer && verscherpt.has(buffer);
    },
  };
}
