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
  // Alleen relevant via het mousedown-vangnet: een akkoord levert geen pointerdown.
  if ((buttons ?? 0) & (LINKS | RECHTS)) return 'blokkeer';
  return 'pan';
}

function doelVan(e) {
  const t = e && e.target;
  return t && typeof t.closest === 'function' ? t : null;
}

/**
 * Bouwt de event-handlers van de centrale middelmuis-pan. Alle app-afhankelijk-
 * heden worden meegegeven, zodat het gedrag los van de DOM testbaar is.
 *
 * @param {object} d
 * @param {() => boolean} d.heeftDocument     er is een geopend document
 * @param {() => string} d.weergaveModus      doc.viewMode
 * @param {() => boolean} d.isPanning         er loopt al een pan
 * @param {() => void} d.rondBewerkingenAf    lopende tekstbewerkingen afronden
 * @param {() => void} d.sluitMenu            open contextmenu sluiten
 * @param {(e: any) => void} d.startScrollPan pan in een scrollende weergave
 * @param {(e: any) => boolean} d.startViewportPan pan in de viewport; false = niet actief
 */
export function maakMiddelmuisHandlers(d) {
  const actieVoor = (e) => {
    const doel = doelVan(e);
    return middelmuisActie({
      button: e.button,
      buttons: e.buttons,
      binnenWeergave: !!(doel && doel.closest('#pdf-container') && d.heeftDocument()),
      inVergelijking: !!(doel && doel.closest('.compare-view')),
      alPannen: !!d.isPanning(),
    });
  };

  function onPointerDown(e) {
    const actie = actieVoor(e);
    if (actie === 'negeer') return;
    // Onderdrukt de autoscroll (en de afgeleide mousedown).
    e.preventDefault();
    if (actie !== 'pan') return;
    // Laag-specifieke handlers (gereedschap, tekstlaag, viewport, de
    // klik-buiten-commit van de tekst-editor) zien dit event niet meer.
    e.stopPropagation();
    // Daarom hier zelf afronden: een editor mag niet los van zijn tekst
    // blijven zweven terwijl de pagina eronder verschuift.
    d.rondBewerkingenAf();
    d.sluitMenu();
    if (d.weergaveModus() === 'continuous') d.startScrollPan(e);
    else if (!d.startViewportPan(e)) d.startScrollPan(e);
  }

  // Vangnet: als een mousedown tóch wordt afgeleverd (bijv. een akkoord met
  // een andere knop, waarbij geen nieuwe pointerdown komt), krijgt ook die
  // een preventDefault zodat de autoscroll niet start.
  function onMouseDown(e) {
    if (actieVoor(e) !== 'negeer') e.preventDefault();
  }

  // Een middelklik in de weergave opent of navigeert nooit iets.
  function onAuxClick(e) {
    if (e.button !== 1) return;
    const doel = doelVan(e);
    if (doel && doel.closest('#pdf-container') && !doel.closest('.compare-view')) e.preventDefault();
  }

  return { onPointerDown, onMouseDown, onAuxClick };
}
