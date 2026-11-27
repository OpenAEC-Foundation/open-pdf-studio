import { createSignal, createMemo, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { US_PAPIERFORMATEN, usFormatenVan, usFormaatTekst, usInMm } from '../../../core/us-papierformaten.js';
import { MIN_CONTENT_AREA_MM, hasMargins, validateResizeMargins } from '../../../pdf/resize-margins-geometry.js';

// Preset sizes in millimetres (portrait: width x height).
const PRESETS = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
  // US-tekenvellen ARCH A–E1 en ANSI A–E (#996), uit de gedeelde lijst.
  ...Object.fromEntries(US_PAPIERFORMATEN.map((f) => { const mm = usInMm(f); return [f.sleutel, [mm.breedte, mm.hoogte]]; })),
};

const NO_MARGINS = { left: 0, right: 0, top: 0, bottom: 0 };
// The sides in reading order of the grid: two fields per row.
const MARGIN_SIDES = [
  ['left', 'resizePages.marginLeft'],
  ['right', 'resizePages.marginRight'],
  ['top', 'resizePages.marginTop'],
  ['bottom', 'resizePages.marginBottom'],
];

// One set of margins: left/right/top/bottom in mm.
function MarginFields(props) {
  return (
    <div class="crop-margins-row resize-margins-row">
      <label class="crop-margins-label">{props.label}</label>
      <div class="resize-margins-grid">
        <For each={MARGIN_SIDES}>{([side, key]) => (
          <>
            <span>{props.t(key)}</span>
            <input
              type="text" inputmode="decimal" data-getal
              class="crop-margins-input"
              data-margin={`${props.name}-${side}`}
              value={props.value[side]}
              min="0"
              max="10000"
              step="1"
              onInput={(e) => props.onChange({ ...props.value, [side]: parseFloat(e.target.value) || 0 })}
            />
          </>
        )}</For>
      </div>
    </div>
  );
}

