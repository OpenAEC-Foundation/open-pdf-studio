// Het vak en de maat van de PAGINA achter een paginacanvas.
//
// In de doorlopende weergave dekt het paginacanvas (.pdf-canvas) boven de
// bitmap-cap niet meer de hele pagina: het is een scherpe uitsnede van het
// zichtbare deel (#1163, doorlopend-scherp.js; het canvas draagt dan
// data-beeld="uitsnede"). Wie uit het canvas de plek of de maat van de pagina
// afleidde, moet daarvoor de paginacontainer (.canvas-container-cont) nemen.
// Voor elk ander paginacanvas (enkele pagina, doorlopend onder de cap) blijft
// het canvas zelf de maat.

/** Is dit paginacanvas een uitsnede van de pagina in plaats van de hele pagina? */
export function isUitsnedeCanvas(canvas) {
  return canvas?.dataset?.beeld === 'uitsnede';
}

/** Het element dat de hele pagina dekt: de paginacontainer bij een uitsnede, anders het canvas. */
export function paginaVakElement(canvas) {
  if (!isUitsnedeCanvas(canvas)) return canvas;
  return (typeof canvas.closest === 'function' && canvas.closest('.canvas-container-cont')) || canvas.parentElement || canvas;
}

/** De rechthoek van de hele pagina op het scherm. */
export function paginaVakRect(canvas) {
  return paginaVakElement(canvas)?.getBoundingClientRect?.() || null;
}

/**
 * De maat in apparaatpixels die het paginabeeld zou hebben als het canvas de
 * hele pagina op volle resolutie dekte. Voor een gewoon paginacanvas zijn dat
 * zijn eigen width/height; voor een uitsnede de maat van de paginacontainer
 * maal de schermschaal.
 * @param {HTMLCanvasElement} canvas
 * @param {number} [dpr]
 * @returns {{width:number, height:number}}
 */
export function paginaBitmapMaat(canvas, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1) {
  if (!canvas) return { width: 0, height: 0 };
  if (!isUitsnedeCanvas(canvas)) return { width: canvas.width || 0, height: canvas.height || 0 };
  const vak = paginaVakElement(canvas);
  let breedte = parseFloat(vak?.style?.width);
  let hoogte = parseFloat(vak?.style?.height);
  if (!(breedte > 0) || !(hoogte > 0)) {
    const r = vak?.getBoundingClientRect?.();
    breedte = r?.width || 0;
    hoogte = r?.height || 0;
  }
  return { width: breedte * dpr, height: hoogte * dpr };
}
