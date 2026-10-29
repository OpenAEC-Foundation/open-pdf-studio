import { For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { recordRemoveWatermark, recordModifyWatermark } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { kopVoetInWeergave, haalKopVoetUitWeergave } from '../../../watermark/kopvoet-weergave.js';

function refresh() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Een kop-/voettekst die als pagina-inhoud in de weergave staat, gaat daar
// eerst uit vóór hij verandert of verdwijnt (kopvoet-weergave.js).
async function voorWijziging(wm) {
  const doc = getActiveDocument();
  if (kopVoetInWeergave(doc, wm)) await haalKopVoetUitWeergave(doc);
  return getActiveDocument() === doc;
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

export default function ManageWatermarksDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  function getWmTypeLabel(wm) {
    switch (wm.type) {
      case 'textWatermark': return t('manageWatermarks.typeText');
      case 'imageWatermark': return t('manageWatermarks.typeImage');
      case 'headerFooter': return t('manageWatermarks.typeHeaderFooter');
      default: return '';
    }
  }

  const close = () => closeDialog('manage-watermarks');

  async function handleToggle(wm, checked) {
    if (!(await voorWijziging(wm))) return;
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

  async function handleDelete(wm) {
    if (!(await voorWijziging(wm))) return;
    const doc = getActiveDocument();
    const watermarks = doc?.watermarks;
    if (!watermarks) return;
    const idx = watermarks.indexOf(wm);
    if (idx !== -1) {
      watermarks.splice(idx, 1);
      recordRemoveWatermark(wm, idx);
      markDocumentModified();
      refresh();
    }
  }

  const footer = (
    <>
      <div class="watermark-footer-left"></div>
      <div class="watermark-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('close')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('manageWatermarks.title')}
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
          when={state.documents[state.activeDocumentIndex]?.watermarks && state.documents[state.activeDocumentIndex]?.watermarks.length > 0}
          fallback={<div class="manage-wm-empty">{t('manageWatermarks.noWatermarks')}</div>}
        >
          <For each={state.documents[state.activeDocumentIndex]?.watermarks}>
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
                    title={t('manageWatermarks.enableDisable')}
                    onChange={(e) => handleToggle(wm, e.target.checked)}
                  />
                  <button
                    class="manage-wm-btn edit"
                    title={tCommon('edit')}
                    onClick={() => handleEdit(wm)}
                  >{tCommon('edit')}</button>
                  <button
                    class="manage-wm-btn delete"
                    title={tCommon('delete')}
                    onClick={() => handleDelete(wm)}
                  >{tCommon('delete')}</button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  );
}
