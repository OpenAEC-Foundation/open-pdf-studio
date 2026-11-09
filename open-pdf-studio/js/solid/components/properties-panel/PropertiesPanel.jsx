import { Show, For, onMount } from 'solid-js';
import { panelVisible, panelCollapsed, setPanelCollapsed, annotProps, sectionVis, updateAnnotProp, cycleSelectNext, nativePanelHidden, hydrateCollapsedSections, getCurrentAnnotation, SCHAALBALK_MIN_HOOGTE_PT } from '../../stores/propertiesStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import DimensionTypeSection from './DimensionTypeSection.jsx';
import LocationSection from './LocationSection.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import HatchPatternSection from './HatchPatternSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import InkSection from './InkSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import MeasurementSection from './MeasurementSection.jsx';
import CountGroupSection from './CountGroupSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import LinkSection from './LinkSection.jsx';
import ImageSection from './ImageSection.jsx';
import { PapierMaatInvoer, PapierEenheidKeuze } from './PapierMaat.jsx';
import { leesInvoerInEenheid } from '../../../annotations/papiermaat-eenheid.js';
import { scaleSelectOptions, isImperialScalePreset, scaleDisplayLabel } from '../../../annotations/scale-presets.js';
import { beginUndoTransaction, endUndoTransaction } from '../../../core/undo-manager.js';
import { papierEenheid } from '../../stores/papierEenheidStore.js';
import ActionsSection from './ActionsSection.jsx';
import CustomFieldsSection from './CustomFieldsSection.jsx';
import CustomPluginPanel from './CustomPluginPanel.jsx';
import ScopedInstancePanels from './ScopedInstancePanels.jsx';
import CollapsibleSection from './CollapsibleSection.jsx';
import ParametricSymbolSection from './ParametricSymbolSection.jsx';
import GevelelementSection from './GevelelementSection.jsx';
import StavenreeksSection from './StavenreeksSection.jsx';
import WallSection from './WallSection.jsx';
import BetonbalkSection from './BetonbalkSection.jsx';
import SysteemrasterSection from './SysteemrasterSection.jsx';
import { SectieContext, sectieVolgorde, zetStandaardSectieVolgorde } from '../../stores/sectieVolgordeStore.js';
import DynamicStampSection from './DynamicStampSection.jsx';

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

// Losse secties die direct in het paneel stonden; als component zodat ze in
// de verplaatsbare sectielijst passen (#967).
function ViewportSection() {
  return (
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
            {/* Metrisch en imperiaal (#972); de waarde is de noemer. */}
            {scaleSelectOptions([10,20,25,50,75,100,125,150,200,250,300,400,500,750,1000,1250,2000,2500,5000].map(r => `1:${r}`))
              .map(o => <option value={o.value.slice(2)}>{o.label}</option>)}
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
  );
}

