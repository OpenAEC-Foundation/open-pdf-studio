// Pure ankerberekening voor zoomen in de doorlopende weergave.
//
// Contract: het content-punt dat vóór de zoomstap onder het anker (de cursor)
// lag, moet er ná de zoomstap nog steeds onder liggen. We meten dat punt als
// fractie binnen een referentie-element (de pagina onder de cursor) in plaats
// van via `scrollTop * factor`, omdat niet alles in de scroll-inhoud
// meeschaalt: de gap tussen pagina's en de container-padding staan in vaste
// CSS-px. Een fractie binnen het pagina-element schaalt wél exact mee.

// Scroll-correctie: gegeven het anker (client-coördinaten) en de rect van het
// referentie-element vóór en ná de resize, de delta die bij scrollLeft/
// scrollTop opgeteld moet worden om het content-punt terug onder het anker te
// zetten. Fracties buiten [0,1] (anker in de gap naast/onder de pagina)
// extrapoleren gewoon — de correctie blijft continu.
export function anchorScrollCorrection(anchor, rectBefore, rectAfter) {
  if (!anchor || !rectBefore || !rectAfter
      || !rectBefore.width || !rectBefore.height) {
    return { dx: 0, dy: 0 };
  }
  const fx = (anchor.x - rectBefore.left) / rectBefore.width;
  const fy = (anchor.y - rectBefore.top) / rectBefore.height;
  return {
    dx: (rectAfter.left + fx * rectAfter.width) - anchor.x,
    dy: (rectAfter.top + fy * rectAfter.height) - anchor.y,
  };
}

// Kies het referentie-element: de pagina-rect waar het anker in valt, anders
// de dichtstbijzijnde. `rects` is een array {top, bottom, left?, right?} in
// dezelfde volgorde als de aanroeper zijn elementen heeft; retourneert de
// index of -1 bij een lege lijst.
//
// De keuze is tweedimensionaal zodra left/right meegegeven worden: in boek-
// en dubbelepaginaweergave staan twee pagina's naast elkaar met identieke
// verticale grenzen — een puur verticale keuze pakte dan de linkerpagina
// terwijl de cursor boven de rechter stond. Zonder left/right (of zonder
// anchorX) valt de keuze terug op alleen verticaal, zoals voorheen.
export function pickAnchorPageIndex(rects, anchorY, anchorX = null) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const heeft2d = anchorX != null && r.left != null && r.right != null;
    const dy = anchorY < r.top ? r.top - anchorY : (anchorY > r.bottom ? anchorY - r.bottom : 0);
    const dx = heeft2d
      ? (anchorX < r.left ? r.left - anchorX : (anchorX > r.right ? anchorX - r.right : 0))
      : 0;
    if (dy === 0 && dx === 0) return i;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
