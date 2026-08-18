import { Show, Switch, Match, ErrorBoundary } from 'solid-js';
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
import AITab from './AITab.jsx';
import { activeTab, setActiveTab, contextualTabsVisible } from '../../stores/ribbonStore.js';
import { imageSelected } from '../../stores/imageEditStore.js';
import { openAppMenu } from '../../../ui/chrome/menus.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function Ribbon() {
  const { t } = useTranslation('ribbon');

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
      <div class="ribbon-tabs">
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
        <RibbonTab label={t('tabs.ai')} dataTab="ai"
          isActive={activeTab() === 'ai'}
          onClick={() => setActiveTab('ai')} />
        <RibbonTab label={t('tabs.help')} dataTab="help"
          isActive={activeTab() === 'help'}
          onClick={() => setActiveTab('help')} />
        <Show when={contextualTabsVisible()}>
          <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-tabs-separator"></span>
          <RibbonTab label={t('tabs.format')} dataTab="format" isContextual={true} id="tab-format-btn"
            isActive={activeTab() === 'format'}
            onClick={() => setActiveTab('format')} />
          <RibbonTab label={t('tabs.arrange')} dataTab="arrange" isContextual={true} id="tab-arrange-btn"
            isActive={activeTab() === 'arrange'}
            onClick={() => setActiveTab('arrange')} />
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

      <Show when={!ribbonCollapsed()}>
        <Switch>
          <Match when={activeTab() === 'drawing'}><DrawingTab /></Match>
          <Match when={commentActive()}><CommentTab /></Match>
          <Match when={activeTab() === 'home'}><HomeTab /></Match>
          <Match when={activeTab() === 'view'}><ViewTab /></Match>
          <Match when={activeTab() === 'organize'}><OrganizeTab /></Match>
          <Match when={activeTab() === 'ai'}><AITab /></Match>
          <Match when={activeTab() === 'help'}><HelpTab /></Match>
          <Match when={activeTab() === 'format'}><FormatTab /></Match>
          <Match when={activeTab() === 'arrange'}><ArrangeTab /></Match>
          <Match when={activeTab() === 'image'}><ImageTab /></Match>
        </Switch>
      </Show>
    </>
  );
}
