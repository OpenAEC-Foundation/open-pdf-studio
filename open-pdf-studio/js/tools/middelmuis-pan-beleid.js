// Beslisregel voor de middelmuisknop in het weergavegebied (issue #397).
//
// Chromium/WebView2 start bij een middelklik de native autoscroll, tenzij de
// pointerdown/mousedown een preventDefault krijgt. Deze pure functie bepaalt
// per event wat de centrale middelmuis-pan moet doen, los van gereedschap en
// van het element onder de cursor (pagina, tekstlaag, tussenruimte, marge).
//
//   'negeer'   — niet ingrijpen (andere knop, buiten de weergave, of een
//                weergave met een eigen pan-afhandeling)
//   'blokkeer' — alleen de autoscroll onderdrukken, geen pan starten
//   'pan'      — autoscroll onderdrukken en een pan starten

const LINKS = 1;
const RECHTS = 2;

/**
 * @param {object} p
 * @param {number} p.button          MouseEvent.button (1 = middelknop)
 * @param {number} [p.buttons]       MouseEvent.buttons (bitmasker ingedrukte knoppen)
 * @param {boolean} p.binnenWeergave doel ligt in de documentweergave
 * @param {boolean} p.inVergelijking doel ligt in de vergelijkingsweergave
 * @param {boolean} p.alPannen       er loopt al een pan
 * @returns {'negeer'|'blokkeer'|'pan'}
 */
export function middelmuisActie({ button, buttons, binnenWeergave, inVergelijking, alPannen }) {
  if (button !== 1) return 'negeer';
  if (!binnenWeergave || inVergelijking) return 'negeer';
  if (alPannen) return 'blokkeer';
  // Linker- of rechterknop nog ingedrukt: er loopt een teken-, sleep- of
  // 2D-cursorbewerking. Die mag niet onderbroken worden door een pan.
  if ((buttons ?? 0) & (LINKS | RECHTS)) return 'blokkeer';
  return 'pan';
}
