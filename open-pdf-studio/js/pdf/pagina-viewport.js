// PDF.js viewport in the app space. The app space counts page units, like
// /Rect and the saver, while a PDF.js viewport multiplies by the /UserUnit.
// Dividing the scale cancels that out; the reported scale stays the requested
// one, because radii, text sizes and the text layer use it as the zoom.
// `page.userUnit` itself stays available for what is about real paper size.
export function paginaViewport(page, opties = { scale: 1 }) {
  const userUnit = page.userUnit > 0 ? page.userUnit : 1;
  const viewport = page.getViewport({ ...opties, scale: opties.scale / userUnit });
  viewport.scale = opties.scale;
  return viewport;
}
