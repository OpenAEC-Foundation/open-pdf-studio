// Reading annotations without the state store in between.
//
// `doc.annotations` is a store list: every element and every property read
// goes through a proxy. That is what makes the interface follow changes, but
// in a loop that only reads (hit testing on every mouse move, with thousands
// of markups) the proxy calls were about 40% of the time. Such a loop walks
// the plain list under the store and hands back the store's own object for
// whatever it found, so a caller that changes it still does so reactively.
//
// Only for code that reads outside a reactive computation: reading the plain
// objects registers nothing with the store.

import { $RAW } from 'solid-js/store';

/** The plain list under a store list; a list that is not from the store as it is. */
export function kaleLijst(lijst) {
  return (lijst && lijst[$RAW]) || lijst || [];
}

/** The plain object under a store object; anything else as it is. */
export function kaal(object) {
  return (object && object[$RAW]) || object;
}

/** The store's object for an item found in kaleLijst(lijst); anything else unchanged. */
export function vanStore(lijst, item) {
  if (!item || !lijst) return item;
  const kaal = lijst[$RAW];
  if (!kaal || kaal === lijst) return item;
  const i = kaal.indexOf(item);
  return i >= 0 ? lijst[i] : item;
}
