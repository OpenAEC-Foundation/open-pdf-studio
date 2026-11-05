// Werkruimten en interfacegrootte op het tabblad Beeld (#932): een knop met
// een menu om een opgeslagen indeling te kiezen, de huidige te bewaren, terug
// te gaan naar de standaardindeling en de bediening kleiner of groter te
// maken.

import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { normaliseerWerkruimten, leesLayout, zelfdeLayout } from '../../../core/werkruimte.js';
import { UI_SCALES, normalizeUiScale } from '../../../core/ui-scale.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { autoShrinkLabel } from './autoShrinkLabel.js';
import { volgPopup } from './ribbon-popup.js';

export const WERKRUIMTE_ICOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/><line x1="8" y1="9" x2="16" y2="9"/></svg>`;

const toepassen = () => import('../../../ui/panels/werkruimte-toepassen.js');

export default function WorkspaceMenu() {
  const { t } = useTranslation('ribbon');
  const [open, setOpen] = createSignal(false);
  let containerRef;
  let knopRef;
  let menuRef;
  volgPopup(() => menuRef, () => knopRef, open);

  onMount(() => {
    const handler = (e) => {
      if (containerRef && !containerRef.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handler);
    onCleanup(() => document.removeEventListener('click', handler));
  });

  const lijst = () => normaliseerWerkruimten(state.preferences.workspaces);
  // Een werkruimte is "actief" zolang de indeling er nog precies zo uitziet.
  const isHuidig = (w) => zelfdeLayout(w.layout, leesLayout(state.preferences));
  const schaal = () => normalizeUiScale(state.preferences.uiScale);

  const kies = (naam) => { setOpen(false); toepassen().then(m => m.kiesWerkruimte(naam)); };
  const standaard = () => { setOpen(false); toepassen().then(m => m.herstelStandaardIndeling()); };
  const beheer = () => { setOpen(false); openDialog('workspaces', {}); };
  const zetSchaal = (waarde) => {
    state.preferences.uiScale = normalizeUiScale(waarde);
    savePreferences();
  };

  return (
    <div class="workspace-menu" id="ribbon-workspace" ref={containerRef}>
      <button class="ribbon-btn" id="ribbon-workspace-btn" ref={knopRef} type="button"
        title={t('workspace.buttonTitle')} aria-haspopup="menu" aria-expanded={open()}
        onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}>
        <div class="ribbon-btn-icon" ref={el => { el.innerHTML = WERKRUIMTE_ICOON; }}></div>
        <span class="ribbon-btn-label" ref={el => autoShrinkLabel(el)}>{t('workspace.button')}</span>
        <svg class="workspace-menu-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="8" height="8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class={`ribbon-split-btn-menu${open() ? ' show' : ''}`} ref={menuRef} role="menu">
        <div class="ribbon-split-btn-menu-header">{t('workspace.saved')}</div>
        <Show when={lijst().length} fallback={<div class="ribbon-split-btn-menu-empty">{t('workspace.none')}</div>}>
          <For each={lijst()}>
            {(w) => (
              <button class="ribbon-split-btn-menu-item" role="menuitemradio" aria-checked={isHuidig(w)}
                classList={{ active: isHuidig(w) }} onClick={() => kies(w.naam)}>
                {w.naam}
              </button>
            )}
          </For>
        </Show>
        <div class="ribbon-split-btn-menu-sep" role="separator"></div>
        <button class="ribbon-split-btn-menu-item" id="ribbon-workspace-save" role="menuitem" onClick={beheer}>
          {t('workspace.manage')}
        </button>
        <button class="ribbon-split-btn-menu-item" id="ribbon-workspace-reset" role="menuitem" onClick={standaard}>
          {t('workspace.reset')}
        </button>
        <div class="ribbon-split-btn-menu-sep" role="separator"></div>
        <div class="ribbon-split-btn-menu-header">{t('workspace.interfaceSize')}</div>
        <div class="workspace-menu-scales">
          <For each={UI_SCALES}>
            {(waarde) => (
              <button class="ribbon-split-btn-menu-item workspace-menu-scale" role="menuitemradio"
                aria-checked={schaal() === waarde} classList={{ active: schaal() === waarde }}
                onClick={(e) => { e.stopPropagation(); zetSchaal(waarde); }}>
                {`${waarde}%`}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
