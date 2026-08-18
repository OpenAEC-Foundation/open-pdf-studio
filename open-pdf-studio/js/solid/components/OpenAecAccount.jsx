// "Sign in with OpenAEC" — platform-account in the title bar (mirrors the
// Open Calc Studio integration: sign-in button when signed out; avatar with
// initials + name and a dropdown when signed in).
//
// Login only: the dropdown offers the portal and sign-out. Cloud storage is
// not wired up here.
import { Show, createSignal, onCleanup } from 'solid-js';
import {
  openaecUser, openaecBusy, openaecError, openaecBrand,
  openaecSignIn, openaecSignOut,
} from '../stores/openaecStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { openExternal, invoke } from '../../core/platform.js';

// Portal-URL komt uit de Rust-config (accountsApiUrl), zodat hij meebeweegt
// met OPENAEC_ACCOUNTS_CONFIG. Stond hier eerst als constante 'http://localhost:3000'
// — een dev-adres dat na de overstap naar productie nergens meer op uitkwam.
// De localStorage-override blijft, voor wie lokaal iets anders wil aanwijzen.
async function portalUrl() {
  try {
    const override = localStorage.getItem('openPdfStudio.openaecPortalUrl');
    if (override) return override;
  } catch (_) { /* private mode */ }
  try {
    return (await invoke('accounts_portal_url')) || '';
  } catch (_) {
    return '';
  }
}

// Up to two initials from the name (or email) — same rule as Open Calc Studio.
function initials(u) {
  const source = (u?.name || u?.email || '').trim();
  const out = source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return out || '?';
}

export default function OpenAecAccount() {
  const { t } = useTranslation('common');
  const [menuOpen, setMenuOpen] = createSignal(false);

  // Match the other menus in the app: the account menu closes on the next
  // click anywhere outside it (clicks inside stop propagation).
  function closeMenu() {
    setMenuOpen(false);
    window.removeEventListener('click', closeMenu);
  }

  function toggleMenu(e) {
    e.stopPropagation();
    if (menuOpen()) { closeMenu(); return; }
    setMenuOpen(true);
    setTimeout(() => window.addEventListener('click', closeMenu), 0);
  }

  onCleanup(() => window.removeEventListener('click', closeMenu));

  async function handlePortal() {
    closeMenu();
    const url = await portalUrl();
    if (url) openExternal(url);
  }

  function handleSignOut() {
    closeMenu();
    openaecSignOut();
  }

  async function handleSignIn() {
    try { await openaecSignIn(); } catch (_) { /* error surfaced via openaecError() */ }
  }

  return (
    <Show
      when={openaecUser()}
      fallback={
        <button
          class="openaec-signin-btn"
          onClick={handleSignIn}
          disabled={openaecBusy()}
          title={openaecError() || t('openaecSignIn')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13">
            <path d="M8 1.5 13.5 4.75v6.5L8 14.5 2.5 11.25v-6.5z" />
            <path d="M8 8v6.5M2.5 4.75 8 8l5.5-3.25" />
          </svg>
          {openaecBusy() ? t('openaecSigningIn') : t('openaecSignIn')}
        </button>
      }
    >
      <div class="openaec-account" onClick={(e) => e.stopPropagation()}>
        <button class="openaec-avatar-btn" onClick={toggleMenu} title={openaecUser().email || openaecUser().name}>
          <span class="openaec-avatar">{initials(openaecUser())}</span>
          <span class="openaec-account-name">{openaecUser().name || openaecUser().email}</span>
        </button>
        <Show when={menuOpen()}>
          <div class="openaec-account-menu">
            <div class="openaec-account-menu-header">
              <Show when={openaecBrand()?.logo}>
                <img class="openaec-brand-logo" src={openaecBrand().logo} alt={openaecBrand()?.orgName || ''} />
              </Show>
              <div class="openaec-account-menu-name">{openaecUser().name || openaecUser().email}</div>
              <Show when={openaecUser().email && openaecUser().email !== openaecUser().name}>
                <div class="openaec-account-menu-email">{openaecUser().email}</div>
              </Show>
            </div>
            <button class="openaec-account-menu-item" onClick={handlePortal}>
              {t('openaecPortal')}
            </button>
            <button class="openaec-account-menu-item" onClick={handleSignOut}>
              {t('openaecSignOut')}
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
