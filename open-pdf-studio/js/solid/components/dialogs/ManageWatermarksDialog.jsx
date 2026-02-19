import { For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { recordRemoveWatermark, recordModifyWatermark } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function refresh() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

function getWmDescription(wm) {
  switch (wm.type) {
    case 'textWatermark':
      return `"${wm.text}" - ${wm.fontSize}px, ${wm.rotation}\u00B0`;
    case 'imageWatermark':
      return `Image - ${Math.round((wm.scale || 1) * 100)}% scale`;
    case 'headerFooter': {
      const parts = [];
      if (wm.headerLeft || wm.headerCenter || wm.headerRight) parts.push('Header');
      if (wm.footerLeft || wm.footerCenter || wm.footerRight) parts.push('Footer');
      return parts.join(' & ') || 'Header/Footer';
    }
    default:
      return 'Unknown';
  }
}

function getWmIcon(wm) {
  switch (wm.type) {
    case 'textWatermark': return 'T';
    case 'imageWatermark': return '\u{1F5BC}';
    case 'headerFooter': return '\u{1F4C4}';
    default: return '?';
  }
}

function getWmTypeLabel(wm) {
  switch (wm.type) {
    case 'textWatermark': return 'Text';
    case 'imageWatermark': return 'Image';
    case 'headerFooter': return 'Header/Footer';
    default: return '';
  }
}

export default function ManageWatermarksDialog() {
  const close = () => closeDialog('manage-watermarks');

  function handleToggle(wm, checked) {
    const oldState = { ...wm };
    wm.enabled = checked;
    recordModifyWatermark(wm.id, oldState, { ...wm });
    markDocumentModified();
    refresh();
  }

  function handleEdit(wm) {
    close();
    if (wm.type === 'headerFooter') {
      openDialog('header-footer', { editWm: wm });
    } else {
      openDialog('watermark', { editWm: wm });
    }
  }

  function handleDelete(wm) {
    const idx = state.watermarks.indexOf(wm);
    if (idx !== -1) {
      state.watermarks.splice(idx, 1);
      recordRemoveWatermark(wm, idx);
      markDocumentModified();
      refresh();
    }
  }

  const footer = (
    <>
      <div class="watermark-footer-left"></div>
      <div class="watermark-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>Close</button>
      </div>
    </>
  );

  return (
    <Dialog
      title="Manage Watermarks"
      overlayClass="manage-wm-overlay"
      dialogClass="manage-wm-dialog"
      headerClass="manage-wm-header"
      bodyClass="manage-wm-content"
      footerClass="watermark-footer"
      onClose={close}
      footer={footer}
    >
      <div class="manage-wm-list">
        <Show
          when={state.watermarks && state.watermarks.length > 0}
          fallback={<div class="manage-wm-empty">No watermarks added yet.</div>}
        >
          <For each={state.watermarks}>
            {(wm) => (
              <div class="manage-wm-item">
                <span class="manage-wm-item-icon">{getWmIcon(wm)}</span>
                <span class="manage-wm-item-desc">
                  {getWmDescription(wm)}
                  <span class="manage-wm-item-type">{getWmTypeLabel(wm)}</span>
                </span>
                <div class="manage-wm-item-actions">
                  <input
                    type="checkbox"
                    class="manage-wm-toggle"
                    checked={wm.enabled}
                    title="Enable/Disable"
                    onChange={(e) => handleToggle(wm, e.target.checked)}
                  />
                  <button
                    class="manage-wm-btn edit"
                    title="Edit"
                    onClick={() => handleEdit(wm)}
                  >Edit</button>
                  <button
                    class="manage-wm-btn delete"
                    title="Delete"
                    onClick={() => handleDelete(wm)}
                  >Delete</button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  );
}
