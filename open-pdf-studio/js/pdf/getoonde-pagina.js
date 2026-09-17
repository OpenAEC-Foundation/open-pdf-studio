// Viewport-opties voor een pagina zoals hij getoond wordt: de eigen /Rotate van
// de pagina plus een door de gebruiker toegevoegde draaiing. Eén plek voor deze
// formule in het printpad (printvoorbeeld, Pagina-instelling, printopdracht),
// zodat een draaiingsfix niet op één van de kopieën kan achterblijven.
// Zonder extra draaiing geen `rotation`: PDF.js past /Rotate dan zelf toe.

/**
 * @param {{rotate:number}} page  PDF.js-pagina
 * @param {number} extraRotatie  Door de gebruiker toegevoegde draaiing (0/90/180/270)
 * @param {number} [scale=1]
 * @returns {{scale:number, rotation?:number}}
 */
export function viewportOpties(page, extraRotatie, scale = 1) {
  const opts = { scale };
  if (extraRotatie) opts.rotation = (page.rotate + extraRotatie) % 360;
  return opts;
}
