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

// Kies het referentie-element: de pagina-rect waar het anker verticaal in
// valt, anders de dichtstbijzijnde. `rects` is een array {top, bottom} in
// dezelfde volgorde als de aanroeper zijn elementen heeft; retourneert de
// index of -1 bij een lege lijst.
export function pickAnchorPageIndex(rects, anchorY) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (anchorY >= r.top && anchorY <= r.bottom) return i;
    const d = anchorY < r.top ? r.top - anchorY : anchorY - r.bottom;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
