// Pointer fall-through of the select tool onto the text layer, without
// walking every text span on every mouse move.
//
// The select tool decides per mouse move whether the pointer falls through to
// the text layer, and writes that on the layer and on each of its spans. On a
// drawing with thousands of text spans that loop ran for every move, although
// the answer only changes when the pointer goes from text to an annotation or
// back. The layer remembers what was last written; the loop only runs again
// when the wanted value differs, when spans were added or removed, or when
// someone else rewrote the spans (the other writers set all spans of a layer
// to one value, so the first and the last span tell).

const ONTHOUDEN = new WeakMap();

/**
 * Set pointer-events and cursor on a text layer and its spans.
 * @returns {boolean} whether the spans were walked
 */
export function pasTekstlaagDoorvalToe(layer, pointerEvents, cursor) {
  if (layer.style.pointerEvents !== pointerEvents) layer.style.pointerEvents = pointerEvents;
  const spans = layer.getElementsByTagName('span');
  const aantal = spans.length;
  const vorig = ONTHOUDEN.get(layer);
  if (vorig && vorig.pointerEvents === pointerEvents && vorig.cursor === cursor && vorig.aantal === aantal
      && (aantal === 0 || (klopt(spans[0], pointerEvents, cursor) && klopt(spans[aantal - 1], pointerEvents, cursor)))) {
    return false;
  }
  for (let i = 0; i < aantal; i++) {
    const stijl = spans[i].style;
    if (stijl.pointerEvents !== pointerEvents) stijl.pointerEvents = pointerEvents;
    if (stijl.cursor !== cursor) stijl.cursor = cursor;
  }
  ONTHOUDEN.set(layer, { pointerEvents, cursor, aantal });
  return true;
}

/** Forget what was written on a layer (after someone reset its spans). */
export function vergeetTekstlaagDoorval(layer) {
  ONTHOUDEN.delete(layer);
}

function klopt(span, pointerEvents, cursor) {
  return span.style.pointerEvents === pointerEvents && span.style.cursor === cursor;
}
