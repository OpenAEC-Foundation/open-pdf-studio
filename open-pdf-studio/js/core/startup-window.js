/** Reveal the desktop shell before loading documents/password prompts (#1034). */
export async function revealStartupWindow({ mobile = false, host = globalThis, doc = document, fontTimeoutMs = 2000 } = {}) {
  const invoke = host.__TAURI__?.core?.invoke;
  if (mobile || host.__OPDS_HEADLESS__ === true || !invoke) return;

  // Resolve layout now to initiate font loading. Do not await rAF: hidden
  // WebViews may suspend it until the native window becomes visible.
  const root = doc.getElementById('app-root');
  root?.getBoundingClientRect();
  let timeout;
  try {
    await Promise.race([
      doc.fonts?.ready,
      new Promise(resolve => { timeout = setTimeout(resolve, fontTimeoutMs); }),
    ]);
  } catch { /* A failed font must not keep the window hidden. */ }
  finally { clearTimeout(timeout); }
  // Allow pending UI microtasks to settle, then flush final layout before show.
  await new Promise(resolve => setTimeout(resolve, 0));
  root?.getBoundingClientRect();
  try {
    await invoke('startup_window_ready');
  } catch (error) {
    // Native watchdog remains responsible if IPC or initialization fails.
    console.warn('[startup] shell reveal failed:', error);
  }
}
