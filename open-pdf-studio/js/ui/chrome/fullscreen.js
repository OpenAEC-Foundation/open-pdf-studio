// Fullscreen toggle helper.
// Bridges Tauri 2 window fullscreen with the SolidJS ribbon store and provides
// a toggle for keyboard shortcuts and the View ribbon button.

import { isWindowFullscreen, setWindowFullscreen } from '../../core/platform.js';
import { setIsFullscreen, isFullscreen } from '../../solid/stores/ribbonStore.js';

let initialized = false;

async function syncState() {
  try {
    const cur = await isWindowFullscreen();
    setIsFullscreen(!!cur);
  } catch {}
}

export function initFullscreen() {
  if (initialized) return;
  initialized = true;
  // Sync once at startup
  syncState();
  // Browser fallback: keep state in sync when user uses native shortcuts
  document.addEventListener('fullscreenchange', syncState);
}

export async function toggleFullscreen() {
  const cur = await isWindowFullscreen();
  await setWindowFullscreen(!cur);
  // Browser permissions and native window commands can reject a request.
  // Reflect the actual window instead of leaving the ribbon optimistically on.
  const actual = await isWindowFullscreen();
  setIsFullscreen(!!actual);
  return !!actual;
}

export async function exitFullscreen() {
  const cur = await isWindowFullscreen();
  if (!cur) return false;
  await setWindowFullscreen(false);
  const actual = await isWindowFullscreen();
  setIsFullscreen(!!actual);
  return !actual;
}

export function getFullscreenState() {
  return isFullscreen();
}
