// Fullscreen toggle helper.
// Bridges Tauri 2 window fullscreen with the SolidJS ribbon store and provides
// a toggle for keyboard shortcuts and the View ribbon button.
//
// The ribbon button shows the real window state, never the state that was
// asked for (#873): in the browser a request can be refused (an iframe without
// allow="fullscreen", no user gesture), and a native window can refuse it too.

import { isTauri, isWindowFullscreen, setWindowFullscreen } from '../../core/platform.js';
import { isHeadless } from '../../core/headless.js';
import { setIsFullscreen, isFullscreen } from '../../solid/stores/ribbonStore.js';

let initialized = false;
let naloopTimers = [];
let resizeTimer = null;

async function syncState() {
  try {
    const cur = await isWindowFullscreen();
    setIsFullscreen(!!cur);
  } catch {}
}

// An accepted request can still be under way (the macOS animation, Safari's
// prefixed API): look again shortly after.
function naloop() {
  for (const t of naloopTimers) clearTimeout(t);
  naloopTimers = [300, 1000].map((ms) => setTimeout(syncState, ms));
}

export function initFullscreen() {
  if (initialized) return;
  initialized = true;
  // Sync once at startup
  syncState();
  // Browser: keep state in sync when the user leaves with Esc or the browser UI
  document.addEventListener('fullscreenchange', syncState);
  document.addEventListener('webkitfullscreenchange', syncState);
  // Entering or leaving full screen always resizes the window, also when the
  // window manager does it (macOS green button, a window menu).
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncState, 150);
  });
}

// Say why nothing happened, instead of a button that does nothing (#873).
// Only in the browser: there the page or the browser decides. The desktop
// window logs its own error, and a headless test instance skips full screen
// on purpose.
async function meldGeweigerd() {
  if (isTauri() || isHeadless()) return;
  try {
    const [i18n, dialogs] = await Promise.all([
      import('i18next'),
      import('../../solid/stores/dialogStore.js'),
    ]);
    const t = (i18n.default || i18n).t;
    dialogs.showMessage(t('ribbon:view.fullscreenUnavailable'));
  } catch {}
}

export async function toggleFullscreen() {
  const cur = !!(await isWindowFullscreen());
  const gewenst = !cur;
  const aangenomen = await setWindowFullscreen(gewenst);
  // Browser permissions and native window commands can reject a request.
  // Reflect the actual window instead of leaving the ribbon optimistically on.
  const actual = !!(await isWindowFullscreen());
  setIsFullscreen(actual);
  if (actual !== gewenst) {
    if (aangenomen) naloop();
    else if (gewenst) await meldGeweigerd();
  }
  return actual;
}

export async function exitFullscreen() {
  const cur = await isWindowFullscreen();
  if (!cur) {
    // A stale button state goes off as well.
    setIsFullscreen(false);
    return false;
  }
  const aangenomen = await setWindowFullscreen(false);
  const actual = !!(await isWindowFullscreen());
  setIsFullscreen(actual);
  if (actual && aangenomen) naloop();
  return !actual;
}

export function getFullscreenState() {
  return isFullscreen();
}
