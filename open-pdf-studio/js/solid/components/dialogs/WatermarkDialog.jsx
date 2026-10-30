import { createSignal, createMemo, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import WatermarkPreview from './WatermarkPreview.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { recordAddWatermark, recordModifyWatermark } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { kopVoetInWeergave, haalKopVoetUitWeergave } from '../../../watermark/kopvoet-weergave.js';
import {
  clampWatermarkFontSize, stepWatermarkFontSize, watermarkFontSizeFromField, watermarkAutoFitSize,
  WATERMARK_FONT_MIN, WATERMARK_FONT_MAX,
  parseCustomCoordinate, watermarkCustomPosition,
} from '../../../watermark/watermark-layout.js';
import { paginaMaat } from '../../../pdf/weergave-ruimte.js';
import {
  readWatermarkHistory, lastWatermarkText, rememberWatermarkText, forgetWatermarkText,
  watermarkSuggestions, moveSuggestionIndex,
} from '../../../watermark/watermark-text-history.js';

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

export default function WatermarkDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const previewDoc = getActiveDocument();
  const [previewPage, setPreviewPage] = createSignal(previewDoc?.currentPage || 1);
  const [previewSize, setPreviewSize] = createSignal(null);
  const editWm = props.data?.editWm || null;
  const isEditing = !!editWm;
  const isImageEdit = editWm?.type === 'imageWatermark';

  // Active tab
  const [activeTab, setActiveTab] = createSignal(isImageEdit ? 'image' : 'text');

  // Text tab signals
  // A new watermark starts with the last used text (#850).
  const [text, setText] = createSignal(editWm?.text || lastWatermarkText() || t('watermark.defaultText'));
  const [font, setFont] = createSignal(editWm?.fontFamily || 'Helvetica');
  // The manual size stays as it is while auto-fit is on, so turning auto-fit
  // off brings it back (#849).
  // A stored size outside 4-288 pt stays as it is until the field is edited.
  const [fontSize, setFontSize] = createSignal(editWm?.fontSize || 72);
  const [fontSizeEdited, setFontSizeEdited] = createSignal(false);
  const [autoFit, setAutoFit] = createSignal(!isImageEdit && !!editWm?.autoFit);
  const [color, setColor] = createSignal(editWm?.color || '#ff0000');
  const [opacity, setOpacity] = createSignal(
    isEditing && !isImageEdit ? Math.round((editWm.opacity ?? 0.3) * 100) : 30
  );
  const [rotation, setRotation] = createSignal(
    isEditing && !isImageEdit ? (editWm.rotation ?? -45) : -45
  );
  const [position, setPosition] = createSignal(editWm?.position || 'center');
  // Blank Custom X/Y means "not set" (the page centre); 0 is a real position.
  const [customX, setCustomX] = createSignal(editWm?.customX ?? '');
  const [customY, setCustomY] = createSignal(editWm?.customY ?? '');
  const [layer, setLayer] = createSignal(editWm?.layer || 'behind');
  const [pageRange, setPageRange] = createSignal(editWm?.pageRange || 'all');
  const [customPages, setCustomPages] = createSignal(editWm?.customPages || '');

  // Earlier texts offered while typing (#850).
  const [history, setHistory] = createSignal(readWatermarkHistory());
  const [suggestOpen, setSuggestOpen] = createSignal(false);
  const [activeSuggestion, setActiveSuggestion] = createSignal(-1);
  const suggestions = createMemo(() => watermarkSuggestions(history(), text()));
  const suggestVisible = () => suggestOpen() && suggestions().length > 0;

  function closeSuggestions() {
    setSuggestOpen(false);
    setActiveSuggestion(-1);
  }

  function chooseSuggestion(entry) {
    setText(entry);
    closeSuggestions();
  }

  function removeSuggestion(entry) {
    setHistory(forgetWatermarkText(entry));
    setActiveSuggestion((i) => Math.min(i, suggestions().length - 1));
  }

  // A native listener on the field runs before the document listener of the
  // dialog, so an Escape that closes the list does not close the dialog too.
  function onTextKeyDown(e) {
    const count = suggestions().length;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!count) return;
      handled();
      const from = suggestVisible() ? activeSuggestion() : -1;
      setSuggestOpen(true);
      setActiveSuggestion(moveSuggestionIndex(from, count, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && suggestVisible() && activeSuggestion() >= 0) {
      handled();
      chooseSuggestion(suggestions()[activeSuggestion()]);
    } else if (e.key === 'Escape' && suggestVisible()) {
      handled();
      e.__dialoogGesloten = true;
      closeSuggestions();
    } else if (e.key === 'Delete' && e.shiftKey && suggestVisible() && activeSuggestion() >= 0) {
      handled();
      removeSuggestion(suggestions()[activeSuggestion()]);
    }
  }

  // Auto-fit is worked out per page when drawing and saving; the field shows
  // the size on the current page.
  const autoFitSize = createMemo(() => {
    const doc = getActiveDocument();
    const maat = previewSize() || (doc ? paginaMaat(previewPage(), doc) : null);
    if (!maat) return null;
    const size = watermarkAutoFitSize(
      { text: text() || t('watermark.defaultText'), fontFamily: font(), rotation: parseInt(rotation()) || 0 },
      maat.breedte, maat.hoogte,
    );
    return Math.round(size * 10) / 10;
  });

  const stepFontSize = (direction) => {
    setFontSizeEdited(true);
    setFontSize(String(stepWatermarkFontSize(fontSize(), direction)));
  };

  // Image tab signals
  const [imgOpacity, setImgOpacity] = createSignal(
    isImageEdit ? Math.round((editWm.opacity ?? 0.2) * 100) : 20
  );
  const [imgScale, setImgScale] = createSignal(
    isImageEdit ? Math.round((editWm.scale ?? 1) * 100) : 100
  );
  const [imgRotation, setImgRotation] = createSignal(
    isImageEdit ? (editWm.rotation ?? 0) : 0
  );
  const [imgPosition, setImgPosition] = createSignal(
    isImageEdit ? (editWm.position || 'center') : 'center'
  );
  const [imgCustomX, setImgCustomX] = createSignal(
    isImageEdit ? (editWm.customX ?? '') : ''
  );
  const [imgCustomY, setImgCustomY] = createSignal(
    isImageEdit ? (editWm.customY ?? '') : ''
  );
  const [imgLayer, setImgLayer] = createSignal(
    isImageEdit ? (editWm.layer || 'behind') : 'behind'
  );
  const [imgPageRange, setImgPageRange] = createSignal(
    isImageEdit ? (editWm.pageRange || 'all') : 'all'
  );
  const [imgCustomPages, setImgCustomPages] = createSignal(
    isImageEdit ? (editWm.customPages || '') : ''
  );
  const [imageData, setImageData] = createSignal(
    isImageEdit ? (editWm.imageData || '') : ''
  );
  const [showImgPreview, setShowImgPreview] = createSignal(
    isImageEdit && !!editWm.imageData
  );

  let fileInputRef;

  const close = () => closeDialog('watermark');

  function handleImagePick() {
    fileInputRef?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageData(ev.target.result);
      setShowImgPreview(true);
    };
    reader.readAsDataURL(file);
  }

  function buildTextWatermark() {
    return {
      id: editWm ? editWm.id : generateId(),
      type: 'textWatermark',
      text: text() || t('watermark.defaultText'),
      fontFamily: font(),
      fontSize: watermarkFontSizeFromField(fontSize(), { edited: fontSizeEdited(), stored: editWm?.fontSize }),
      autoFit: autoFit(),
      color: color(),
      opacity: parseInt(opacity()) / 100,
      rotation: parseInt(rotation()) || 0,
      position: position(),
      customX: parseCustomCoordinate(customX()),
      customY: parseCustomCoordinate(customY()),
      layer: layer(),
      pageRange: pageRange(),
      customPages: customPages(),
      enabled: true,
      uitBestand: false,
    };
  }

  function buildImageWatermark() {
    return {
      id: editWm ? editWm.id : generateId(),
      type: 'imageWatermark',
      imageData: imageData() || (editWm ? editWm.imageData : ''),
      width: 200,
      height: 200,
      opacity: parseInt(imgOpacity()) / 100,
      rotation: parseInt(imgRotation()) || 0,
      position: imgPosition(),
      customX: parseCustomCoordinate(imgCustomX()),
      customY: parseCustomCoordinate(imgCustomY()),
      layer: imgLayer(),
      pageRange: imgPageRange(),
      customPages: imgCustomPages(),
      scale: parseInt(imgScale()) / 100,
      enabled: true,
      uitBestand: false,
    };
  }

  // Switching to Custom starts X/Y at the position the watermark has now on
  // the current page, so it stays where it is.
  function prefillCustom(wm, setX, setY) {
    const doc = getActiveDocument();
    const maat = previewSize() || (doc ? paginaMaat(previewPage(), doc) : null);
    if (!maat) return;
    const { x, y } = watermarkCustomPosition(wm, maat.breedte, maat.hoogte);
    setX(String(x));
    setY(String(y));
  }

  function changePosition(value) {
    if (value === 'custom' && position() !== 'custom') prefillCustom(buildTextWatermark(), setCustomX, setCustomY);
    setPosition(value);
  }

  function changeImagePosition(value) {
    if (value === 'custom' && imgPosition() !== 'custom') prefillCustom(buildImageWatermark(), setImgCustomX, setImgCustomY);
    setImgPosition(value);
  }

  const previewWatermark = createMemo(() => activeTab() === 'image' ? buildImageWatermark() : buildTextWatermark());

  async function handleAdd() {
    if (getActiveDocument() !== previewDoc) return;
    const tab = activeTab();
    const wm = tab === 'image' ? buildImageWatermark() : buildTextWatermark();

    if (tab === 'image' && !wm.imageData) {
      showMessage(t('watermark.selectImageFirst'));
      return;
    }

    const doc = getActiveDocument();
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
    } else {
      if (doc) doc.watermarks.push(wm);
      recordAddWatermark(wm);
    }

    if (wm.type === 'textWatermark') rememberWatermarkText(wm.text);

    markDocumentModified();
    refresh();
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
      title={isEditing ? t('watermark.editTitle') : t('watermark.addTitle')}
      modal={false}
      overlayClass="watermark-overlay"
      dialogClass="watermark-dialog"
      headerClass="watermark-header"
      bodyClass="watermark-content"
      footerClass="watermark-footer"
      onClose={close}
      footer={footer}
    >
      <div class="watermark-editor">
      <div class="watermark-tabs">
        <button
          class="watermark-tab"
          classList={{ active: activeTab() === 'text' }}
          onClick={() => setActiveTab('text')}
        >{t('watermark.text')}</button>
        <button
          class="watermark-tab"
          classList={{ active: activeTab() === 'image' }}
          onClick={() => setActiveTab('image')}
        >{t('watermark.image')}</button>
      </div>

      {/* Text Tab */}
      <div
        class="watermark-tab-content"
        classList={{ active: activeTab() === 'text' }}
      >
        <div class="watermark-form">
          <div class="watermark-row">
            <label class="watermark-label" for="watermark-text-input">{t('watermark.textLabel')}</label>
            <div class="watermark-combo">
              <input
                id="watermark-text-input"
                type="text"
                class="watermark-input"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="watermark-text-suggestions"
                aria-expanded={suggestVisible() ? 'true' : 'false'}
                aria-activedescendant={suggestVisible() && activeSuggestion() >= 0 ? `watermark-text-suggestion-${activeSuggestion()}` : undefined}
                value={text()}
                placeholder={t('watermark.watermarkText')}
                onInput={(e) => { setText(e.target.value); setActiveSuggestion(-1); setSuggestOpen(true); }}
                on:keydown={onTextKeyDown}
                onBlur={closeSuggestions}
              />
              <Show when={suggestVisible()}>
                <ul id="watermark-text-suggestions" class="watermark-suggest" role="listbox" aria-label={t('watermark.textHistory')}>
                  <For each={suggestions()}>
                    {(entry, i) => (
                      <li
                        id={`watermark-text-suggestion-${i()}`}
                        class="watermark-suggest-item"
                        classList={{ active: i() === activeSuggestion() }}
                        role="option"
                        aria-selected={i() === activeSuggestion() ? 'true' : 'false'}
                        onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(entry); }}
                        onMouseEnter={() => setActiveSuggestion(i())}
                      >
                        <span class="watermark-suggest-text">{entry}</span>
                        <button
                          type="button"
                          class="watermark-suggest-remove"
                          tabIndex={-1}
                          title={t('watermark.removeFromHistory')}
                          aria-label={t('watermark.removeFromHistory')}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeSuggestion(entry); }}
                        >&times;</button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.font')}</label>
            <select
              class="watermark-select"
              value={font()}
              onChange={(e) => setFont(e.target.value)}
            >
              <option value="Helvetica">Helvetica</option>
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier">Courier</option>
              <option value="Georgia">Georgia</option>
            </select>
          </div>
          <div class="watermark-row watermark-row-wrap">
            <label class="watermark-label">{t('watermark.fontSize')}</label>
            <div class="watermark-spin" classList={{ disabled: autoFit() }}>
              <input
                type="text" inputmode="decimal" data-getal
                class="watermark-spin-input"
                aria-label={t('watermark.fontSize')}
                value={autoFit() ? (autoFitSize() ?? '') : fontSize()}
                min={WATERMARK_FONT_MIN}
                max={WATERMARK_FONT_MAX}
                step="1"
                disabled={autoFit()}
                onInput={(e) => { setFontSizeEdited(true); setFontSize(e.target.value); }}
                onChange={(e) => setFontSize(String(clampWatermarkFontSize(e.target.value)))}
              />
              <div class="watermark-spin-buttons">
                <button
                  type="button" class="watermark-spin-btn" tabIndex={-1}
                  title={t('watermark.increaseFontSize')} aria-label={t('watermark.increaseFontSize')}
                  disabled={autoFit()} onClick={() => stepFontSize(1)}
                ><svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true"><path d="M0 4L3.5 0L7 4Z" fill="currentColor" /></svg></button>
                <button
                  type="button" class="watermark-spin-btn" tabIndex={-1}
                  title={t('watermark.decreaseFontSize')} aria-label={t('watermark.decreaseFontSize')}
                  disabled={autoFit()} onClick={() => stepFontSize(-1)}
                ><svg width="7" height="4" viewBox="0 0 7 4" aria-hidden="true"><path d="M0 0L7 0L3.5 4Z" fill="currentColor" /></svg></button>
              </div>
            </div>
            <span class="watermark-unit">pt</span>
            <label class="watermark-check" title={t('watermark.autoFitHint')}>
              <input
                type="checkbox"
                checked={autoFit()}
                onChange={(e) => setAutoFit(e.target.checked)}
              />
              {t('watermark.autoFit')}
            </label>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.color')}</label>
            <input
              type="color"
              class="watermark-color"
              value={color()}
              onInput={(e) => setColor(e.target.value)}
            />
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.opacity')}</label>
            <input
              type="range"
              class="watermark-slider"
              min="0"
              max="100"
              value={opacity()}
              onInput={(e) => setOpacity(e.target.value)}
            />
            <span class="watermark-slider-val">{opacity()}%</span>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.rotation')}</label>
            <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={rotation()}
              min="-180"
              max="180"
              onInput={(e) => setRotation(e.target.value)}
            />&deg;
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.position')}</label>
            <select
              class="watermark-select"
              value={position()}
              onChange={(e) => changePosition(e.target.value)}
            >
              <option value="center">{t('watermark.center')}</option>
              <option value="top-left">{t('watermark.topLeft')}</option>
              <option value="top-right">{t('watermark.topRight')}</option>
              <option value="bottom-left">{t('watermark.bottomLeft')}</option>
              <option value="bottom-right">{t('watermark.bottomRight')}</option>
              <option value="custom">{tCommon('custom')}</option>
            </select>
          </div>
          <Show when={position() === 'custom'}>
            <div class="watermark-row wm-custom-pos">
              <label class="watermark-label">{t('watermark.xyLabel')}</label>
              <input
                type="text" inputmode="decimal" data-getal
                class="watermark-input watermark-input-sm"
                value={customX()}
                onInput={(e) => setCustomX(e.target.value)}
              />
              <input
                type="text" inputmode="decimal" data-getal
                class="watermark-input watermark-input-sm"
                value={customY()}
                onInput={(e) => setCustomY(e.target.value)}
              />
            </div>
          </Show>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.layer')}</label>
            <select
              class="watermark-select"
              value={layer()}
              onChange={(e) => setLayer(e.target.value)}
            >
              <option value="behind">{t('watermark.behindContent')}</option>
              <option value="infront">{t('watermark.inFrontOfContent')}</option>
            </select>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.pagesLabel')}</label>
            <select
              class="watermark-select"
              value={pageRange()}
              onChange={(e) => setPageRange(e.target.value)}
            >
              <option value="all">{t('watermark.allPages')}</option>
              <option value="first">{t('watermark.firstPageOnly')}</option>
              <option value="custom">{tCommon('custom')}</option>
            </select>
          </div>
          <Show when={pageRange() === 'custom'}>
            <div class="watermark-row wm-custom-pages">
              <label class="watermark-label">{t('watermark.range')}</label>
              <input
                type="text"
                class="watermark-input"
                value={customPages()}
                placeholder={t('watermark.rangePlaceholder')}
                onInput={(e) => setCustomPages(e.target.value)}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* Image Tab */}
      <div
        class="watermark-tab-content"
        classList={{ active: activeTab() === 'image' }}
      >
        <div class="watermark-form">
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.image')}</label>
            <button class="pref-btn pref-btn-secondary" onClick={handleImagePick}>
              {t('watermark.chooseImage')}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style="display:none"
              onChange={handleFileChange}
            />
          </div>
          <Show when={showImgPreview()}>
            <div class="watermark-row">
              <label class="watermark-label"></label>
              <img class="watermark-img-preview" src={imageData()} />
            </div>
          </Show>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.opacity')}</label>
            <input
              type="range"
              class="watermark-slider"
              min="0"
              max="100"
              value={imgOpacity()}
              onInput={(e) => setImgOpacity(e.target.value)}
            />
            <span class="watermark-slider-val">{imgOpacity()}%</span>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.scale')}</label>
            <input
              type="range"
              class="watermark-slider"
              min="10"
              max="300"
              value={imgScale()}
              onInput={(e) => setImgScale(e.target.value)}
            />
            <span class="watermark-slider-val">{imgScale()}%</span>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.rotation')}</label>
            <input
              type="text" inputmode="decimal" data-getal
              class="watermark-input watermark-input-sm"
              value={imgRotation()}
              min="-180"
              max="180"
              onInput={(e) => setImgRotation(e.target.value)}
            />&deg;
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.position')}</label>
            <select
              class="watermark-select"
              value={imgPosition()}
              onChange={(e) => changeImagePosition(e.target.value)}
            >
              <option value="center">{t('watermark.center')}</option>
              <option value="top-left">{t('watermark.topLeft')}</option>
              <option value="top-right">{t('watermark.topRight')}</option>
              <option value="bottom-left">{t('watermark.bottomLeft')}</option>
              <option value="bottom-right">{t('watermark.bottomRight')}</option>
              <option value="custom">{tCommon('custom')}</option>
            </select>
          </div>
          <Show when={imgPosition() === 'custom'}>
            <div class="watermark-row wm-img-custom-pos">
              <label class="watermark-label">{t('watermark.xyLabel')}</label>
              <input
                type="text" inputmode="decimal" data-getal
                class="watermark-input watermark-input-sm"
                value={imgCustomX()}
                onInput={(e) => setImgCustomX(e.target.value)}
              />
              <input
                type="text" inputmode="decimal" data-getal
                class="watermark-input watermark-input-sm"
                value={imgCustomY()}
                onInput={(e) => setImgCustomY(e.target.value)}
              />
            </div>
          </Show>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.layer')}</label>
            <select
              class="watermark-select"
              value={imgLayer()}
              onChange={(e) => setImgLayer(e.target.value)}
            >
              <option value="behind">{t('watermark.behindContent')}</option>
              <option value="infront">{t('watermark.inFrontOfContent')}</option>
            </select>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">{t('watermark.pagesLabel')}</label>
            <select
              class="watermark-select"
              value={imgPageRange()}
              onChange={(e) => setImgPageRange(e.target.value)}
            >
              <option value="all">{t('watermark.allPages')}</option>
              <option value="first">{t('watermark.firstPageOnly')}</option>
              <option value="custom">{tCommon('custom')}</option>
            </select>
          </div>
          <Show when={imgPageRange() === 'custom'}>
            <div class="watermark-row wm-img-custom-pages">
              <label class="watermark-label">{t('watermark.range')}</label>
              <input
                type="text"
                class="watermark-input"
                value={imgCustomPages()}
                placeholder={t('watermark.rangePlaceholder')}
                onInput={(e) => setImgCustomPages(e.target.value)}
              />
            </div>
          </Show>
        </div>
      </div>
      </div>
      <WatermarkPreview doc={previewDoc} editWm={editWm} watermark={previewWatermark()}
        onPage={n => { setPreviewPage(n); setPreviewSize(null); }} onSize={setPreviewSize} onInvalid={close} onPosition={(x,y) => {
          if (activeTab() === 'image') { setImgPosition('custom'); setImgCustomX(String(x)); setImgCustomY(String(y)); }
          else { setPosition('custom'); setCustomX(String(x)); setCustomY(String(y)); }
        }} />
    </Dialog>
  );
}
