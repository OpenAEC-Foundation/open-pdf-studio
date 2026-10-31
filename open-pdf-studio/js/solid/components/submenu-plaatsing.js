// Placement of a context-menu submenu (#883). The submenu opens to the right
// of its item through CSS; with a larger interface size it soon runs past the
// window edge. Given the submenu's box as opened, this says whether it should
// open to the left instead and how far it must move up to stay inside.
export function submenuPlaatsing(rect, item, vensterB, vensterH, marge = 4) {
  const naarLinks = rect.right > vensterB - marge && item.left - rect.width >= marge;
  const teLaag = rect.bottom - (vensterH - marge);
  const omhoog = teLaag > 0 ? Math.min(teLaag, Math.max(0, rect.top - marge)) : 0;
  return { naarLinks, omhoog };
}
