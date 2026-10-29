import { Show, Switch, Match, ErrorBoundary, createEffect } from 'solid-js';
import RibbonTab from './RibbonTab.jsx';
import HomeTab from './HomeTab.jsx';
import DrawingTab from './DrawingTab.jsx';
import CommentTab from './CommentTab.jsx';
import ViewTab from './ViewTab.jsx';
import OrganizeTab from './OrganizeTab.jsx';
import HelpTab from './HelpTab.jsx';
import FormatTab from './FormatTab.jsx';
import ArrangeTab from './ArrangeTab.jsx';
import ImageTab from './ImageTab.jsx';
import ExtensionRibbonTab, { ExtensionTabStrip, isExtensieTabblad } from './ExtensionRibbonTab.jsx';
import { volgendeTab } from './ribbon-toetsenbord.js';
import { lintRegister } from '../../../plugins/ribbon-tab-registry.js';
import { activeTab, setActiveTab, contextualTabsVisible } from '../../stores/ribbonStore.js';
import { imageSelected } from '../../stores/imageEditStore.js';
import { opmaakVoorNieuw } from '../../stores/formatStore.js';
import { openAppMenu } from '../../../ui/chrome/menus.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { zetLintUitvoerder } from '../../../core/keybindings/app-shortcuts.js';

// Het register van extensietabbladen (#551) zet een verdwenen actief tabblad
// zelf terug op 'home'; daarvoor kent het hier het actieve tabblad.
lintRegister.koppelLint({ lees: activeTab, zet: setActiveTab });

// Een sneltoets voor een lintknop (#714) klikt die knop. Alleen het open
// tabblad staat in de DOM: staat de knop op een ander tabblad (of is het lint
// ingeklapt), dan zet dit dat tabblad heel even neer, klikt en zet alles
// terug. Solid werkt de DOM synchroon bij, er komt geen frame tussen.
zetLintUitvoerder((knopId, tab) => {
  const klik = (el) => {
    if (!el || el.disabled) return false;
    el.click();
    return true;
  };
  const el = document.getElementById(knopId);
  if (el) return klik(el);
  if (!tab) return false;
  const vorigTab = activeTab();
  const ingeklapt = state.preferences.ribbonCollapsed === true;
  try {
    if (ingeklapt) state.preferences.ribbonCollapsed = false;
    setActiveTab(tab);
    return klik(document.getElementById(knopId));
  } finally {
    setActiveTab(vorigTab);
    if (ingeklapt) state.preferences.ribbonCollapsed = true;
  }
});

// De ingebouwde tab-id's ('measure' is de oude naam van 'comment').
const INGEBOUWDE_TABBLADEN = new Set(['home', 'view', 'drawing', 'comment', 'measure', 'organize', 'help', 'format', 'arrange', 'image']);

