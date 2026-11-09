// Het contextmenu: de host is altijd gemonteerd en registreert bij de start
// zijn luisteraars (Escape, klik buiten het menu, venster verlaten), zodat
// hun volgorde ten opzichte van de andere toetsafhandeling gelijk blijft. De
// inhoud (ContextMenu.jsx, de menu's per soort) is een eigen chunk (#454):
// hij laadt na de start in een rustig moment, of bij het eerste openen. Na
// het laden wordt het menu opnieuw geplaatst, want de maat verandert.
import { createEffect, createMemo, createSignal, onMount, onCleanup, Show, lazy } from 'solid-js';
import { visible, menuType, position, hideMenu } from '../stores/contextMenuStore.js';
import { menuPlaatsing } from './submenu-plaatsing.js';
import { MENU_MARGE, plaatsSubmenuVan } from './contextmenu-plaatsen.js';
import { naDeStart } from './ribbon/lint-tab-laden.js';

const ContextMenuInhoud = lazy(() => import('./ContextMenu.jsx'));
const [inhoudGeladen, setInhoudGeladen] = createSignal(false);
let _lading = null;
function laadInhoud() {
  _lading ??= ContextMenuInhoud.preload().then(() => setInhoudGeladen(true), (fout) => {
    console.warn('[contextmenu] inhoud kon niet laden', fout);
    _lading = null;
  });
  return _lading;
}

export default function ContextMenu() {
  let menuRef;
  // De inhoud pas opbouwen als het menu voor het eerst opengaat, en daarna
  // laten staan. Het verborgen menu (standaard het annotatiemenu) kostte bij
  // de start zo'n vijfde van het opbouwen van het hele venster (#707).
  const inhoudOpgebouwd = createMemo((eerder) => eerder || visible(), false);

  onMount(() => onCleanup(naDeStart(() => { laadInhoud(); })));
  createEffect(() => { if (visible()) laadInhoud(); });

  // Position the menu when it becomes visible: measured at its natural size,
  // then shifted (and, when taller than the window, given the window height
  // and a scrollbar) so it stays fully inside the window (#883). Also once
  // more when the content has just loaded.
  createEffect(() => {
    if (visible()) {
      const pos = position();
      menuType();
      inhoudGeladen();
      requestAnimationFrame(() => {
        if (!menuRef) return;
        menuRef.style.maxHeight = '';
        menuRef.classList.remove('scrollt');
        menuRef.scrollTop = 0;
        const rect = menuRef.getBoundingClientRect();
        const { left, top, maxHoogte } = menuPlaatsing(
          { x: pos.x, y: pos.y, breedte: rect.width, hoogte: rect.height },
          window.innerWidth, window.innerHeight, MENU_MARGE);
        menuRef.style.left = `${left}px`;
        menuRef.style.top = `${top}px`;
        if (maxHoogte != null) {
          menuRef.style.maxHeight = `${maxHoogte}px`;
          menuRef.classList.add('scrollt');
          // The scrollbar makes it wider: stay inside with that width too.
          const teVer = menuRef.getBoundingClientRect().right - (window.innerWidth - MENU_MARGE);
          if (teVer > 0) menuRef.style.left = `${Math.max(MENU_MARGE, left - teVer)}px`;
        }
      });
    }
  });

  // A scrolling menu moves its items under an open submenu: place it again.
  function handleMenuScroll() {
    menuRef?.querySelectorAll('.context-menu-submenu:hover').forEach(plaatsSubmenuVan);
  }

  // Dismiss when clicking outside the menu.
  // mousedown on document handles clicks on ribbon, panels, title bar, etc.
  // Canvas clicks are handled by the tool dispatcher (which calls hideMenu).
  function handleOutsideClick(e) {
    if (!visible()) return;
    if (menuRef && menuRef.contains(e.target)) return;
    hideMenu();
  }

  function handleEscape(e) {
    if (e.key === 'Escape' && visible()) {
      hideMenu();
    }
  }

  function handleWindowBlur() {
    if (visible()) hideMenu();
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', handleWindowBlur);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('blur', handleWindowBlur);
  });

  return (
    <div
      ref={menuRef}
      class="context-menu"
      classList={{ visible: visible() }}
      onScroll={handleMenuScroll}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Show when={inhoudOpgebouwd()}>
        <ContextMenuInhoud />
      </Show>
    </div>
  );
}