export default function ResizePagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;

  const [applyTo, setApplyTo] = createSignal('current');
  const [rangeStr, setRangeStr] = createSignal('');
  const [preset, setPreset] = createSignal('a4');
  const [orientation, setOrientation] = createSignal('portrait');
  const [customW, setCustomW] = createSignal(210);
  const [customH, setCustomH] = createSignal(297);
  const [scaleContent, setScaleContent] = createSignal(true);
  // Margins in mm, as the page is displayed (#1291). One set for all pages,
  // or a second set for the even page numbers.
  const [margins, setMargins] = createSignal(NO_MARGINS);
  const [evenMargins, setEvenMargins] = createSignal(NO_MARGINS);
  const [differentEven, setDifferentEven] = createSignal(false);
  let evenEdited = false;

  // Resolve the target width/height in mm, applying orientation.
  const dims = createMemo(() => {
    let w, h;
    if (preset() === 'custom') {
      w = customW();
      h = customH();
    } else {
      [w, h] = PRESETS[preset()];
    }
    if (orientation() === 'landscape' && h > w) [w, h] = [h, w];
    if (orientation() === 'portrait' && w > h) [w, h] = [h, w];
    return { w, h };
  });

  const close = () => closeDialog('resize-pages');

  const toggleDifferentEven = (on) => {
    // Facing pages mirror each other: start the even pages from the margins
    // entered so far with left and right swapped, until they get their own.
    if (on && !evenEdited) {
      const m = margins();
      setEvenMargins({ left: m.right, right: m.left, top: m.top, bottom: m.bottom });
    }
    setDifferentEven(on);
  };

  // What goes to the resize: null when no margin is set at all.
  const marginSets = createMemo(() => {
    const sets = { odd: margins(), even: differentEven() ? evenMargins() : null };
    return hasMargins(sets.odd) || hasMargins(sets.even) ? sets : null;
  });

  // Why the margins cannot be used on the chosen size, as text; '' when they can.
  const marginError = createMemo(() => {
    const { w, h } = dims();
    const problem = validateResizeMargins(w, h, { odd: margins(), even: differentEven() ? evenMargins() : null });
    if (!problem) return '';
    const mm = (value) => Math.round(value * 10) / 10;
    let message;
    if (problem.code === 'too-wide') message = t('resizePages.marginsTooWide', { size: mm(w), min: MIN_CONTENT_AREA_MM });
    else if (problem.code === 'too-high') message = t('resizePages.marginsTooHigh', { size: mm(h), min: MIN_CONTENT_AREA_MM });
    else message = t('resizePages.marginsNegative');
    return problem.pages === 'even' ? t('resizePages.marginsEvenPages', { message }) : message;
  });

  const handleResize = async () => {
    // Margins that do not fit the page: the reason is shown in the dialog, which stays open.
    if (marginError()) return;
    const applyToVal = applyTo();
    const rangeVal = rangeStr();
    const { w, h } = dims();
    const marginsVal = marginSets();

    close();

    const { resizePages } = await import('../../../pdf/resize-pages.js');
    const result = await resizePages(applyToVal, rangeVal, w, h, scaleContent(), marginsVal);

    if (!result.resized) {
      showMessage(t('resizePages.nothingResized'));
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleResize}>{tCommon('apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('resizePages.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.applyTo')}</label>
          <select class="crop-margins-select" value={applyTo()} onChange={(e) => setApplyTo(e.target.value)}>
            <option value="current">{t('resizePages.currentPage')}</option>
            <option value="all">{t('resizePages.allPages')}</option>
            <option value="range">{t('resizePages.pageRange')}</option>
          </select>
        </div>
        <Show when={applyTo() === 'range'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.pages')}</label>
            <input
              type="text"
              class="crop-margins-input-wide"
              placeholder={t('resizePages.pagesPlaceholder')}
              value={rangeStr()}
              onInput={(e) => setRangeStr(e.target.value)}
            />
          </div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.size')}</label>
          <select class="crop-margins-select" value={preset()} onChange={(e) => setPreset(e.target.value)}>
            <option value="a3">A3 (297 × 420 mm)</option>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="a5">A5 (148 × 210 mm)</option>
            <option value="letter">{t('resizePages.letter')}</option>
            <option value="legal">{t('resizePages.legal')}</option>
            <option value="tabloid">{t('resizePages.tabloid')}</option>
            <optgroup label={t('newDoc.usArchitectural')}>
              <For each={usFormatenVan('arch')}>{(f) => <option value={f.sleutel}>{usFormaatTekst(f)}</option>}</For>
            </optgroup>
            <optgroup label={t('newDoc.usEngineering')}>
              <For each={usFormatenVan('ansi')}>{(f) => <option value={f.sleutel}>{usFormaatTekst(f)}</option>}</For>
            </optgroup>
            <option value="custom">{t('resizePages.custom')}</option>
          </select>
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.orientation')}</label>
          <select class="crop-margins-select" value={orientation()} onChange={(e) => setOrientation(e.target.value)}>
            <option value="portrait">{t('resizePages.portrait')}</option>
            <option value="landscape">{t('resizePages.landscape')}</option>
          </select>
        </div>
        <Show when={preset() === 'custom'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.width')}</label>
            <input
              type="text" inputmode="decimal" data-getal
              class="crop-margins-input"
              value={customW()}
              min="1"
              max="10000"
              step="1"
              onInput={(e) => setCustomW(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.height')}</label>
            <input
              type="text" inputmode="decimal" data-getal
              class="crop-margins-input"
              value={customH()}
              min="1"
              max="10000"
              step="1"
              onInput={(e) => setCustomH(parseFloat(e.target.value) || 0)}
            />
          </div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.content')}</label>
          <select class="crop-margins-select" value={scaleContent() ? 'scale' : 'keep'} onChange={(e) => setScaleContent(e.target.value === 'scale')}>
            <option value="scale">{t('resizePages.scaleToFit')}</option>
            <option value="keep">{t('resizePages.keepSize')}</option>
          </select>
        </div>
        <MarginFields
          t={t}
          name="odd"
          label={differentEven() ? t('resizePages.marginsOdd') : t('resizePages.margins')}
          value={margins()}
          onChange={setMargins}
        />
        <label class="resize-margins-check">
          <input type="checkbox" checked={differentEven()} onChange={(e) => toggleDifferentEven(e.target.checked)} />
          {t('resizePages.differentEven')}
        </label>
        <Show when={differentEven()}>
          <MarginFields
            t={t}
            name="even"
            label={t('resizePages.marginsEven')}
            value={evenMargins()}
            onChange={(value) => { evenEdited = true; setEvenMargins(value); }}
          />
        </Show>
        <Show when={marginError()}>
          <div class="resize-margins-error" role="alert">{marginError()}</div>
        </Show>
        <div class="crop-margins-info">
          {scaleContent() ? t('resizePages.infoScale', { count: totalPages }) : t('resizePages.info', { count: totalPages })}
          <Show when={marginSets()}>
            {' '}{scaleContent() ? t('resizePages.infoMarginsScale') : t('resizePages.infoMarginsKeep')}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
