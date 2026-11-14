/** Reveal the desktop shell before loading documents/password prompts (#1034). */
export async function revealStartupWindow({ mobile = false, host = globalThis, doc = document } = {}) {
  const invoke = host.__TAURI__?.core?.invoke;
  if (mobile || host.__OPDS_HEADLESS__ === true || !invoke) return;

  // Resolve layout now to initiate font loading. Do not await rAF: hidden
  // WebViews may suspend it until the native window becomes visible.
  const root = doc.getElementById('app-root');
  root?.getBoundingClientRect();
  // Both rAF and setTimeout may be suspended while WKWebView is hidden.
  // Bound font loading with a native timer instead. Its IPC reply does not
  // rely on a JavaScript timeout becoming runnable in the hidden page.
  try {
    await Promise.race([doc.fonts?.ready, invoke('startup_font_deadline')]);
  } catch { /* Failed fonts/IPC must not keep the initialized shell hidden. */ }
  // Await continuations already yield to pending microtasks. No timer-based
  // extra task here: even setTimeout(0) can stall a hidden WebView.
  root?.getBoundingClientRect();
  try {
    await invoke('startup_window_ready');
  } catch (error) {
    // Native watchdog remains responsible if IPC or initialization fails.
    console.warn('[startup] shell reveal failed:', error);
  }
}