export default function Ribbon() {
  const { t } = useTranslation('ribbon');
  let tablistEl;
  // Stond de focus in de tabstrook? Dan gaat hij na het verdwijnen van een
  // tabblad naar de knop van het nieuwe actieve tabblad.
  let focusInStrook = false;

  // Een actief tabblad dat geen ingebouwd en geen geregistreerd extensietabblad
  // (meer) is, wordt 'home'. Dat dekt ook een terugkeer naar een verdwenen tabblad.
  createEffect(() => {
    const id = activeTab();
    if (!INGEBOUWDE_TABBLADEN.has(id) && !isExtensieTabblad(id)) setActiveTab('home');
  });

  const knopVan = (id) => tablistEl?.querySelector(`.ribbon-tab[role="tab"][data-tab="${CSS.escape(id)}"]`);
  const focusActief = () => {
    const id = commentActive() ? 'comment' : activeTab();
    requestAnimationFrame(() => knopVan(id)?.focus());
  };
  createEffect(() => {
    activeTab();
    isExtensieTabblad(activeTab());
    if (focusInStrook && tablistEl && !tablistEl.contains(document.activeElement)) focusActief();
  });

  // Pijl links/rechts (gespiegeld bij rtl), Home en End verplaatsen de focus
  // en activeren het tabblad; Enter en spatie werken via de native knop. Een
  // toets met Alt, Ctrl, Meta of Shift, of die al is afgehandeld, blijft liggen.
  const opToets = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const knop = e.target.closest?.('.ribbon-tab[role="tab"]');
    if (!knop || !tablistEl?.contains(knop)) return;
    const tabs = [...tablistEl.querySelectorAll('.ribbon-tab[role="tab"]')].map((k) => k.dataset.tab);
    const rtl = getComputedStyle(tablistEl).direction === 'rtl';
    const volgende = volgendeTab(tabs, knop.dataset.tab, e.key, rtl);
    if (!volgende) return;
    e.preventDefault();
    setActiveTab(volgende);
    requestAnimationFrame(() => knopVan(volgende)?.focus());
  };
  const opFocusIn = () => { focusInStrook = true; };
  const opFocusUit = (e) => {
    if (e.relatedTarget && tablistEl?.contains(e.relatedTarget)) return;
    const weg = e.target;
    // Zonder nieuw doel kan de knop net verwijderd zijn; dan blijft de focus "in de strook".
    queueMicrotask(() => { if (weg.isConnected) focusInStrook = false; });
  };

  // The "Annotatie" tab (former 'comment') also covers the legacy 'measure'
  // tab id so any old code path that activates 'measure' lands there.
  const commentActive = () =>
    activeTab() === 'comment' || activeTab() === 'measure';

  const ribbonCollapsed = () => state.preferences.ribbonCollapsed === true;
  const toggleCollapsed = () => {
    state.preferences.ribbonCollapsed = !ribbonCollapsed();
    savePreferences();
  };

  return (
    <>
      <div class="ribbon-tabs" role="tablist" ref={tablistEl}
        onKeyDown={opToets} onFocusIn={opFocusIn} onFocusOut={opFocusUit}>
        <RibbonTab label={t('tabs.file')} isFileTab={true} id="file-tab"
          onClick={() => openAppMenu()} />
        <RibbonTab label={t('tabs.home')} dataTab="home"
          isActive={activeTab() === 'home'}
          onClick={() => setActiveTab('home')} />
        <RibbonTab label={t('tabs.view')} dataTab="view"
          isActive={activeTab() === 'view'}
          onClick={() => setActiveTab('view')} />
        <RibbonTab label={t('tabs.drawing')} dataTab="drawing"
          isActive={activeTab() === 'drawing'}
          onClick={() => setActiveTab('drawing')} />
        <RibbonTab label={t('tabs.comment')} dataTab="comment"
          isActive={commentActive()}
          onClick={() => setActiveTab('comment')} />
        <RibbonTab label={t('tabs.organize')} dataTab="organize"
          isActive={activeTab() === 'organize'}
          onClick={() => setActiveTab('organize')} />
        <RibbonTab label={t('tabs.help')} dataTab="help"
          isActive={activeTab() === 'help'}
          onClick={() => setActiveTab('help')} />
        {/* Linttabbladen van extensies (#551): na Instellingen, vóór de contextuele. */}
        <ExtensionTabStrip activeTab={activeTab} setActiveTab={setActiveTab} strookOuder={() => tablistEl} />
        <Show when={contextualTabsVisible()}>
          <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-tabs-separator"></span>
          <RibbonTab label={t('tabs.format')} dataTab="format" isContextual={true} id="tab-format-btn"
            isActive={activeTab() === 'format'}
            onClick={() => setActiveTab('format')} />
          {/* Schikken werkt op een selectie; tijdens het invoegen van
              symbolen (#587) of het tekenen met een gereedschap (#668)
              staat alleen Opmaak open. */}
          <Show when={!opmaakVoorNieuw()}>
            <RibbonTab label={t('tabs.arrange')} dataTab="arrange" isContextual={true} id="tab-arrange-btn"
              isActive={activeTab() === 'arrange'}
              onClick={() => setActiveTab('arrange')} />
          </Show>
        </Show>
        <Show when={imageSelected()}>
          <Show when={!contextualTabsVisible()}>
            <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-image-separator"></span>
          </Show>
          <RibbonTab label={t('tabs.image')} dataTab="image" isContextual={true} id="tab-image-btn"
            isActive={activeTab() === 'image'}
            onClick={() => setActiveTab('image')} />
        </Show>
        {/* Collapse/expand toggle (issue #278): hides the ribbon body so only
            the tab strip remains. State is remembered in preferences. */}
        <button
          type="button"
          class="ribbon-collapse-toggle"
          id="ribbon-collapse-toggle"
          title={ribbonCollapsed() ? (t('common.expandRibbon') || 'Expand ribbon') : (t('common.collapseRibbon') || 'Collapse ribbon')}
          onClick={toggleCollapsed}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d={ribbonCollapsed() ? 'M2 4 L6 8 L10 4' : 'M2 8 L6 4 L10 8'}
              fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      {/* De inhoud blijft een direct kind van .ribbon-container, zonder
          omhulling: bestaande extensies verbergen de ingebouwde inhoud met
          een kindselector (`.x > .ribbon-content`). Elke tabknop wijst met
          aria-controls naar de inhoud van zijn eigen tabblad (#tab-<id>). */}
      <Show when={!ribbonCollapsed()}>
        <Switch>
          <Match when={activeTab() === 'drawing'}><DrawingTab /></Match>
          <Match when={commentActive()}><CommentTab /></Match>
          <Match when={activeTab() === 'home'}><HomeTab /></Match>
          <Match when={activeTab() === 'view'}><ViewTab /></Match>
          <Match when={activeTab() === 'organize'}><OrganizeTab /></Match>
          <Match when={activeTab() === 'help'}><HelpTab /></Match>
          <Match when={activeTab() === 'format'}><FormatTab /></Match>
          <Match when={activeTab() === 'arrange'}><ArrangeTab /></Match>
          <Match when={activeTab() === 'image'}><ImageTab /></Match>
          <Match when={isExtensieTabblad(activeTab())}>
            <ErrorBoundary fallback={(fout) => {
              console.warn('[extensies] tabblad kon niet worden getekend', fout);
              return <div class="ribbon-content active" id={`tab-${activeTab()}`} role="tabpanel"><div class="ribbon-ext-fout">{t('common.extensionTabFailed')}</div></div>;
            }}>
              <Show when={activeTab()} keyed>{(id) => <ExtensionRibbonTab id={id} />}</Show>
            </ErrorBoundary>
          </Match>
        </Switch>
      </Show>
    </>
  );
}
