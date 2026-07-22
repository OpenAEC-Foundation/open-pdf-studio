import { Show, onMount } from 'solid-js';
import { panelVisible, panelCollapsed, setPanelCollapsed, annotProps, sectionVis, updateAnnotProp, cycleSelectNext, nativePanelHidden, hydrateCollapsedSections, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import DimensionTypeSection from './DimensionTypeSection.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import HatchPatternSection from './HatchPatternSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import MeasurementSection from './MeasurementSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import CustomFieldsSection from './CustomFieldsSection.jsx';
import CustomPluginPanel from './CustomPluginPanel.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import ParametricSymbolSection from './ParametricSymbolSection.jsx';
import StavenreeksSection from './StavenreeksSection.jsx';
import WallSection from './WallSection.jsx';

// "Meet op tekening" for an EXISTING scale region: temporary 2-click
// distance pick → small "real length" dialog → the region's scale is
// updated in place (see MeasuredLengthDialog, target kind 'annotation').
function measureScaleOnDrawing() {
  const ann = getCurrentAnnotation();
  if (!ann || ann.type !== 'scaleRegion') return;
  const annotationId = ann.id;
  const defaultUnit = ann.units || 'mm';
  startScaleMeasureFlow({
    onDone: (pixelDistance) => {
      openDialog('measured-length', {
        pixelDistance,
        target: { kind: 'annotation', annotationId, defaultUnit },
      });
    },
    onCancel: () => {},
  });
}

export default function PropertiesPanel() {
  const { t } = useTranslation('properties');

  // Restore remembered section-collapse state once (preferences are loaded by now).
  onMount(hydrateCollapsedSections);

  function expandPanel() {
    setPanelCollapsed(false);
  }

  return (
    <Show when={panelVisible() && !nativePanelHidden()}>
      <div class={`properties-panel-outer ${panelCollapsed() ? 'collapsed' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        <Show when={panelCollapsed()}>
          <div class="properties-panel-collapsed-content" onClick={expandPanel}>
            <span class="properties-panel-collapsed-text">{t('title')}</span>
          </div>
        </Show>
        <Show when={!panelCollapsed()}>
          <div class="properties-panel visible" id="properties-panel">
            <PanelHeader />
            <DocInfoView />
            {/* Dimension type selector pinned at the very top for maatlijnen */}
            <DimensionTypeSection />
            <GeneralSection />
            <RepliesSection />
            <AppearanceSection />
            <HatchPatternSection />
            <LineEndingsSection />
            <DimensionsSection />
            <MeasurementSection />
            <Show when={annotProps.annotationType === 'viewport'}>
              <CollapsibleSection title="Viewport" name="viewport" id="prop-viewport-section">
                <div class="property-group">
                  <label>Name</label>
                  <input type="text"
                    value={annotProps.viewportName || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('viewportName', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>Scale</label>
                  <select
                    value={annotProps.viewportScaleRatio ? annotProps.viewportScaleRatio.replace('1:', '') : '100'}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('viewportScaleRatio', e.target.value)}
                  >
                    {[10,20,25,50,75,100,125,150,200,250,300,400,500,750,1000,1250,2000,2500,5000].map(r =>
                      <option value={r}>1:{r}</option>
                    )}
                  </select>
                </div>
                <div class="property-group">
                  <label>Unit</label>
                  <select
                    value={annotProps.viewportUnit || 'mm'}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('viewportUnit', e.target.value)}
                  >
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
              </CollapsibleSection>
            </Show>
            <Show when={annotProps.annotationType === 'scaleRegion'}>
              <CollapsibleSection title={t('scaleRegion.title') || 'Scale Region'} name="scaleRegion" id="prop-scaleregion-section">
                <div class="property-group">
                  <label>{t('scaleRegion.label') || 'Label'}</label>
                  <input type="text"
                    value={annotProps.scaleRegionLabel || ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionLabel', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleRegion.scale') || 'Scale'}</label>
                  <select
                    value={annotProps.scaleRegionScale || '1:100'}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionScale', e.target.value)}
                  >
                    {(() => {
                      // Standard drawing scales; prepend the region's current
                      // value when it's a custom one so the select never
                      // shows blank.
                      const presets = ['1:200','1:100','1:50','1:20','1:10','1:5','1:2','1:1'];
                      const cur = annotProps.scaleRegionScale || '1:100';
                      const list = presets.includes(cur) ? presets : [cur, ...presets];
                      return list.map(s => <option value={s}>{s}</option>);
                    })()}
                  </select>
                </div>
                <div class="property-group">
                  <button class="pref-btn" style="width:100%"
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onClick={measureScaleOnDrawing}>
                    {t('scaleRegion.measure') || 'Meet op tekening'}
                  </button>
                </div>
                <div class="property-group">
                  <label>{t('scaleRegion.unit') || 'Unit'}</label>
                  <select
                    value={annotProps.scaleRegionUnits || 'mm'}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionUnits', e.target.value)}
                  >
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
                {/* Real-world size of the region itself, in its own scale +
                    units — editable, resizes the region (top-left anchored). */}
                <div class="property-group">
                  <label>Breedte ({annotProps.scaleRegionUnits || 'mm'})</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleRegionWidth ?? ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionWidth', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>Hoogte ({annotProps.scaleRegionUnits || 'mm'})</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleRegionHeight ?? ''}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleRegionHeight', e.target.value)}
                  />
                </div>
              </CollapsibleSection>
            </Show>
            <Show when={sectionVis.scaleBar}>
              <CollapsibleSection title={t('scaleBar.title')} name="scaleBar" id="prop-scalebar-section">
                <div class="property-group">
                  <label>{t('scaleBar.unit')}</label>
                  <select value={annotProps.scaleBarUnit}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onDblClick={cycleSelectNext}
                    onChange={(e) => updateAnnotProp('scaleBarUnit', e.target.value)}>
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                    <option value="in">in</option>
                    <option value="ft">ft</option>
                  </select>
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.totalLength')}</label>
                  <input type="number" step="1" min="1"
                    value={annotProps.scaleBarTotalUnits}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarTotalUnits', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.divisions')}</label>
                  <input type="number" step="1" min="1" max="20"
                    value={annotProps.scaleBarDivisions}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarDivisions', e.target.value)}
                  />
                </div>
                <div class="property-group">
                  <label>{t('scaleBar.barHeight')}</label>
                  <input type="number" step="1" min="4" max="100"
                    value={annotProps.scaleBarHeight}
                    disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
                    onChange={(e) => updateAnnotProp('scaleBarHeight', e.target.value)}
                  />
                </div>
              </CollapsibleSection>
            </Show>
            <ParametricSymbolSection />
            <StavenreeksSection />
            <WallSection />
            <TextFormatSection />
            <ParagraphSection />
            <ContentSection />
            <ImageSection />
            <CustomFieldsSection />
            <CustomPluginPanel />
            <ActionsSection />
          </div>
        </Show>
      </div>
    </Show>
  );
}
