import { Show, Switch, Match } from 'solid-js';
import RibbonTab from './RibbonTab.jsx';
import HomeTab from './HomeTab.jsx';
import CommentTab from './CommentTab.jsx';
import ViewTab from './ViewTab.jsx';
import FormsTab from './FormsTab.jsx';
import OrganizeTab from './OrganizeTab.jsx';
import HelpTab from './HelpTab.jsx';
import FormatTab from './FormatTab.jsx';
import ArrangeTab from './ArrangeTab.jsx';
import { activeTab, setActiveTab, contextualTabsVisible } from '../../stores/ribbonStore.js';
import { openBackstage } from '../../../ui/chrome/menus.js';

export default function Ribbon() {
  return (
    <>
      <div class="ribbon-tabs">
        <RibbonTab label="File" isFileTab={true} id="file-tab"
          onClick={() => openBackstage()} />
        <RibbonTab label="Home" dataTab="home"
          isActive={activeTab() === 'home'}
          onClick={() => setActiveTab('home')} />
        <RibbonTab label="Comment" dataTab="comment"
          isActive={activeTab() === 'comment'}
          onClick={() => setActiveTab('comment')} />
        <RibbonTab label="View" dataTab="view"
          isActive={activeTab() === 'view'}
          onClick={() => setActiveTab('view')} />
        <RibbonTab label="Forms" dataTab="forms"
          isActive={activeTab() === 'forms'}
          onClick={() => setActiveTab('forms')} />
        <RibbonTab label="Organize" dataTab="organize"
          isActive={activeTab() === 'organize'}
          onClick={() => setActiveTab('organize')} />
        <RibbonTab label="Help" dataTab="help"
          isActive={activeTab() === 'help'}
          onClick={() => setActiveTab('help')} />
        <Show when={contextualTabsVisible()}>
          <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-tabs-separator"></span>
          <RibbonTab label="Format" dataTab="format" isContextual={true} id="tab-format-btn"
            isActive={activeTab() === 'format'}
            onClick={() => setActiveTab('format')} />
          <RibbonTab label="Arrange" dataTab="arrange" isContextual={true} id="tab-arrange-btn"
            isActive={activeTab() === 'arrange'}
            onClick={() => setActiveTab('arrange')} />
        </Show>
      </div>

      <Switch>
        <Match when={activeTab() === 'home'}><HomeTab /></Match>
        <Match when={activeTab() === 'comment'}><CommentTab /></Match>
        <Match when={activeTab() === 'view'}><ViewTab /></Match>
        <Match when={activeTab() === 'forms'}><FormsTab /></Match>
        <Match when={activeTab() === 'organize'}><OrganizeTab /></Match>
        <Match when={activeTab() === 'help'}><HelpTab /></Match>
        <Match when={activeTab() === 'format'}><FormatTab /></Match>
        <Match when={activeTab() === 'arrange'}><ArrangeTab /></Match>
      </Switch>
    </>
  );
}
