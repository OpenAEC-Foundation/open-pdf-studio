import { createSignal, onMount, Show } from 'solid-js';
import { leesGetal } from '../../../core/getal-invoer.js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { recalculateAllMeasurements, saveDocumentScale } from '../../../annotations/measurement.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { schaalUitKalibratie } from '../../../annotations/kalibratie-schaal.js';
import { geldigeUserUnit, userUnitVanPagina } from '../../../annotations/scale-region-scale.js';
import { SCALE_PRESETS, METRIC_SCALE_PRESETS, IMPERIAL_SCALE_PRESETS } from '../../../annotations/scale-presets.js';
import {
  recordBulkModify,
  recordMeasureScale,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../../core/undo-manager.js';

/**
 * Auto-detect scale from the PDF title block (onderhoek).
 * Scans text content in the bottom-right area of the page for patterns like "1:100".
 */
async function detectScaleFromTitleBlock() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;

  const page = await doc.pdfDoc.getPage(doc.currentPage);
  const vp = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  // Title block is typically in the bottom-right quadrant.
  // We search the right 50% and bottom 40% of the page.
  const regionLeft = vp.width * 0.5;
  const regionTop = vp.height * 0.6;

  // Scale pattern: matches "1:N" where N is a number (with optional spaces)
  const scalePattern = /\b1\s*:\s*(\d+(?:[.,]\d+)?)\b/;

  // Collect text items in the title block region
  const candidates = [];

  for (const item of textContent.items) {
    if (!item.str || item.str.trim().length === 0) continue;
    // item.transform = [scaleX, skewY, skewX, scaleY, translateX, translateY]
    const tx = item.transform[4];
    const ty = item.transform[5];

    // Transform from PDF space to viewport space
    const t = vp.transform;
    const vx = t[0] * tx + t[2] * ty + t[4];
    const vy = t[1] * tx + t[3] * ty + t[5];

    if (vx >= regionLeft && vy >= regionTop) {
      const match = item.str.match(scalePattern);
      if (match) {
        const denominator = leesGetal(match[1]);
        if (denominator >= 1 && denominator <= 10000) {
          candidates.push({ denominator, text: item.str, x: vx, y: vy });
        }
      }
    }
  }

  // If no results in title block region, try the entire page as fallback
  if (candidates.length === 0) {
    for (const item of textContent.items) {
      if (!item.str || item.str.trim().length === 0) continue;
      // Look for explicit "schaal" / "scale" / "maßstab" / "échelle" labels
      const lowerStr = item.str.toLowerCase();
      const hasLabel = /(?:schaal|scale|ma[ßs]stab|[eé]chelle|escala)\s*/i.test(lowerStr);
      if (!hasLabel) continue;

      const match = item.str.match(scalePattern);
      if (match) {
        const denominator = leesGetal(match[1]);
        if (denominator >= 1 && denominator <= 10000) {
          candidates.push({ denominator, text: item.str, x: 0, y: 0 });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Return the first match (closest to bottom-right typically)
  return candidates[0].denominator;
}

export default function CalibrationDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  // Method tab: 'reference' or 'ratio'
  const [method, setMethod] = createSignal('reference');

  // Method 1: Reference line
  const [distance, setDistance] = createSignal(1);
  const [unit, setUnit] = createSignal('mm');
  const [pixels, setPixels] = createSignal(72);

  // Method 2: Scale ratio
  const [scalePreset, setScalePreset] = createSignal('1:100');
  const [customScale, setCustomScale] = createSignal(100);
  const [ratioUnit, setRatioUnit] = createSignal('mm');
  const [pageSizeText, setPageSizeText] = createSignal('');
  const [detecting, setDetecting] = createSignal(false);
  const [detectResult, setDetectResult] = createSignal(null); // null | 'found' | 'notfound'
  // /UserUnit van de pagina: 1:N wordt daarmee pagina-eenheden (#884).
  const [userUnit, setUserUnit] = createSignal(
    userUnitVanPagina(getActiveDocument(), getActiveDocument()?.currentPage));

  onMount(async () => {
    // Pre-fill pixels from reference line if provided
    const refPx = props.data?.referencePixelLength;
    if (refPx && refPx > 0) {
      setPixels(Math.round(refPx * 100) / 100);
      setMethod('reference');
    }

    // Load existing scale from document
    const doc = getActiveDocument();
    const ms = doc?.measureScale;
    if (ms) {
      setUnit(ms.unit || 'mm');
      setRatioUnit(ms.unit || 'mm');
      if (ms.method === 'ratio' && ms.scaleRatio) {
        setMethod('ratio');
        setScalePreset(SCALE_PRESETS.includes(ms.scaleRatio) ? ms.scaleRatio : 'custom');
        if (!SCALE_PRESETS.includes(ms.scaleRatio)) {
          const parts = ms.scaleRatio.split(':');
          setCustomScale(parseInt(parts[1]) || 100);
        }
      }
    }

    // Detect PDF page size
    try {
      const calDoc = getActiveDocument();
      if (calDoc?.pdfDoc) {
        const page = await calDoc.pdfDoc.getPage(calDoc.currentPage);
        setUserUnit(geldigeUserUnit(page.userUnit));
        // De viewport van PDF.js rekent /UserUnit mee: de echte papiermaat.
        const vp = page.getViewport({ scale: 1 });
        // PDF points to mm: 1 pt = 25.4/72 mm
        const wMm = (vp.width * 25.4 / 72).toFixed(0);
        const hMm = (vp.height * 25.4 / 72).toFixed(0);
        setPageSizeText(`${wMm} \u00d7 ${hMm} mm`);
      }
    } catch { /* ignore */ }
  });

  const cancel = () => closeDialog('calibration');

  function getScaleDenominator() {
    const preset = scalePreset();
    if (preset === 'custom') return customScale();
    const parts = preset.split(':');
    return parseInt(parts[1]) || 1;
  }

  async function handleAutoDetect() {
    setDetecting(true);
    setDetectResult(null);
    try {
      const denominator = await detectScaleFromTitleBlock();
      if (denominator) {
        const ratio = `1:${denominator}`;
        if (SCALE_PRESETS.includes(ratio)) {
          setScalePreset(ratio);
        } else {
          setScalePreset('custom');
          setCustomScale(denominator);
        }
        setDetectResult('found');
      } else {
        setDetectResult('notfound');
      }
    } catch {
      setDetectResult('notfound');
    } finally {
      setDetecting(false);
    }
  }

  function handleApply() {
    // De omrekening staat in annotations/kalibratie-schaal.js; de
    // schaalverhouding gaat daar via pixelsPerUnitFor, net als het
    // schaalgebied (#553).
    const scaleData = method() === 'reference'
      ? schaalUitKalibratie({ method: 'reference', distance: distance(), pixels: pixels(), unit: unit() })
      : schaalUitKalibratie({ method: 'ratio', denominator: getScaleDenominator(), unit: ratioUnit(), userUnit: userUnit() });

    if (scaleData) {
      const doc = getActiveDocument();
      if (doc) {
        const oldMeasureScale = doc.measureScale == null
          ? doc.measureScale
          : JSON.parse(JSON.stringify(doc.measureScale));
        const measurements = doc.annotations.filter(annotation =>
          ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
        );
        const originals = measurements.map(annotation => cloneAnnotation(annotation));
        doc.measureScale = scaleData;
        recalculateAllMeasurements();
        beginUndoTransaction();
        recordBulkModify(measurements, originals);
        recordMeasureScale(oldMeasureScale, doc.measureScale);
        endUndoTransaction();
      }
      saveDocumentScale();
    }
    closeDialog('calibration');
  }

  function handleReset() {
    const doc = getActiveDocument();
    if (doc) {
      const oldMeasureScale = doc.measureScale == null
        ? doc.measureScale
        : JSON.parse(JSON.stringify(doc.measureScale));
      const measurements = doc.annotations.filter(annotation =>
        ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
      );
      const originals = measurements.map(annotation => cloneAnnotation(annotation));
      doc.measureScale = null;
      recalculateAllMeasurements();
      beginUndoTransaction();
      recordBulkModify(measurements, originals);
      recordMeasureScale(oldMeasureScale, doc.measureScale);
      endUndoTransaction();
    }
    saveDocumentScale();
    closeDialog('calibration');
  }

  const footer = (
    <>
      <button class="pref-btn" onClick={handleReset}>
        {tCommon('reset')}
      </button>
      <div class="calibration-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={cancel}>
          {tCommon('cancel')}
        </button>
        <button class="pref-btn pref-btn-primary" onClick={handleApply}>
          {tCommon('apply')}
        </button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('calibration.title')}
      overlayClass="calibration-overlay"
      dialogClass="calibration-dialog"
      onClose={cancel}
      footer={footer}
    >
      {/* Method tabs */}
      <div class="calibration-tabs">
        <button
          class={`calibration-tab${method() === 'reference' ? ' active' : ''}`}
          onClick={() => setMethod('reference')}
        >
          {t('calibration.methodReference')}
        </button>
        <button
          class={`calibration-tab${method() === 'ratio' ? ' active' : ''}`}
          onClick={() => setMethod('ratio')}
        >
          {t('calibration.methodRatio')}
        </button>
      </div>

      {/* Method 1: Reference Line */}
      <Show when={method() === 'reference'}>
        <p class="calibration-help">
          {t('calibration.referenceHelp')}
        </p>
        <div class="calibration-row">
          <label class="calibration-label">{t('calibration.measuredPixels')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="calibration-input"
            min="1"
            step="0.01"
            value={pixels()}
            onInput={(e) => setPixels(e.target.value)}
          />
          <span class="calibration-unit">px</span>
        </div>
        <div class="calibration-row">
          <label class="calibration-label">{t('calibration.knownDistance')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="calibration-input"
            min="0.001"
            step="0.01"
            value={distance()}
            onInput={(e) => setDistance(e.target.value)}
          />
          <select
            class="calibration-select"
            value={unit()}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
            <option value="ft">ft</option>
          </select>
        </div>
      </Show>

      {/* Method 2: Scale Ratio */}
      <Show when={method() === 'ratio'}>
        <p class="calibration-help">
          {t('calibration.ratioHelp')}
        </p>
        <div class="calibration-row">
          <label class="calibration-label">{t('calibration.scaleRatio')}</label>
          <select
            class="calibration-select calibration-select-wide"
            value={scalePreset()}
            onChange={(e) => {
              const ratio = e.target.value;
              setScalePreset(ratio);
              if (IMPERIAL_SCALE_PRESETS.some(preset => preset.ratio === ratio)) setRatioUnit('ft');
            }}
          >
            {METRIC_SCALE_PRESETS.map(s => <option value={s}>{s}</option>)}
            {IMPERIAL_SCALE_PRESETS.map(preset => <option value={preset.ratio}>{preset.label}</option>)}
            <option value="custom">{t('calibration.customRatio')}</option>
          </select>
          <Show when={scalePreset() === 'custom'}>
            <span class="calibration-label-inline">1:</span>
            <input
              type="text" inputmode="decimal" data-getal
              class="calibration-input calibration-input-narrow"
              min="1"
              value={customScale()}
              onInput={(e) => { const n = parseFloat(e.target.value); setCustomScale(n > 0 ? n : 1); }}
            />
          </Show>
        </div>
        <div class="calibration-row">
          <label class="calibration-label">{t('calibration.unit')}</label>
          <select
            class="calibration-select"
            value={ratioUnit()}
            onChange={(e) => setRatioUnit(e.target.value)}
          >
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
            <option value="ft">ft</option>
          </select>
        </div>
        <Show when={pageSizeText()}>
          <div class="calibration-page-size">
            {t('calibration.pageSize')} {pageSizeText()}
          </div>
        </Show>
        <div class="calibration-detect-section">
          <button
            class="calibration-detect-btn"
            onClick={handleAutoDetect}
            disabled={detecting()}
          >
            {detecting() ? t('calibration.detecting') : t('calibration.autoDetect')}
          </button>
          <Show when={detectResult() === 'found'}>
            <span class="calibration-detect-found">
              {t('calibration.scaleDetected')}
            </span>
          </Show>
          <Show when={detectResult() === 'notfound'}>
            <span class="calibration-detect-notfound">
              {t('calibration.scaleNotFound')}
            </span>
          </Show>
        </div>
      </Show>
    </Dialog>
  );
}
