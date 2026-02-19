import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { recordAddWatermark, recordModifyWatermark } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function generateId() {
  return 'wm-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function refresh() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

export default function WatermarkDialog(props) {
  const editWm = props.data?.editWm || null;
  const isEditing = !!editWm;
  const isImageEdit = editWm?.type === 'imageWatermark';

  // Active tab
  const [activeTab, setActiveTab] = createSignal(isImageEdit ? 'image' : 'text');

  // Text tab signals
  const [text, setText] = createSignal(editWm?.text || 'DRAFT');
  const [font, setFont] = createSignal(editWm?.fontFamily || 'Helvetica');
  const [fontSize, setFontSize] = createSignal(editWm?.fontSize || 72);
  const [color, setColor] = createSignal(editWm?.color || '#ff0000');
  const [opacity, setOpacity] = createSignal(
    isEditing && !isImageEdit ? Math.round((editWm.opacity || 0.3) * 100) : 30
  );
  const [rotation, setRotation] = createSignal(
    isEditing && !isImageEdit ? (editWm.rotation ?? -45) : -45
  );
  const [position, setPosition] = createSignal(editWm?.position || 'center');
  const [customX, setCustomX] = createSignal(editWm?.customX || 0);
  const [customY, setCustomY] = createSignal(editWm?.customY || 0);
  const [layer, setLayer] = createSignal(editWm?.layer || 'behind');
  const [pageRange, setPageRange] = createSignal(editWm?.pageRange || 'all');
  const [customPages, setCustomPages] = createSignal(editWm?.customPages || '');

  // Image tab signals
  const [imgOpacity, setImgOpacity] = createSignal(
    isImageEdit ? Math.round((editWm.opacity || 0.2) * 100) : 20
  );
  const [imgScale, setImgScale] = createSignal(
    isImageEdit ? Math.round((editWm.scale || 1) * 100) : 100
  );
  const [imgRotation, setImgRotation] = createSignal(
    isImageEdit ? (editWm.rotation ?? 0) : 0
  );
  const [imgPosition, setImgPosition] = createSignal(
    isImageEdit ? (editWm.position || 'center') : 'center'
  );
  const [imgCustomX, setImgCustomX] = createSignal(
    isImageEdit ? (editWm.customX || 0) : 0
  );
  const [imgCustomY, setImgCustomY] = createSignal(
    isImageEdit ? (editWm.customY || 0) : 0
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
      text: text() || 'DRAFT',
      fontFamily: font(),
      fontSize: parseInt(fontSize()) || 72,
      color: color(),
      opacity: parseInt(opacity()) / 100,
      rotation: parseInt(rotation()) || 0,
      position: position(),
      customX: parseInt(customX()) || 0,
      customY: parseInt(customY()) || 0,
      layer: layer(),
      pageRange: pageRange(),
      customPages: customPages(),
      enabled: true,
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
      customX: parseInt(imgCustomX()) || 0,
      customY: parseInt(imgCustomY()) || 0,
      layer: imgLayer(),
      pageRange: imgPageRange(),
      customPages: imgCustomPages(),
      scale: parseInt(imgScale()) / 100,
      enabled: true,
    };
  }

  function handleAdd() {
    const tab = activeTab();
    const wm = tab === 'image' ? buildImageWatermark() : buildTextWatermark();

    if (tab === 'image' && !wm.imageData) {
      alert('Please select an image first.');
      return;
    }

    if (isEditing) {
      const oldState = { ...editWm };
      const idx = state.watermarks.findIndex(w => w.id === editWm.id);
      if (idx !== -1) {
        Object.assign(state.watermarks[idx], wm);
        recordModifyWatermark(editWm.id, oldState, { ...state.watermarks[idx] });
      }
    } else {
      state.watermarks.push(wm);
      recordAddWatermark(wm);
    }

    markDocumentModified();
    refresh();
    close();
  }

  const footer = (
    <>
      <div class="watermark-footer-left"></div>
      <div class="watermark-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleAdd}>
          {isEditing ? 'Update' : 'Add'}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={isEditing ? 'Edit Watermark' : 'Add Watermark'}
      overlayClass="watermark-overlay"
      dialogClass="watermark-dialog"
      headerClass="watermark-header"
      bodyClass="watermark-content"
      footerClass="watermark-footer"
      onClose={close}
      footer={footer}
    >
      <div class="watermark-tabs">
        <button
          class="watermark-tab"
          classList={{ active: activeTab() === 'text' }}
          onClick={() => setActiveTab('text')}
        >Text</button>
        <button
          class="watermark-tab"
          classList={{ active: activeTab() === 'image' }}
          onClick={() => setActiveTab('image')}
        >Image</button>
      </div>

      {/* Text Tab */}
      <div
        class="watermark-tab-content"
        classList={{ active: activeTab() === 'text' }}
      >
        <div class="watermark-form">
          <div class="watermark-row">
            <label class="watermark-label">Text:</label>
            <input
              type="text"
              class="watermark-input"
              value={text()}
              placeholder="Watermark text"
              onInput={(e) => setText(e.target.value)}
            />
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Font:</label>
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
          <div class="watermark-row">
            <label class="watermark-label">Font Size:</label>
            <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={fontSize()}
              min="8"
              max="200"
              onInput={(e) => setFontSize(e.target.value)}
            />
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Color:</label>
            <input
              type="color"
              class="watermark-color"
              value={color()}
              onInput={(e) => setColor(e.target.value)}
            />
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Opacity:</label>
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
            <label class="watermark-label">Rotation:</label>
            <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={rotation()}
              min="-180"
              max="180"
              onInput={(e) => setRotation(e.target.value)}
            />&deg;
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Position:</label>
            <select
              class="watermark-select"
              value={position()}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="center">Center</option>
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <Show when={position() === 'custom'}>
            <div class="watermark-row wm-custom-pos">
              <label class="watermark-label">X / Y:</label>
              <input
                type="number"
                class="watermark-input watermark-input-sm"
                value={customX()}
                onInput={(e) => setCustomX(e.target.value)}
              />
              <input
                type="number"
                class="watermark-input watermark-input-sm"
                value={customY()}
                onInput={(e) => setCustomY(e.target.value)}
              />
            </div>
          </Show>
          <div class="watermark-row">
            <label class="watermark-label">Layer:</label>
            <select
              class="watermark-select"
              value={layer()}
              onChange={(e) => setLayer(e.target.value)}
            >
              <option value="behind">Behind content</option>
              <option value="infront">In front of content</option>
            </select>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Pages:</label>
            <select
              class="watermark-select"
              value={pageRange()}
              onChange={(e) => setPageRange(e.target.value)}
            >
              <option value="all">All pages</option>
              <option value="first">First page only</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <Show when={pageRange() === 'custom'}>
            <div class="watermark-row wm-custom-pages">
              <label class="watermark-label">Range:</label>
              <input
                type="text"
                class="watermark-input"
                value={customPages()}
                placeholder="e.g. 1-5, 8"
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
            <label class="watermark-label">Image:</label>
            <button class="pref-btn pref-btn-secondary" onClick={handleImagePick}>
              Choose Image...
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
            <label class="watermark-label">Opacity:</label>
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
            <label class="watermark-label">Scale:</label>
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
            <label class="watermark-label">Rotation:</label>
            <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={imgRotation()}
              min="-180"
              max="180"
              onInput={(e) => setImgRotation(e.target.value)}
            />&deg;
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Position:</label>
            <select
              class="watermark-select"
              value={imgPosition()}
              onChange={(e) => setImgPosition(e.target.value)}
            >
              <option value="center">Center</option>
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <Show when={imgPosition() === 'custom'}>
            <div class="watermark-row wm-img-custom-pos">
              <label class="watermark-label">X / Y:</label>
              <input
                type="number"
                class="watermark-input watermark-input-sm"
                value={imgCustomX()}
                onInput={(e) => setImgCustomX(e.target.value)}
              />
              <input
                type="number"
                class="watermark-input watermark-input-sm"
                value={imgCustomY()}
                onInput={(e) => setImgCustomY(e.target.value)}
              />
            </div>
          </Show>
          <div class="watermark-row">
            <label class="watermark-label">Layer:</label>
            <select
              class="watermark-select"
              value={imgLayer()}
              onChange={(e) => setImgLayer(e.target.value)}
            >
              <option value="behind">Behind content</option>
              <option value="infront">In front of content</option>
            </select>
          </div>
          <div class="watermark-row">
            <label class="watermark-label">Pages:</label>
            <select
              class="watermark-select"
              value={imgPageRange()}
              onChange={(e) => setImgPageRange(e.target.value)}
            >
              <option value="all">All pages</option>
              <option value="first">First page only</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <Show when={imgPageRange() === 'custom'}>
            <div class="watermark-row wm-img-custom-pages">
              <label class="watermark-label">Range:</label>
              <input
                type="text"
                class="watermark-input"
                value={imgCustomPages()}
                placeholder="e.g. 1-5, 8"
                onInput={(e) => setImgCustomPages(e.target.value)}
              />
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