function ScaleRegionSection() {
  const { t } = useTranslation('properties');
  return (
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
            onChange={(e) => {
              const ratio = e.target.value;
              // An imperial preset reads in feet (#972): one undo step.
              beginUndoTransaction();
              try {
                updateAnnotProp('scaleRegionScale', ratio);
                if (isImperialScalePreset(ratio)) updateAnnotProp('scaleRegionUnits', 'ft');
              } finally {
                endUndoTransaction();
              }
            }}
          >
            {(() => {
              // Standard drawing scales, metric and imperial (#972);
              // prepend the region's current value when it's a
              // custom one so the select never shows blank.
              const presets = scaleSelectOptions(['1:200','1:100','1:50','1:20','1:10','1:5','1:2','1:1']);
              const cur = annotProps.scaleRegionScale || '1:100';
              const list = presets.some(o => o.value === cur) ? presets
                : [{ value: cur, label: scaleDisplayLabel(cur, annotProps.scaleRegionUnits) }, ...presets];
              return list.map(o => <option value={o.value}>{o.label}</option>);
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
          <input type="text" inputmode="decimal" data-getal step="1" min="1"
            value={annotProps.scaleRegionWidth ?? ''}
            disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
            onChange={(e) => updateAnnotProp('scaleRegionWidth', e.target.value)}
          />
        </div>
        <div class="property-group">
          <label>Hoogte ({annotProps.scaleRegionUnits || 'mm'})</label>
          <input type="text" inputmode="decimal" data-getal step="1" min="1"
            value={annotProps.scaleRegionHeight ?? ''}
            disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
            onChange={(e) => updateAnnotProp('scaleRegionHeight', e.target.value)}
          />
        </div>
      </CollapsibleSection>
    </Show>
  );
}

function ScaleBarSection() {
  const { t } = useTranslation('properties');
  return (
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
          <input type="text" inputmode="decimal" data-getal step="1" min="1"
            value={annotProps.scaleBarTotalUnits}
            disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
            onChange={(e) => updateAnnotProp('scaleBarTotalUnits', e.target.value)}
          />
        </div>
        <div class="property-group">
          <label>{t('scaleBar.divisions')}</label>
          <input type="text" inputmode="decimal" data-getal step="1" min="1" max="20"
            value={annotProps.scaleBarDivisions}
            disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
            onChange={(e) => updateAnnotProp('scaleBarDivisions', e.target.value)}
          />
        </div>
        {/* Balkhoogte is een papiermaat: in de gekozen eenheid (#598),
            in het model paginapunten (4 pt of meer). */}
        <div class="property-group">
          <label>{t('scaleBar.barHeight')}</label>
          <PapierMaatInvoer pt={() => annotProps.scaleBarHeight} bron={() => annotProps.id}
            disabled={annotProps.locked === true || annotProps.locked === 'mixed'}
            onWijzig={(tekst) => {
              const pt = leesInvoerInEenheid(tekst, papierEenheid(), { min: SCHAALBALK_MIN_HOOGTE_PT });
              if (pt != null) updateAnnotProp('scaleBarHeight', pt);
            }}
          />
          <PapierEenheidKeuze />
        </div>
      </CollapsibleSection>
    </Show>
  );
}

// Verplaatsbare secties (#967) in hun standaardvolgorde. De gebruiker sleept
// een sectiekop naar een andere plek; die volgorde geldt voor elke soort
// annotatie (secties die een soort niet heeft, tonen gewoon niets).
const SECTIES = [
  ['general', GeneralSection],
  // Hyperlink (#953): het doel staat bovenaan, het is wat een link is.
  ['link', LinkSection],
  ['location', LocationSection],
  ['replies', RepliesSection],
  ['appearance', AppearanceSection],
  ['hatchPattern', HatchPatternSection],
  ['lineEndings', LineEndingsSection],
  ['ink', InkSection],
  ['dimensions', DimensionsSection],
  ['measurement', MeasurementSection],
  ['countGroup', CountGroupSection],
  ['viewport', ViewportSection],
  ['scaleRegion', ScaleRegionSection],
  ['scaleBar', ScaleBarSection],
  ['parametricSymbol', ParametricSymbolSection],
  ['gevelelement', GevelelementSection],
  ['stavenreeks', StavenreeksSection],
  ['wall', WallSection],
  ['betonbalk', BetonbalkSection],
  ['systeemraster', SysteemrasterSection],
  ['dynamicStamp', DynamicStampSection],
  ['textFormat', TextFormatSection],
  ['paragraph', ParagraphSection],
  ['content', ContentSection],
  ['image', ImageSection],
];
const SECTIE_COMPONENT = new Map(SECTIES);
zetStandaardSectieVolgorde(SECTIES.map(([k]) => k));

function VerplaatsbareSecties() {
  return (
    <For each={sectieVolgorde()}>
      {(sleutel) => {
        const Sectie = SECTIE_COMPONENT.get(sleutel);
        return Sectie
          ? <SectieContext.Provider value={sleutel}><Sectie /></SectieContext.Provider>
          : null;
      }}
    </For>
  );
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
            <VerplaatsbareSecties />
            <CustomFieldsSection />
            <CustomPluginPanel />
            <ScopedInstancePanels />
            <ActionsSection />
          </div>
        </Show>
      </div>
    </Show>
  );
}
