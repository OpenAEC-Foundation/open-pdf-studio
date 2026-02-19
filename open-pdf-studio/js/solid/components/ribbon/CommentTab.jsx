import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { setTool } from '../../../tools/manager.js';
import { state } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { undo, recordClearPage, recordClearAll } from '../../../core/undo-manager.js';
import { hideProperties } from '../../../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon,
  redactionIcon, applyRedactionsIcon,
  undoIcon, clearPageIcon, clearAllIcon
} from '../../data/ribbonIcons.js';

export default function CommentTab() {
  return (
    <div class="ribbon-content active" id="tab-comment">
      <div class="ribbon-groups">
        <RibbonGroup label="Drawing">
          <RibbonButton id="tool-highlight" title="Highlight" icon={highlightIcon} label="Highlight"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => setTool('highlight')} />
          <RibbonButton id="tool-draw" title="Freehand" icon={freehandIcon} label="Freehand"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'draw'} onClick={() => setTool('draw')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-line" title="Line" icon={lineIcon} label="Line"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'line'} onClick={() => setTool('line')} />
            <RibbonButton size="small" id="tool-arrow" title="Arrow" icon={arrowIcon} label="Arrow"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'arrow'} onClick={() => setTool('arrow')} />
            <RibbonButton size="small" id="tool-polyline" title="Polyline (double-click to finish)" icon={polylineIcon} label="Polyline"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'polyline'} onClick={() => setTool('polyline')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Shapes">
          <RibbonButton id="tool-box" title="Rectangle" icon={rectIcon} label="Rect"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'box'} onClick={() => setTool('box')} />
          <RibbonButton id="tool-circle" title="Ellipse" icon={ellipseIcon} label="Ellipse"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'circle'} onClick={() => setTool('circle')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-polygon" title="Polygon" icon={polygonIcon} label="Polygon"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'polygon'} onClick={() => setTool('polygon')} />
            <RibbonButton size="small" id="tool-cloud" title="Cloud" icon={cloudIcon} label="Cloud"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'cloud'} onClick={() => setTool('cloud')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Text">
          <RibbonButton id="tool-text" title="Text" icon={textAnnotIcon} label="Text"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'text'} onClick={() => setTool('text')} />
          <RibbonButton id="tool-textbox" title="Text Box" icon={textboxIcon} label="Text Box"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton id="tool-comment" title="Note" icon={noteIcon} label="Note"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
          <RibbonButton id="tool-callout" title="Callout" icon={calloutIcon} label="Callout"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
        </RibbonGroup>

        <RibbonGroup label="Stamp">
          <RibbonButton id="tool-stamp" title="Stamp" icon={stampIcon} label="Stamp"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'stamp'} onClick={() => setTool('stamp')} />
          <RibbonButton id="tool-signature" title="Signature" icon={signatureIcon} label="Signature"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'signature'} onClick={() => setTool('signature')} />
        </RibbonGroup>

        <RibbonGroup label="Measure">
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title="Measure Distance" icon={measureDistanceIcon} label="Distance"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title="Measure Area" icon={measureAreaIcon} label="Area"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
            <RibbonButton size="small" id="tool-measure-perimeter" title="Measure Perimeter" icon={measurePerimeterIcon} label="Perimeter"
              disabled={isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Redaction">
          <RibbonButton id="tool-redaction" title="Mark for Redaction" icon={redactionIcon} label="Redact"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => setTool('redaction')} />
          <RibbonButton id="btn-apply-redactions" title="Apply Redactions on Current Page" icon={applyRedactionsIcon} label="Apply"
            disabled={isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={async () => {
              const { applyRedactions } = await import('../../../annotations/redaction.js');
              applyRedactions();
            }} />
        </RibbonGroup>

        <RibbonGroup label="Properties">
          <RibbonButtonStack>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">Color</label>
              <input type="color" id="color-picker" class="ribbon-color-input"
                value={colorPickerValue()}
                disabled={isPdfAReadOnly()}
                onInput={(e) => setColorPickerValue(e.target.value)} />
            </div>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">Width</label>
              <input type="number" id="line-width" class="ribbon-input" min="1" max="20"
                value={lineWidthValue()}
                disabled={isPdfAReadOnly()}
                onInput={(e) => setLineWidthValue(parseInt(e.target.value) || 3)} />
            </div>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Edit">
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-undo" title="Undo" icon={undoIcon} label="Undo"
              disabled={isPdfAReadOnly()} onClick={() => undo()} />
            <RibbonButton size="small" id="tool-clear" title="Clear Page Annotations" icon={clearPageIcon} label="Clear Page"
              disabled={isPdfAReadOnly()} onClick={() => {
                if (confirm('Clear all annotations on current page?')) {
                  recordClearPage(state.currentPage, state.annotations);
                  state.annotations = state.annotations.filter(a => a.page !== state.currentPage);
                  hideProperties();
                  if (state.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
            <RibbonButton size="small" id="ribbon-clear-all" title="Clear All Annotations" icon={clearAllIcon} label="Clear All"
              disabled={isPdfAReadOnly()} onClick={async () => {
                if (state.annotations.length === 0) return;
                const confirmed = await window.__TAURI__?.dialog?.ask('Clear ALL annotations from ALL pages?', { title: 'Clear All', kind: 'warning' });
                if (confirmed) {
                  recordClearAll(state.annotations);
                  state.annotations = [];
                  hideProperties();
                  if (state.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
          </RibbonButtonStack>
        </RibbonGroup>
      </div>
    </div>
  );
}
