// Stapeling van de paginalagen voor het actieve gereedschap (#1013).
//
// Elke pagina heeft een annotatiecanvas en een tekstlaag (.textLayer). De
// tekstlaag heeft in de CSS z-index 5 en pointer-events: auto; het
// annotatiecanvas heeft in de CSS GEEN z-index. Welke laag de muis krijgt,
// wordt dus per gereedschap in de inline stijl gezet: bij de hand en de
// tekengereedschappen ligt het canvas erboven (z-index 6) en laat de tekstlaag
// de muis door, bij 'editText' ligt het canvas eronder.
//
// Vroeger gebeurde dat alleen in setTool(), voor de lagen die er op dat moment
// waren. Een pagina die daarna gebouwd werd (doorlopende weergave: een pagina
// die in beeld schuift, of een volledige herbouw na een tabwissel, een andere
// weergave of een andere schermschaal) kreeg de CSS-standaard: tekstlaag
// bovenop. Met de hand viel een klik dan op de tekstlaag, de paginacontainer
// negeert die (renderer.js, magAfhandelen) en er gebeurde niets — tot de
// gebruiker een ander gereedschap en daarna de hand weer koos.
//
// Puur DOM, geen app-state: de renderer en de gereedschapswissel geven het
// gereedschap mee, zodat beide paden dezelfde regel volgen.

const CANVAS_SELECTOR = '#annotation-canvas, .annotation-canvas';

/**
 * Ligt het annotatiecanvas onder de tekstlaag (tekst bewerken)?
 * @param {string} tool
 */
export function canvasOnderTekst(tool) {
  return tool === 'editText';
}

/**
 * Zet z-index en pointer-events van de annotatiecanvassen onder `root`.
 * @param {ParentNode} root
 * @param {string} tool
 */
export function pasCanvasLagenToe(root, tool) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const onder = canvasOnderTekst(tool);
  root.querySelectorAll(CANVAS_SELECTOR).forEach((el) => {
    el.style.zIndex = onder ? '2' : '6';
    el.style.pointerEvents = onder ? 'none' : 'auto';
  });
}

/**
 * Zet de muistoegang van de tekstlagen onder `root`: aan voor het
 * selectiegereedschap (tekst selecteren), uit voor de rest. 'editText' regelt
 * de tekstlagen zelf (text-edit-tool.js) en blijft hier buiten.
 * @param {ParentNode} root
 * @param {string} tool
 */
export function pasTekstlagenToe(root, tool) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (tool === 'editText') return;
  const aan = tool === 'select';
  root.querySelectorAll('.textLayer').forEach((layer) => {
    layer.style.pointerEvents = aan ? 'auto' : 'none';
    layer.querySelectorAll('span').forEach((span) => {
      span.style.pointerEvents = aan ? 'auto' : 'none';
      span.style.cursor = aan ? 'text' : 'default';
    });
  });
}

/**
 * Beide regels in één keer, voor een (nieuw gebouwde) pagina.
 * @param {ParentNode} root
 * @param {string} tool
 */
export function pasGereedschapLagenToe(root, tool) {
  pasTekstlagenToe(root, tool);
  pasCanvasLagenToe(root, tool);
}
