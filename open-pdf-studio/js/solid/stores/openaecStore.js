// OpenAEC Accounts — platform-login ("Sign in with OpenAEC").
//
// Thin Solid store around the Rust commands in src-tauri/src/accounts.rs:
// the OIDC/PKCE flow, token storage (OS keyring) and the authenticated
// Accounts API all live at the Rust side; the webview only ever sees the
// user profile (sub/name/email). Mirrors the Open Calc Studio integration —
// same contract: openaec-accounts/docs/integrations/open-pdf-studio.md.
//
// Scope: login only. Cloud storage (upload/download) and the platform AI
// endpoint are deliberately NOT wired up here — see the account widget.

import { signInPageText } from '../../services/signin-page-text.js';
import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';

const [user, setUser] = createSignal(null);   // { sub, name, email } | null
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal(null); // transient, auto-clears
const [brand, setBrand] = createSignal(null); // { orgName, accent, logo } | null on default/personal

export { user as openaecUser, busy as openaecBusy, error as openaecError, brand as openaecBrand };

// OpenAEC house accent (matches the brand default in the contract). A signed-in
// company brand overrides --openaec-accent at runtime; the override stays
// scoped to the OpenAEC widget so the Windows-Forms chrome (--theme-*) is
// untouched.
const DEFAULT_ACCENT = '#d97706';

function _invoke(cmd, args) {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error('alleen beschikbaar in de desktop-app'));
  return inv(cmd, args);
}

function _flashError(e) {
  setError(String(e?.message ?? e));
  setTimeout(() => setError(null), 6000);
}

function _applyAccent(hex) {
  try { document.documentElement.style.setProperty('--openaec-accent', hex || DEFAULT_ACCENT); } catch (_) { /* no DOM */ }
}

/** Restore the signed-in user from the keyring (app start).
 *
 * Single-flight: de titelbalk, het assistentpaneel en de AI-lint vragen dit
 * alle drie tegelijk op bij het opstarten. Elke aanroep kan een token-refresh
 * uitlokken, en de server roteert refresh tokens MET hergebruikdetectie —
 * gelijktijdige refreshes trekken de hele sessie in. De Rust-kant heeft
 * inmiddels een eigen slot; dit voorkomt daarbovenop drie overbodige
 * userinfo-rondjes bij elke start. */
let _loadInFlight = null;
export async function openaecLoadUser() {
  if (!isTauri()) return;
  if (_loadInFlight) return _loadInFlight;
  _loadInFlight = (async () => {
    try {
      const u = await _invoke('accounts_get_user');
      setUser(u || null);
      if (u) openaecLoadBrand();
    } catch (_) { /* keyring unavailable — stay signed out */ }
    finally { _loadInFlight = null; }
  })();
  return _loadInFlight;
}

/** Launch the system-browser OIDC login; resolves with the user profile. */
export async function openaecSignIn() {
  if (busy()) return;
  setBusy(true);
  setError(null);
  try {
    const u = await _invoke('accounts_sign_in', { pageText: signInPageText() });
    setUser(u || null);
    if (u) openaecLoadBrand();
  } catch (e) {
    _flashError(e);
  } finally {
    setBusy(false);
  }
}

/** Wipe tokens (local sign-out) and reset the brand to the OpenAEC default. */
export async function openaecSignOut() {
  try { await _invoke('accounts_sign_out'); } catch (_) {}
  setUser(null);
  setBrand(null);
  _applyAccent(DEFAULT_ACCENT);
}

/** Authenticated Accounts API call, e.g. openaecFetch('/me/apps'). */
export function openaecFetch(path, method, body) {
  return _invoke('accounts_fetch', { path, method, body });
}

/**
 * Fetch the active company's brand kit (GET /me/brand) and apply it — scoped
 * to the OpenAEC widget: the accent colour (CSS var) plus the company logo.
 * The contract says every tool should adopt the active company's house style;
 * we keep it to accent + logo so the app's Windows-Forms look is preserved.
 * source:"default" (personal account) resets to the OpenAEC house accent.
 * Brand data is optional — any failure silently keeps the default look.
 */
export async function openaecLoadBrand() {
  if (!isTauri()) return;
  try {
    const b = await openaecFetch('/me/brand', 'GET');
    if (!b || b.source !== 'company') { setBrand(null); _applyAccent(DEFAULT_ACCENT); return; }
    const accent = b.colors?.accent || b.colors?.primary || DEFAULT_ACCENT;
    _applyAccent(accent);
    let logo = null;
    if (b.hasLogo) {
      try { logo = await _invoke('accounts_brand_logo'); } catch (_) { logo = null; }
    }
    setBrand({ orgName: b.orgName || b.entityName || '', accent, logo });
  } catch (_) {
    setBrand(null); // brand is non-critical — keep the default look
  }
}

// Restore session once at module load (fire-and-forget).
openaecLoadUser();
