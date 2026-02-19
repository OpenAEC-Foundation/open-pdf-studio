import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import ThemePicker from './ThemePicker.jsx';
import { singlePageIcon, continuousIcon, navigationIcon, propertiesIcon, annotationsListIcon } from '../../data/ribbonIcons.js';
import { setViewMode } from '../../../pdf/renderer.js';
import { toggleLeftPanel } from '../../../ui/panels/left-panel.js';
import { toggleAnnotationsListPanel } from '../../../ui/panels/annotations-list.js';
import { showProperties, hideProperties, closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { panelVisible, setPanelVisible } from '../../stores/propertiesStore.js';
import { state } from '../../../core/state.js';

export default function ViewTab() {
  return (
    <div class="ribbon-content active" id="tab-view">
      <div class="ribbon-groups">
        <RibbonGroup label="Page Display">
          <RibbonButton id="single-page" title="Single Page" icon={singlePageIcon} label="Single"
            active={state.viewMode === 'single'}
            onClick={() => setViewMode('single')} />
          <RibbonButton id="continuous" title="Continuous (coming soon)" icon={continuousIcon} label="Continuous"
            active={state.viewMode === 'continuous'}
            disabled={true} style={{ opacity: '0.4', cursor: 'default' }} />
        </RibbonGroup>

        <RibbonGroup label="Panels">
          <RibbonButton id="ribbon-nav-panel" title="Navigation Panel (F9)" icon={navigationIcon} label="Navigation"
            onClick={() => toggleLeftPanel()} />
          <RibbonButton id="ribbon-properties-panel" title="Properties Panel (F12)" icon={propertiesIcon} label="Properties"
            active={panelVisible()}
            onClick={() => {
              if (panelVisible()) {
                closePropertiesPanel();
              } else {
                setPanelVisible(true);
                if (state.selectedAnnotation) {
                  showProperties(state.selectedAnnotation);
                } else {
                  hideProperties();
                }
              }
            }} />
          <RibbonButton id="ribbon-annotations-list" title="Annotations List (F11)" icon={annotationsListIcon} label="Annotations"
            onClick={() => toggleAnnotationsListPanel()} />
        </RibbonGroup>

        <RibbonGroup label="Appearance">
          <ThemePicker />
        </RibbonGroup>
      </div>
    </div>
  );
}
