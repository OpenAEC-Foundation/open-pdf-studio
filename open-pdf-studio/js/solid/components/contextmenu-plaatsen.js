// Plaatsing van het contextmenu en zijn submenu's in het venster (#883),
// gedeeld door de host (ContextMenuHost.jsx) en de inhoud (ContextMenu.jsx).
import { submenuPlaatsing } from './submenu-plaatsing.js';

export const MENU_MARGE = 4;

// Place a submenu next to its item, inside the window (#883). Submenus are
// position: fixed so that a scrolling main menu (overflow-y: auto) does not
// clip them; their spot is computed from the item's box.
export function plaatsSubmenuVan(item) {
  const inhoud = item.querySelector(':scope > .context-menu-submenu-content');
  if (!inhoud) return;
  inhoud.style.maxHeight = '';
  const maat = inhoud.getBoundingClientRect();
  if (!maat.width && !maat.height) return;
  const stijl = getComputedStyle(inhoud);
  const inzet = (parseFloat(stijl.borderTopWidth) || 0) + (parseFloat(stijl.paddingTop) || 0);
  const voorkeurLinks = getComputedStyle(item).direction === 'rtl';
  const { left, top, maxHoogte, naarLinks } = submenuPlaatsing(
    { width: maat.width, height: maat.height }, item.getBoundingClientRect(),
    window.innerWidth, window.innerHeight, { marge: MENU_MARGE, inzet, voorkeurLinks });
  inhoud.classList.toggle('naar-links', naarLinks);
  inhoud.classList.toggle('scrollt', maxHoogte != null);
  inhoud.style.top = `${top}px`;
  inhoud.style.maxHeight = maxHoogte != null ? `${maxHoogte}px` : '';
  inhoud.style.left = `${left}px`;
  // The scrollbar makes it wider: stay inside the window with that width too.
  const teVer = inhoud.getBoundingClientRect().right - (window.innerWidth - MENU_MARGE);
  if (teVer > 0) inhoud.style.left = `${Math.max(MENU_MARGE, left - teVer)}px`;
}
