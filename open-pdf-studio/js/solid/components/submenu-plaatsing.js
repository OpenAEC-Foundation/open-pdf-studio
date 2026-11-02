// Placement of the context menu and its submenus (#883, release gate 2026.44.7).
//
// With a larger interface size a menu soon becomes taller or wider than the
// window. Both functions below are pure: given the menu's natural size (as
// measured without a max-height) and the window size, they say where it goes
// and whether it needs a max-height and a scrollbar. A menu never leaves the
// window: it shifts first, and only when it is taller than the window it gets
// the window height (minus the margins) and scrolls.

// Height a menu of natural height `hoogte` may take in a window of `vensterH`.
// Returns null when it fits as it is.
function beschikbareHoogte(hoogte, vensterH, marge) {
  const ruimte = Math.max(0, vensterH - 2 * marge);
  return hoogte > ruimte ? ruimte : null;
}

// Clamp `begin` so that a span of `lengte` stays within [marge, venster - marge].
function klem(begin, lengte, venster, marge) {
  const max = venster - marge - lengte;
  return Math.max(marge, Math.min(begin, max));
}

// Main menu at the mouse position (x, y) with natural size breedte x hoogte.
// Opens down-right of the pointer; moves left/up as far as needed to stay
// inside the window.
export function menuPlaatsing({ x, y, breedte, hoogte }, vensterB, vensterH, marge = 4) {
  const maxHoogte = beschikbareHoogte(hoogte, vensterH, marge);
  const effHoogte = maxHoogte ?? hoogte;
  return {
    left: klem(x, breedte, vensterB, marge),
    top: klem(y, effHoogte, vensterH, marge),
    maxHoogte,
  };
}

// Submenu next to its item. `maat` is the submenu's natural size
// ({ width, height }), `item` the item's box. `inzet` is how far the submenu's
// first item sits below its own top edge (border + padding), so that the
// first entry lines up with the item. By default the submenu opens to the
// right (`voorkeurLinks` for right-to-left layouts); it flips when it does not
// fit on that side but does on the other, and otherwise goes to the side with
// most room and is clamped to the window.
export function submenuPlaatsing(maat, item, vensterB, vensterH, { marge = 4, inzet = 0, voorkeurLinks = false } = {}) {
  const breedte = maat.width;
  const ruimteRechts = vensterB - marge - item.right;
  const ruimteLinks = item.left - marge;
  const rechtsPast = breedte <= ruimteRechts;
  const linksPast = breedte <= ruimteLinks;
  let naarLinks;
  if (voorkeurLinks) naarLinks = linksPast || (!rechtsPast && ruimteLinks >= ruimteRechts);
  else naarLinks = !rechtsPast && (linksPast || ruimteLinks > ruimteRechts);
  const left = klem(naarLinks ? item.left - breedte : item.right, breedte, vensterB, marge);

  const maxHoogte = beschikbareHoogte(maat.height, vensterH, marge);
  const effHoogte = maxHoogte ?? maat.height;
  const top = klem(item.top - inzet, effHoogte, vensterH, marge);
  return { left, top, maxHoogte, naarLinks };
}
