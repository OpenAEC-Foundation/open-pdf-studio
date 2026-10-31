import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { recordModifyWatermark } from '../../../core/undo-manager.js';
import { voegWatermerkToe } from '../../../watermark/watermerk-bewerken.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { batesInstellingen, batesNummer } from '../../../watermark/kopvoet-tekst.js';
import { kopVoetInWeergave, haalKopVoetUitWeergave } from '../../../watermark/kopvoet-weergave.js';

function generateId() {
  return 'wm-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function refresh() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

export default function HeaderFooterDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const editWm = props.data?.editWm || null;
  const isEditing = !!editWm;

  // Header text signals
  const [headerLeft, setHeaderLeft] = createSignal(editWm?.headerLeft || '');
  const [headerCenter, setHeaderCenter] = createSignal(
    isEditing ? (editWm.headerCenter || '') : '{page} of {pages}'
  );
  const [headerRight, setHeaderRight] = createSignal(editWm?.headerRight || '');

  // Footer text signals
  const [footerLeft, setFooterLeft] = createSignal(
    isEditing ? (editWm.footerLeft || '') : '{filename}'
  );
  const [footerCenter, setFooterCenter] = createSignal(editWm?.footerCenter || '');
  const [footerRight, setFooterRight] = createSignal(
    isEditing ? (editWm.footerRight || '') : '{date}'
  );

  // Font and style signals
  const [font, setFont] = createSignal(editWm?.fontFamily || 'Helvetica');
  const [fontSize, setFontSize] = createSignal(editWm?.fontSize || 10);
  const [color, setColor] = createSignal(editWm?.color || '#000000');

  // Margin signals
  const [marginTop, setMarginTop] = createSignal(editWm?.marginTop || 30);
  const [marginBottom, setMarginBottom] = createSignal(editWm?.marginBottom || 30);
  const [marginLeft, setMarginLeft] = createSignal(editWm?.marginLeft || 40);
  const [marginRight, setMarginRight] = createSignal(editWm?.marginRight || 40);

  // Bates-nummering: voorvoegsel + volgnummer met voorloopnullen + achtervoegsel ({bates}).
  const bates = batesInstellingen(editWm);
  const [batesPrefix, setBatesPrefix] = createSignal(bates.batesPrefix);
  const [batesStart, setBatesStart] = createSignal(bates.batesStart);
  const [batesDigits, setBatesDigits] = createSignal(bates.batesDigits);
  const [batesSuffix, setBatesSuffix] = createSignal(bates.batesSuffix);
  const batesVoorbeeld = () => batesNummer({
    batesPrefix: batesPrefix(), batesStart: batesStart(), batesDigits: batesDigits(), batesSuffix: batesSuffix(),
  }, 0);

  // Page range signals
  const [pageRange, setPageRange] = createSignal(editWm?.pageRange || 'all');
  const [customPages, setCustomPages] = createSignal(editWm?.customPages || '');

  // Track last focused header/footer input for variable insertion
  let lastFocusedInput = null;

  // Signal-setter map for header/footer inputs so variable insertion can update signal
  const inputSetterMap = {
    'headerLeft': setHeaderLeft,
    'headerCenter': setHeaderCenter,
    'headerRight': setHeaderRight,
    'footerLeft': setFooterLeft,
    'footerCenter': setFooterCenter,
    'footerRight': setFooterRight,
  };
  let lastFocusedKey = null;

  const close = () => closeDialog('header-footer');

  function handleFocus(key, e) {
    lastFocusedInput = e.target;
    lastFocusedKey = key;
  }

  function insertVariable(varText) {
    if (!lastFocusedInput || !lastFocusedKey) return;
    const setter = inputSetterMap[lastFocusedKey];
    if (!setter) return;

    const input = lastFocusedInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value;
    const newVal = val.substring(0, start) + varText + val.substring(end);
    setter(newVal);

    // Restore focus and cursor position after the value updates
    requestAnimationFrame(() => {
      input.focus();
      const newPos = start + varText.length;
      input.setSelectionRange(newPos, newPos);
    });
  }

  function buildHeaderFooter() {
    return {
      id: editWm ? editWm.id : generateId(),
      type: 'headerFooter',
      headerLeft: headerLeft(),
      headerCenter: headerCenter(),
      headerRight: headerRight(),
      footerLeft: footerLeft(),
      footerCenter: footerCenter(),
      footerRight: footerRight(),
      fontFamily: font(),
      fontSize: parseInt(fontSize()) || 10,
      color: color(),
      marginTop: parseInt(marginTop()) || 30,
      marginBottom: parseInt(marginBottom()) || 30,
      marginLeft: parseInt(marginLeft()) || 40,
      marginRight: parseInt(marginRight()) || 40,
      pageRange: pageRange(),
      customPages: customPages(),
      ...batesInstellingen({
        batesPrefix: batesPrefix(), batesStart: batesStart(), batesDigits: batesDigits(), batesSuffix: batesSuffix(),
      }),
      enabled: true,
      // Nog niet zo in het bestand: het scherm tekent hem (kopvoet-weergave.js).
      uitBestand: false,
    };
  }

  async function handleAdd() {
    const wm = buildHeaderFooter();

    const doc = getActiveDocument();
    // Staat de oude versie als pagina-inhoud in de weergave, dan eerst daaruit
    // halen; anders staat hij onder de nieuwe tot de volgende save.
    if (isEditing && kopVoetInWeergave(doc, editWm)) await haalKopVoetUitWeergave(doc);
    if (getActiveDocument() !== doc) return;
    if (isEditing) {
      const oldState = { ...editWm };
      const watermarks = doc?.watermarks;
      const idx = watermarks ? watermarks.findIndex(w => w.id === editWm.id) : -1;
      if (idx !== -1) {
        Object.assign(watermarks[idx], wm);
        recordModifyWatermark(editWm.id, oldState, { ...watermarks[idx] });
      }
      markDocumentModified();
      refresh();
    } else if (doc) {
      // Zelfde stap als app_watermarks: undo, gewijzigd, opnieuw tekenen.
      await voegWatermerkToe(doc, wm);
    }
    close();
  }

  const footer = (
    <>
      <div class="watermark-footer-left"></div>
      <div class="watermark-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleAdd}>
          {isEditing ? tCommon('update') : tCommon('add')}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={isEditing ? t('headerFooter.editTitle') : t('headerFooter.addTitle')}
      overlayClass="header-footer-overlay"
      dialogClass="header-footer-dialog"
      headerClass="header-footer-header"
      bodyClass="header-footer-content"
      footerClass="watermark-footer"
      onClose={close}
      footer={footer}
    >
      <div class="watermark-form">
        <div class="hf-section-label">{t('headerFooter.header')}</div>
        <div class="hf-row-triple">
          <div class="hf-field">
            <label>{t('headerFooter.left')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.leftHeader')}
              value={headerLeft()}
              onInput={(e) => setHeaderLeft(e.target.value)}
              onFocus={(e) => handleFocus('headerLeft', e)}
            />
          </div>
          <div class="hf-field">
            <label>{t('headerFooter.center')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.centerHeader')}
              value={headerCenter()}
              onInput={(e) => setHeaderCenter(e.target.value)}
              onFocus={(e) => handleFocus('headerCenter', e)}
            />
          </div>
          <div class="hf-field">
            <label>{t('headerFooter.right')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.rightHeader')}
              value={headerRight()}
              onInput={(e) => setHeaderRight(e.target.value)}
              onFocus={(e) => handleFocus('headerRight', e)}
            />
          </div>
        </div>

        <div class="hf-section-label">{t('headerFooter.footer')}</div>
        <div class="hf-row-triple">
          <div class="hf-field">
            <label>{t('headerFooter.left')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.leftFooter')}
              value={footerLeft()}
              onInput={(e) => setFooterLeft(e.target.value)}
              onFocus={(e) => handleFocus('footerLeft', e)}
            />
          </div>
          <div class="hf-field">
            <label>{t('headerFooter.center')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.centerFooter')}
              value={footerCenter()}
              onInput={(e) => setFooterCenter(e.target.value)}
              onFocus={(e) => handleFocus('footerCenter', e)}
            />
          </div>
          <div class="hf-field">
            <label>{t('headerFooter.right')}</label>
            <input
              type="text"
              class="hf-input"
              placeholder={t('headerFooter.rightFooter')}
              value={footerRight()}
              onInput={(e) => setFooterRight(e.target.value)}
              onFocus={(e) => handleFocus('footerRight', e)}
            />
          </div>
        </div>

        <div class="hf-variables">
          <label>{t('headerFooter.insertVariable')}</label>
          <button class="hf-var-btn" onClick={() => insertVariable('{page}')}>{'{page}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{pages}')}>{'{pages}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{date}')}>{'{date}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{time}')}>{'{time}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{filename}')}>{'{filename}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{title}')}>{'{title}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{bates}')}>{'{bates}'}</button>
        </div>

        <div class="hf-margins hf-bates">
          <label class="watermark-label" title={t('headerFooter.batesHint')}>{t('headerFooter.bates')}</label>
          <div class="hf-margin-fields">
            <label>{t('headerFooter.batesPrefix')} <input
              type="text"
              class="watermark-input watermark-input-sm"
              value={batesPrefix()}
              onInput={(e) => setBatesPrefix(e.target.value)}
            /></label>
            <label>{t('headerFooter.batesStart')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={batesStart()}
              min="0"
              onInput={(e) => setBatesStart(e.target.value)}
            /></label>
            <label>{t('headerFooter.batesDigits')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={batesDigits()}
              min="1"
              max="12"
              onInput={(e) => setBatesDigits(e.target.value)}
            /></label>
            <label>{t('headerFooter.batesSuffix')} <input
              type="text"
              class="watermark-input watermark-input-sm"
              value={batesSuffix()}
              onInput={(e) => setBatesSuffix(e.target.value)}
            /></label>
            <span class="hf-bates-example">{batesVoorbeeld()}</span>
          </div>
        </div>

        <div class="watermark-row">
          <label class="watermark-label">{t('headerFooter.font')}</label>
          <select
            class="watermark-select"
            value={font()}
            onChange={(e) => setFont(e.target.value)}
          >
            <option value="Helvetica">Helvetica</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier">Courier</option>
          </select>
        </div>
        <div class="watermark-row">
          <label class="watermark-label">{t('headerFooter.fontSize')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="watermark-input watermark-input-sm"
            value={fontSize()}
            min="6"
            max="36"
            onInput={(e) => setFontSize(e.target.value)}
          />
        </div>
        <div class="watermark-row">
          <label class="watermark-label">{t('headerFooter.color')}</label>
          <input
            type="color"
            class="watermark-color"
            value={color()}
            onInput={(e) => setColor(e.target.value)}
          />
        </div>

        <div class="hf-margins">
          <label class="watermark-label">{t('headerFooter.margins')}</label>
          <div class="hf-margin-fields">
            <label>{t('headerFooter.top')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={marginTop()}
              min="0"
              onInput={(e) => setMarginTop(e.target.value)}
            /></label>
            <label>{t('headerFooter.bottom')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={marginBottom()}
              min="0"
              onInput={(e) => setMarginBottom(e.target.value)}
            /></label>
            <label>{t('headerFooter.left')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={marginLeft()}
              min="0"
              onInput={(e) => setMarginLeft(e.target.value)}
            /></label>
            <label>{t('headerFooter.right')} <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={marginRight()}
              min="0"
              onInput={(e) => setMarginRight(e.target.value)}
            /></label>
          </div>
        </div>

        <div class="watermark-row">
          <label class="watermark-label">{t('headerFooter.pagesLabel')}</label>
          <select
            class="watermark-select"
            value={pageRange()}
            onChange={(e) => setPageRange(e.target.value)}
          >
            <option value="all">{t('headerFooter.allPages')}</option>
            <option value="first">{t('headerFooter.firstPageOnly')}</option>
            <option value="custom">{tCommon('custom')}</option>
          </select>
        </div>
        <Show when={pageRange() === 'custom'}>
          <div class="watermark-row hf-custom-pages">
            <label class="watermark-label">{t('headerFooter.range')}</label>
            <input
              type="text"
              class="watermark-input"
              value={customPages()}
              placeholder={t('headerFooter.rangePlaceholder')}
              onInput={(e) => setCustomPages(e.target.value)}
            />
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
