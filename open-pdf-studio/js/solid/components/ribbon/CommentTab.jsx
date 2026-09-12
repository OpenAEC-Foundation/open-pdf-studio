import { createSignal } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { setTool } from '../../../tools/manager.js';
import { state, getActiveDocument, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { recordClearPage, recordClearAll, recordAdd } from '../../../core/undo-manager.js';
import { hideProperties } from '../../../ui/panels/properties-panel.js';
import { clearSelection } from '../../../core/stores/selection-helpers.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon, cloudPolylineIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  redactionIcon, applyRedactionsIcon,
  clearPageIcon, clearAllIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, measureAngleIcon, calibrateIcon
} from '../../data/ribbonIcons.js';

import { useTranslation } from '../../../i18n/useTranslation.js';
import { setPickerOpen as setParametricPickerOpen } from '../../stores/parametricSymbolStore.js';
import { savePreferences } from '../../../core/preferences.js';
import { toggleSchedule, scheduleVisible } from '../../stores/scheduleStore.js';
import { isDynamicScalingEnabled, setDynamicScalingEnabled } from '../../../annotations/dynamic-scaling.js';
import PrefSelect from '../preferences/PrefSelect.jsx';

const scheduleIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1.5" stroke-width="1.5"/><line x1="3" y1="8" x2="21" y2="8" stroke-width="1.5"/><line x1="3" y1="13" x2="21" y2="13" stroke-width="1"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="1"/><line x1="9" y1="8" x2="9" y2="21" stroke-width="1"/><line x1="15" y1="8" x2="15" y2="21" stroke-width="1"/></svg>`;

// The comment groups are exported as a standalone fragment so the merged
// "Tekenen & annotatie" tab (AnnotateTab) can compose them alongside the
// drawing groups inside a single AdaptiveGroups container.
export function CommentGroups() {
  const { t } = useTranslation('ribbon');

  return (
    <>
        {/* Drawing tools (line/arrow/polyline/arc/spline/rect/ellipse/polygon/cloud/cloudPolyline/filledArea/freehand)
            were moved to the dedicated Drawing tab. Comment tab keeps only
            comment-style annotations (highlight, callout, note, stamp, etc.). */}
        <RibbonGroup label={t('comment.drawing')}>
          <RibbonButton id="tool-highlight" title={t('comment.highlight')} icon={highlightIcon} label={t('comment.highlight')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => setTool('highlight')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.text')}>
          <RibbonButton id="tool-textbox" title={t('comment.textBox')} icon={textboxIcon} label={t('comment.textBox')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton id="tool-callout" title={t('comment.callout')} icon={calloutIcon} label={t('comment.callout')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
          <RibbonButton id="tool-comment" title={t('comment.note')} icon={noteIcon} label={t('comment.note')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.stamp')}>
          <RibbonButton id="tool-stamp" title={t('comment.stamp')} icon={stampIcon} label={t('comment.stamp')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'stamp'} onClick={() => setTool('stamp')} />
          <RibbonButton id="tool-signature" title={t('comment.signature')} icon={signatureIcon} label={t('comment.signature')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'signature'} onClick={() => setTool('signature')} />
          <RibbonButton id="tool-parametric-symbol" title={t('comment.parametricSymbol')}
            icon={stampIcon} label={t('comment.parametricSymbol')}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'parametricSymbol'}
            onClick={() => setParametricPickerOpen(true)} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.redaction')}>
          <RibbonButton id="tool-redaction" title={t('comment.markForRedaction')} icon={redactionIcon} label={t('comment.redact')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => setTool('redaction')} />
          <RibbonButton id="btn-apply-redactions" title={t('comment.applyRedactions')} icon={applyRedactionsIcon} label={t('comment.applyLabel')}
            disabled={noPdf() || isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={async () => {
              const { applyRedactions } = await import('../../../annotations/redaction.js');
              await applyRedactions();
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.properties')}>
          <RibbonButtonStack>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.color')}</label>
              <input type="color" id="color-picker" class="ribbon-color-input"
                value={colorPickerValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setColorPickerValue(e.target.value)} />
            </div>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.width')}</label>
              <input type="number" id="line-width" class="ribbon-input" min="1" max="20"
                value={lineWidthValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setLineWidthValue(parseInt(e.target.value) || 3)} />
            </div>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-clear" title={t('comment.clearPageAnnotations')} icon={clearPageIcon} label={t('comment.clearPage')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                let confirmed = false;
                if (window.__TAURI__?.dialog?.ask) {
                  confirmed = await window.__TAURI__.dialog.ask(t('comment.clearPageConfirm'), { title: t('comment.clearPage'), kind: 'warning' });
                } else {
                  confirmed = confirm(t('comment.clearPageConfirm'));
                }
                if (confirmed) {
                  const cpDoc = getActiveDocument();
                  const cpPage = cpDoc ? cpDoc.currentPage : 1;
                  recordClearPage(cpPage, cpDoc?.annotations || []);
                  if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
            <RibbonButton size="small" id="ribbon-clear-all" title={t('comment.clearAllAnnotations')} icon={clearAllIcon} label={t('comment.clearAll')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                const caDoc = getActiveDocument();
                if (!caDoc || caDoc.annotations.length === 0) return;
                const confirmed = await window.__TAURI__?.dialog?.ask(t('comment.clearAllConfirm'), { title: t('comment.clearAll'), kind: 'warning' });
                if (confirmed) {
                  recordClearAll(caDoc.annotations);
                  caDoc.annotations = [];
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools') || 'METEN'}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('measure.measureDistance') || 'Afstand meten'} icon={measureDistanceIcon} label={t('measure.distance') || 'Afstand'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('measure.area') || 'Oppervlakte'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('measure.measurePerimeter') || 'Omtrek meten'} icon={measurePerimeterIcon} label={t('measure.perimeter') || 'Omtrek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
            <RibbonButton size="small" id="tool-measure-angle" title={t('measure.measureAngle') || 'Hoek meten'} icon={measureAngleIcon} label={t('measure.angle') || 'Hoek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Schaal group (Schaalgebied / Schaalgebied op pagina) moved to the
            Tekenen tab — see DrawingTab.jsx. */}

        <RibbonGroup label={t('measure.schedule') || 'HOEVEELHEDEN'}>
          <RibbonButton id="btn-open-schedule"
            title={t('measure.openSchedule') || 'Hoeveelheden'}
            icon={scheduleIcon}
            label={t('measure.takeOff') || 'Hoeveelheden'}
            disabled={noPdf()}
            active={scheduleVisible()}
            onClick={toggleSchedule} />
        </RibbonGroup>
    </>
  );
}

export default function CommentTab() {
  return (
    <div class="ribbon-content active" id="tab-comment">
      <AdaptiveGroups>
        <CommentGroups />
      </AdaptiveGroups>
    </div>
  );
}
