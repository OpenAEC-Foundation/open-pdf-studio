import { createSignal, Switch, Match, For } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';
import PrefComboBox from './PrefComboBox.jsx';
import PrefSelect from './PrefSelect.jsx';
import { PAPIER_EENHEDEN } from '../../../annotations/papiermaat-eenheid.js';

const SUB_TABS = [
  { id: 'general', key: 'annotations.subtabGeneral' },
  { id: 'comments', key: 'annotations.subtabComments' },
  { id: 'text', key: 'annotations.subtabText' },
  { id: 'drawing', key: 'annotations.subtabDrawing' },
  { id: 'shapes', key: 'annotations.subtabShapes' },
  { id: 'measurement', key: 'annotations.subtabMeasurement' },
];

export default function AnnotationsTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const p = props.prefs;
  const [subTab, setSubTab] = createSignal('general');

  const borderStyleOpts = [
    { value: 'solid', label: tCommon('solid') },
    { value: 'dashed', label: tCommon('dashed') },
    { value: 'dotted', label: tCommon('dotted') },
    { value: 'dash-dot', label: tCommon('dashDot') },
    { value: 'dash-dot-dot', label: tCommon('dashDotDot') },
    { value: 'long-dash', label: tCommon('longDash') },
    { value: 'long-dash-dot', label: tCommon('longDashDot') },
    { value: 'long-dash-dot-dot', label: tCommon('longDashDotDot') },
  ];

  const lineEndingOpts = (ns) => [
    { value: 'none', label: tCommon('none') },
    { value: 'square', label: t(`${ns}.square`) },
    { value: 'circle', label: t(`${ns}.circle`) },
    { value: 'diamond', label: t(`${ns}.diamond`) },
    { value: 'open', label: t(`${ns}.openArrow`) },
    { value: 'closed', label: t(`${ns}.closedArrow`) },
    { value: 'butt', label: t(`${ns}.butt`) },
    { value: 'openReversed', label: t(`${ns}.openArrowReversed`) },
    { value: 'closedReversed', label: t(`${ns}.closedArrowReversed`) },
    { value: 'slash', label: t(`${ns}.slash`) },
  ];

  const drawHeadOpts = [
    { value: 'none', label: tCommon('none') },
    { value: 'square', label: t('drawing.headSquare') },
    { value: 'circle', label: t('drawing.headCircle') },
    { value: 'diamond', label: t('drawing.headDiamond') },
    { value: 'open', label: t('drawing.headOpen') },
    { value: 'closed', label: t('drawing.headClosed') },
    { value: 'butt', label: t('drawing.headButt') },
    { value: 'openReversed', label: t('drawing.headOpenReversed') },
    { value: 'closedReversed', label: t('drawing.headClosedReversed') },
    { value: 'slash', label: t('drawing.headSlash') },
  ];

  const iconOpts = [
    { value: 'comment', label: t('annotations.iconComment') },
    { value: 'note', label: t('annotations.iconNote') },
    { value: 'help', label: t('annotations.iconHelp') },
    { value: 'insert', label: t('annotations.iconInsert') },
    { value: 'key', label: t('annotations.iconKey') },
    { value: 'newparagraph', label: t('annotations.iconNewParagraph') },
    { value: 'paragraph', label: t('annotations.iconParagraph') },
    { value: 'check', label: t('annotations.iconCheck') },
    { value: 'circle', label: t('annotations.iconCircle') },
    { value: 'cross', label: t('annotations.iconCross') },
    { value: 'star', label: t('annotations.iconStar') },
  ];

  const unitOpts = [
    { value: 'mm', label: 'mm' }, { value: 'cm', label: 'cm' }, { value: 'm', label: 'm' },
    { value: 'in', label: 'in' }, { value: 'ft', label: 'ft' }, { value: 'pt', label: 'pt' }, { value: 'px', label: 'px' },
  ];

  const precisionOpts = [
    { value: 0, label: '1' }, { value: 1, label: '0.1' }, { value: 2, label: '0.01' }, { value: 3, label: '0.001' },
    { value: 4, label: '0.0001' }, { value: 5, label: '0.00001' }, { value: 6, label: '0.000001' },
    { value: 7, label: '0.0000001' }, { value: 8, label: '0.00000001' }, { value: 9, label: '0.000000001' },
  ];

  const roundingOpts = [
    { value: 'none', label: t('measurement.roundingNone') },
    { value: '1', label: t('measurement.rounding1mm') },
    { value: '5', label: t('measurement.rounding5mm') },
    { value: '10', label: t('measurement.rounding10mm') },
  ];

  const decimalOpts = [
    { value: 'auto', label: t('measurement.decimalAuto') },
    { value: 'comma', label: t('measurement.decimalComma') },
    { value: 'point', label: t('measurement.decimalPoint') },
  ];

  const measureHeadOpts = lineEndingOpts('measurement');

  return (
    <div class="pref-subtab-wrapper">
      <div class="pref-subtabs">
        <For each={SUB_TABS}>
          {(tab) => (
            <button
              class="pref-subtab"
              classList={{ active: subTab() === tab.id }}
              onClick={() => setSubTab(tab.id)}
            >
              {t(tab.key)}
            </button>
          )}
        </For>
      </div>

      <div class="pref-subtab-content">
        <Switch>
          <Match when={subTab() === 'general'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.generalDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.defaultAnnotationColor')}</label>
                <PrefColorPicker value={p.defaultAnnotationColor[0]} setValue={p.defaultAnnotationColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.defaultLineWidth')}</label>
                <PrefComboBox value={p.defaultLineWidth[0]} setValue={p.defaultLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.defaultFontSize')}</label>
                <PrefComboBox value={p.defaultFontSize[0]} setValue={p.defaultFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={16} suffix="pt" />
              </div>
              {/* Eenheid van papiermaten in het eigenschappenpaneel (#598). */}
              <div class="pref-row">
                <label>{t('annotations.paperSizeUnit')}</label>
                <PrefSelect value={p.paperSizeUnit[0]} setValue={p.paperSizeUnit[1]}
                  options={PAPIER_EENHEDEN.map(u => ({ value: u, label: u }))} style={{ width: '80px' }} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.highlightOpacity')}</label>
                <PrefComboBox value={p.highlightOpacity[0]} setValue={p.highlightOpacity[1]} min={10} max={100} fallback={50} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.angleSnap')}</label>
                <PrefComboBox value={p.angleSnapDegrees[0]} setValue={p.angleSnapDegrees[1]} options={[10,15,20,30,45]} min={1} max={90} fallback={30} suffix="°" />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.objectSnapping')}</legend>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.enableObjectSnap[0]()} onChange={e => p.enableObjectSnap[1](e.target.checked)} />
                  <span>{t('annotations.enableObjectSnap')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToEndpoints[0]()} onChange={e => p.snapToEndpoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToEndpoints')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToMidpoints[0]()} onChange={e => p.snapToMidpoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToMidpoints')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToCenters[0]()} onChange={e => p.snapToCenters[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToCenters')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToVertices[0]()} onChange={e => p.snapToVertices[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToVertices')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToStartPoints[0]()} onChange={e => p.snapToStartPoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToStartPoints')}</span>
                </label>
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToEdges[0]()} onChange={e => p.snapToEdges[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToEdges')}</span>
                </label>
              </div>
              <div class="pref-row">
                <label>{t('annotations.objectSnapRadius')}</label>
                <PrefComboBox value={p.objectSnapRadius[0]} setValue={p.objectSnapRadius[1]} options={[5,8,10,15,20]} min={3} max={30} fallback={10} suffix="px" />
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.snapToPdfContent[0]()} onChange={e => p.snapToPdfContent[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
                  <span>{t('annotations.snapToPdfContent')}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.highlightDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.color')}</label>
                <PrefColorPicker value={p.highlightColor[0]} setValue={p.highlightColor[1]} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.redactionDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.overlayColor')}</label>
                <PrefColorPicker value={p.redactionOverlayColor[0]} setValue={p.redactionOverlayColor[1]} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'comments'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.commentNoteDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.color')}</label>
                <PrefColorPicker value={p.commentColor[0]} setValue={p.commentColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.icon')}</label>
                <PrefSelect value={p.commentIcon[0]} setValue={p.commentIcon[1]} options={iconOpts} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'text'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.textBoxDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.fillColor')}</label>
                <PrefColorPicker value={p.textboxFillColor[0]} setValue={p.textboxFillColor[1]} noneChecked={p.textboxFillNone[0]} setNoneChecked={p.textboxFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.strokeColor')}</label>
                <PrefColorPicker value={p.textboxStrokeColor[0]} setValue={p.textboxStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderWidth')}</label>
                <PrefComboBox value={p.textboxBorderWidth[0]} setValue={p.textboxBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0} max={20} fallback={1} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderStyle')}</label>
                <PrefSelect value={p.textboxBorderStyle[0]} setValue={p.textboxBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.opacity')}</label>
                <PrefComboBox value={p.textboxOpacity[0]} setValue={p.textboxOpacity[1]} min={10} max={100} fallback={100} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.fontSize')}</label>
                <PrefComboBox value={p.textboxFontSize[0]} setValue={p.textboxFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={14} suffix="pt" />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.calloutDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.fillColor')}</label>
                <PrefColorPicker value={p.calloutFillColor[0]} setValue={p.calloutFillColor[1]} noneChecked={p.calloutFillNone[0]} setNoneChecked={p.calloutFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.strokeColor')}</label>
                <PrefColorPicker value={p.calloutStrokeColor[0]} setValue={p.calloutStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderWidth')}</label>
                <PrefComboBox value={p.calloutBorderWidth[0]} setValue={p.calloutBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0} max={20} fallback={1} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderStyle')}</label>
                <PrefSelect value={p.calloutBorderStyle[0]} setValue={p.calloutBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.opacity')}</label>
                <PrefComboBox value={p.calloutOpacity[0]} setValue={p.calloutOpacity[1]} min={10} max={100} fallback={100} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.fontSize')}</label>
                <PrefComboBox value={p.calloutFontSize[0]} setValue={p.calloutFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={14} suffix="pt" />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'drawing'}>
            <fieldset class="pref-fieldset">
              <legend>{t('drawing.freehandDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.drawStrokeColor[0]} setValue={p.drawStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.drawLineWidth[0]} setValue={p.drawLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.drawOpacity[0]} setValue={p.drawOpacity[1]} min={10} max={100} fallback={100} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.smoothing')}</label>
                <PrefComboBox value={p.drawSmoothing[0]} setValue={p.drawSmoothing[1]} options={[0,25,50,75,100]} min={0} max={100} fallback={50} suffix="" />
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label" title={t('drawing.pressureHint')}>
                  <input type="checkbox" checked={p.drawPressure[0]()} onChange={e => p.drawPressure[1](e.target.checked)} />
                  <span>{t('drawing.pressure')}</span>
                </label>
              </div>
              <div class="pref-row">
                <label>{t('drawing.pressureMinWidth')}</label>
                <PrefComboBox value={p.drawPressureMinWidth[0]} setValue={p.drawPressureMinWidth[1]} options={[10,20,30,40,50,75,100]} min={5} max={100} fallback={30} disabled={() => !p.drawPressure[0]()} />
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label" title={t('drawing.penOnlyHint')}>
                  <input type="checkbox" checked={p.drawPenOnly[0]()} onChange={e => p.drawPenOnly[1](e.target.checked)} />
                  <span>{t('drawing.penOnly')}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.lineDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.lineStrokeColor[0]} setValue={p.lineStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.lineLineWidth[0]} setValue={p.lineLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.borderStyle')}</label>
                <PrefSelect value={p.lineBorderStyle[0]} setValue={p.lineBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.lineOpacity[0]} setValue={p.lineOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.arrowDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.arrowStrokeColor[0]} setValue={p.arrowStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.fillColor')}</label>
                <PrefColorPicker value={p.arrowFillColor[0]} setValue={p.arrowFillColor[1]} noneChecked={p.arrowFillNone[0]} setNoneChecked={p.arrowFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.arrowLineWidth[0]} setValue={p.arrowLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.borderStyle')}</label>
                <PrefSelect value={p.arrowBorderStyle[0]} setValue={p.arrowBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.start')}</label>
                <PrefSelect value={p.arrowStartHead[0]} setValue={p.arrowStartHead[1]} options={drawHeadOpts} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.end')}</label>
                <PrefSelect value={p.arrowEndHead[0]} setValue={p.arrowEndHead[1]} options={drawHeadOpts} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.headSize')}</label>
                <input type="text" inputmode="decimal" data-getal min="4" max="40" value={p.arrowHeadSize[0]()} onInput={e => p.arrowHeadSize[1](parseInt(e.target.value) || 12)} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.arrowOpacity[0]} setValue={p.arrowOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.polylineDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.polylineStrokeColor[0]} setValue={p.polylineStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.polylineLineWidth[0]} setValue={p.polylineLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.polylineOpacity[0]} setValue={p.polylineOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'shapes'}>
            <fieldset class="pref-fieldset">
              <legend>{t('shapes.rectangleDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.fillColor')}</label>
                <PrefColorPicker value={p.rectFillColor[0]} setValue={p.rectFillColor[1]} noneChecked={p.rectFillNone[0]} setNoneChecked={p.rectFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.rectStrokeColor[0]} setValue={p.rectStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderWidth')}</label>
                <PrefComboBox value={p.rectBorderWidth[0]} setValue={p.rectBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderStyle')}</label>
                <PrefSelect value={p.rectBorderStyle[0]} setValue={p.rectBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.rectOpacity[0]} setValue={p.rectOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.ellipseDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.fillColor')}</label>
                <PrefColorPicker value={p.circleFillColor[0]} setValue={p.circleFillColor[1]} noneChecked={p.circleFillNone[0]} setNoneChecked={p.circleFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.circleStrokeColor[0]} setValue={p.circleStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderWidth')}</label>
                <PrefComboBox value={p.circleBorderWidth[0]} setValue={p.circleBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderStyle')}</label>
                <PrefSelect value={p.circleBorderStyle[0]} setValue={p.circleBorderStyle[1]} options={borderStyleOpts} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.circleOpacity[0]} setValue={p.circleOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.polygonDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.polygonStrokeColor[0]} setValue={p.polygonStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.lineWidth')}</label>
                <PrefComboBox value={p.polygonLineWidth[0]} setValue={p.polygonLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.polygonOpacity[0]} setValue={p.polygonOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.cloudDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.cloudStrokeColor[0]} setValue={p.cloudStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.lineWidth')}</label>
                <PrefComboBox value={p.cloudLineWidth[0]} setValue={p.cloudLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.cloudOpacity[0]} setValue={p.cloudOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'measurement'}>
            <fieldset class="pref-fieldset">
              <legend>{t('measurement.global')}</legend>
              <div class="pref-row">
                <label>{t('measurement.rounding')}</label>
                <PrefSelect value={p.measureRounding[0]} setValue={p.measureRounding[1]} options={roundingOpts} />
              </div>
              <div class="pref-row">
                <label>{t('measurement.ctrlSnap')}</label>
                <PrefComboBox value={p.measureCtrlSnap[0]} setValue={p.measureCtrlSnap[1]}
                  options={[1, 5, 10, 20, 50, 100]} min={1} max={1000} suffix="" fallback={10} />
              </div>
              {/* Getalnotatie van maten (#629): decimaalteken per taal of vast. */}
              <div class="pref-row">
                <label>{t('measurement.decimalNotation')}</label>
                <PrefSelect value={p.measureDecimalNotation[0]} setValue={p.measureDecimalNotation[1]} options={decimalOpts} />
              </div>
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.measureDigitGrouping[0]()} onChange={e => p.measureDigitGrouping[1](e.target.checked)} />
                  <span>{t('measurement.digitGrouping')}</span>
                </label>
              </div>
            </fieldset>

            {/* Schaalcontrole (#629): wanneer een afwijking goed, een waarschuwing of fout is. */}
            <fieldset class="pref-fieldset">
              <legend>{t('measurement.scaleCheck')}</legend>
              <div class="pref-row">
                <label>{t('measurement.scaleCheckOk')}</label>
                <PrefComboBox value={p.scaleCheckOkPercent[0]} setValue={p.scaleCheckOkPercent[1]}
                  options={[0.1, 0.25, 0.5, 1]} min={0.01} max={50} suffix="%" fallback={0.5} />
              </div>
              <div class="pref-row">
                <label>{t('measurement.scaleCheckWarn')}</label>
                <PrefComboBox value={p.scaleCheckWarnPercent[0]} setValue={p.scaleCheckWarnPercent[1]}
                  options={[1, 2, 3, 5]} min={0.01} max={100} suffix="%" fallback={2} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('measurement.distanceDefaults')}</legend>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.appearance')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.strokeColor')}</label>
                  <PrefColorPicker value={p.measureDistStrokeColor[0]} setValue={p.measureDistStrokeColor[1]} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.lineWidth')}</label>
                  <PrefComboBox value={p.measureDistLineWidth[0]} setValue={p.measureDistLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={1} suffix="pt" />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.borderStyle')}</label>
                  <PrefSelect value={p.measureDistBorderStyle[0]} setValue={p.measureDistBorderStyle[1]} options={borderStyleOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.opacity')}</label>
                  <PrefComboBox value={p.measureDistOpacity[0]} setValue={p.measureDistOpacity[1]} min={10} max={100} fallback={100} />
                </div>
              </fieldset>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.lineEndings')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.start')}</label>
                  <PrefSelect value={p.measureDistStartHead[0]} setValue={p.measureDistStartHead[1]} options={measureHeadOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.end')}</label>
                  <PrefSelect value={p.measureDistEndHead[0]} setValue={p.measureDistEndHead[1]} options={measureHeadOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.headSize')}</label>
                  <input type="text" inputmode="decimal" data-getal min="4" max="40" value={p.measureDistHeadSize[0]()} onInput={e => p.measureDistHeadSize[1](parseInt(e.target.value) || 12)} />
                </div>
              </fieldset>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.scalePrecision')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.scale')}</label>
                  <input type="text" inputmode="decimal" data-getal step="0.001" min="0" value={p.measureDistDimScale[0]()} onInput={e => p.measureDistDimScale[1](parseFloat(e.target.value) || 0)} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.unit')}</label>
                  <PrefSelect value={p.measureDistDimUnit[0]} setValue={p.measureDistDimUnit[1]} options={unitOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.precision')}</label>
                  <PrefSelect value={p.measureDistDimPrecision[0]} setValue={p.measureDistDimPrecision[1]} options={precisionOpts} />
                </div>
              </fieldset>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('measurement.areaDefaults')}</legend>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.appearance')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.strokeColor')}</label>
                  <PrefColorPicker value={p.measureAreaStrokeColor[0]} setValue={p.measureAreaStrokeColor[1]} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.fillColor')}</label>
                  <PrefColorPicker value={p.measureAreaFillColor[0]} setValue={p.measureAreaFillColor[1]} noneChecked={p.measureAreaFillNone[0]} setNoneChecked={p.measureAreaFillNone[1]} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.lineWidth')}</label>
                  <PrefComboBox value={p.measureAreaLineWidth[0]} setValue={p.measureAreaLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={1} suffix="pt" />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.borderStyle')}</label>
                  <PrefSelect value={p.measureAreaBorderStyle[0]} setValue={p.measureAreaBorderStyle[1]} options={borderStyleOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.opacity')}</label>
                  <PrefComboBox value={p.measureAreaOpacity[0]} setValue={p.measureAreaOpacity[1]} min={10} max={100} fallback={100} />
                </div>
              </fieldset>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.scalePrecision')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.scale')}</label>
                  <input type="text" inputmode="decimal" data-getal step="0.001" min="0" value={p.measureAreaDimScale[0]()} onInput={e => p.measureAreaDimScale[1](parseFloat(e.target.value) || 0)} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.unit')}</label>
                  <PrefSelect value={p.measureAreaDimUnit[0]} setValue={p.measureAreaDimUnit[1]} options={unitOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.precision')}</label>
                  <PrefSelect value={p.measureAreaDimPrecision[0]} setValue={p.measureAreaDimPrecision[1]} options={precisionOpts} />
                </div>
              </fieldset>

              {/* Zijdematen (#536): standaard voor nieuwe meetvlakken, uit. */}
              <div class="pref-row pref-checkbox-row">
                <label class="pref-checkbox-label">
                  <input type="checkbox" checked={p.measureAreaShowEdgeLengths[0]()} onChange={e => p.measureAreaShowEdgeLengths[1](e.target.checked)} />
                  <span>{t('measurement.showEdgeLengths')}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('measurement.perimeterDefaults')}</legend>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.appearance')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.strokeColor')}</label>
                  <PrefColorPicker value={p.measurePerimStrokeColor[0]} setValue={p.measurePerimStrokeColor[1]} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.lineWidth')}</label>
                  <PrefComboBox value={p.measurePerimLineWidth[0]} setValue={p.measurePerimLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={1} suffix="pt" />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.borderStyle')}</label>
                  <PrefSelect value={p.measurePerimBorderStyle[0]} setValue={p.measurePerimBorderStyle[1]} options={borderStyleOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.opacity')}</label>
                  <PrefComboBox value={p.measurePerimOpacity[0]} setValue={p.measurePerimOpacity[1]} min={10} max={100} fallback={100} />
                </div>
              </fieldset>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.lineEndings')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.start')}</label>
                  <PrefSelect value={p.measurePerimStartHead[0]} setValue={p.measurePerimStartHead[1]} options={measureHeadOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.end')}</label>
                  <PrefSelect value={p.measurePerimEndHead[0]} setValue={p.measurePerimEndHead[1]} options={measureHeadOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.headSize')}</label>
                  <input type="text" inputmode="decimal" data-getal min="4" max="40" value={p.measurePerimHeadSize[0]()} onInput={e => p.measurePerimHeadSize[1](parseInt(e.target.value) || 12)} />
                </div>
              </fieldset>

              <fieldset class="pref-fieldset pref-fieldset-nested">
                <legend>{t('measurement.scalePrecision')}</legend>
                <div class="pref-row">
                  <label>{t('measurement.scale')}</label>
                  <input type="text" inputmode="decimal" data-getal step="0.001" min="0" value={p.measurePerimDimScale[0]()} onInput={e => p.measurePerimDimScale[1](parseFloat(e.target.value) || 0)} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.unit')}</label>
                  <PrefSelect value={p.measurePerimDimUnit[0]} setValue={p.measurePerimDimUnit[1]} options={unitOpts} />
                </div>
                <div class="pref-row">
                  <label>{t('measurement.precision')}</label>
                  <PrefSelect value={p.measurePerimDimPrecision[0]} setValue={p.measurePerimDimPrecision[1]} options={precisionOpts} />
                </div>
              </fieldset>
            </fieldset>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
