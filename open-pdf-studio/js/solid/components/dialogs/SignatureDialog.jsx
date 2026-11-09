import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { state, getActiveDocument, imageCache } from '../../../core/state.js';
import { createAnnotation } from '../../../annotations/factory.js';
import { recordAdd } from '../../../core/undo-manager.js';
import { showProperties } from '../../../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';
import { generateImageId } from '../../../utils/helpers.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { createSignaturePad } from '../../../annotations/signature-pad.js';
import { leesOpslagJson, schrijfOpslagJson } from '../../../core/opslag.js';
import { plaatsingsPagina } from '../../../annotations/plaatsingspagina.js';

const STORAGE_KEY = 'pdfEditorSignatures';
const MAX_SAVED = 5;
const CANVAS_WIDTH = 430;
const CANVAS_HEIGHT = 150;
const MAX_PLACE_WIDTH = 200;

function getSavedSignatures() {
  try {
    const saved = leesOpslagJson(STORAGE_KEY, []);
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveSignatureToStorage(dataUrl) {
  const signatures = getSavedSignatures();
  signatures.push({ dataUrl, createdAt: new Date().toISOString() });
  while (signatures.length > MAX_SAVED) signatures.shift();
  schrijfOpslagJson(STORAGE_KEY, signatures);
}

function deleteSavedSignature(index) {
  const signatures = getSavedSignatures();
  signatures.splice(index, 1);
  schrijfOpslagJson(STORAGE_KEY, signatures);
}

function getCroppedDataUrl(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return canvas.toDataURL('image/png');

  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  return cropCanvas.toDataURL('image/png');
}

// `page`: de pagina waarop het handtekeninggereedschap geklikt is (#1006);
// zonder klik de huidige pagina.
async function placeSignatureFromDataUrl(dataUrl, x, y, color, t, page) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve) => { img.onload = resolve; });

  const imageId = generateImageId();
  imageCache.set(imageId, img);

  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (width > MAX_PLACE_WIDTH) {
    const ratio = MAX_PLACE_WIDTH / width;
    width *= ratio;
    height *= ratio;
  }

  const ann = createAnnotation({
    type: 'signature',
    page: plaatsingsPagina(page, getActiveDocument()),
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    imageId: imageId,
    imageData: dataUrl,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    color: color,
    opacity: 1,
    rotation: 0,
    locked: false
  });

  const doc = getActiveDocument();
  if (doc) doc.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    const _sigDoc = getActiveDocument();
    if (_sigDoc) { _sigDoc.selectedAnnotation = ann; _sigDoc.selectedAnnotations = [ann]; }
    showProperties(ann);
  }

  if (doc?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(t('signature.signaturePlaced'));
}

export default function SignatureDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const placeX = props.data?.x || 0;
  const placeY = props.data?.y || 0;
  // De aangeklikte pagina (#1006): in de weergave met twee pagina's is de
  // huidige pagina de linker, ook na een klik op de rechter.
  const placePage = props.data?.page;

  const [activeTab, setActiveTab] = createSignal('draw');
  const [strokeColor, setStrokeColor] = createSignal('#000000');
  const [savedSigs, setSavedSigs] = createSignal(getSavedSignatures());

  // The Draw tab builds a new canvas each time it is shown again; the pad
  // follows whichever canvas is on screen (see signature-pad.js, #492).
  const pad = createSignaturePad();

  const close = () => closeDialog('signature');

  function refreshSaved() {
    setSavedSigs(getSavedSignatures());
  }

  function padPoint(e) {
    const rect = pad.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // Pointer events, so a finger or pen draws as well as the mouse (#671). The
  // capture keeps the stroke going when the pointer leaves the pad.
  function startDraw(e) {
    if (!pad.canvas) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = padPoint(e);
    pad.begin(x, y, strokeColor());
  }

  function continueDraw(e) {
    if (!pad.canvas) return;
    const [x, y] = padPoint(e);
    pad.extend(x, y);
  }

  function endDraw() {
    pad.end();
  }

  function handlePlace() {
    if (!pad.hasInk()) {
      showMessage(t('signature.drawFirst'));
      return;
    }
    const dataUrl = getCroppedDataUrl(pad.canvas);
    placeSignatureFromDataUrl(dataUrl, placeX, placeY, strokeColor(), t, placePage);
    close();
  }

  function handleSaveAndPlace() {
    if (!pad.hasInk()) {
      showMessage(t('signature.drawFirst'));
      return;
    }
    const dataUrl = getCroppedDataUrl(pad.canvas);
    saveSignatureToStorage(dataUrl);
    placeSignatureFromDataUrl(dataUrl, placeX, placeY, strokeColor(), t, placePage);
    close();
  }

  function handleSavedClick(sig) {
    placeSignatureFromDataUrl(sig.dataUrl, placeX, placeY, '#000000', t, placePage);
    close();
  }

  function handleDeleteSaved(e, index) {
    e.stopPropagation();
    deleteSavedSignature(index);
    refreshSaved();
  }

  function onKeyDown(e) {
    // Ook met Caps Lock aan (e.key is dan 'Z', #577).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key || '').toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      pad.undo();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown, true);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown, true);
  });

  function switchToDrawTab() {
    setActiveTab('draw');
  }

  function switchToSavedTab() {
    setActiveTab('saved');
    refreshSaved();
  }

  const footer = (
    <div class="sig-footer-inner">
      <div class="sig-footer-left">
        <label class="sig-color-label">Color:</label>
        <input
          type="color"
          class="sig-color-input"
          value={strokeColor()}
          onInput={(e) => setStrokeColor(e.target.value)}
        />
      </div>
      <div class="sig-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={() => pad.clear()}>{tCommon('clear')}</button>
        <button
          class="pref-btn pref-btn-secondary"
          style="color:#0078d4; border-color:#0078d4;"
          onClick={handlePlace}
        >{tCommon('place')}</button>
        <button class="pref-btn pref-btn-primary" onClick={handleSaveAndPlace}>{t('signature.saveAndPlace')}</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('signature.title')}
      overlayClass="sig-overlay"
      dialogClass="sig-dialog"
      headerClass="sig-header"
      bodyClass="sig-content"
      footerClass="sig-footer"
      onClose={close}
      footer={footer}
    >
      <div class="sig-tabs">
        <button
          class={`sig-tab${activeTab() === 'draw' ? ' active' : ''}`}
          onClick={switchToDrawTab}
        >{t('signature.drawTab')}</button>
        <button
          class={`sig-tab${activeTab() === 'saved' ? ' active' : ''}`}
          onClick={switchToSavedTab}
        >{t('signature.savedTab')}</button>
      </div>

      <Show when={activeTab() === 'draw'}>
        <div class="sig-draw-panel">
          <canvas
            ref={(el) => pad.attach(el)}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ 'touch-action': 'none' }}
            onPointerDown={startDraw}
            onPointerMove={continueDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </Show>

      <Show when={activeTab() === 'saved'}>
        <div class="sig-saved-panel">
          <Show when={savedSigs().length === 0}>
            <div class="sig-saved-empty">{t('signature.noSavedSignatures')}</div>
          </Show>
          <Show when={savedSigs().length > 0}>
            <div class="sig-saved-grid">
              <For each={savedSigs()}>
                {(sig, index) => (
                  <div class="sig-saved-item" onClick={() => handleSavedClick(sig)}>
                    <img src={sig.dataUrl} />
                    <button
                      class="sig-saved-del"
                      onClick={(e) => handleDeleteSaved(e, index())}
                    >{'\u00D7'}</button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
  );
}
