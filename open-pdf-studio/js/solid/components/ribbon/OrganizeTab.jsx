import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { insertPageIcon, deletePageIcon, extractPagesIcon, mergePdfsIcon, watermarkIcon, headerFooterIcon, manageWatermarksIcon } from '../../data/ribbonIcons.js';
import { state } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { goToPage } from '../../../pdf/renderer.js';
import { showInsertPageDialog, showExtractPagesDialog, showMergePdfsDialog } from '../../../ui/chrome/dialogs.js';
import { deletePages } from '../../../pdf/page-manager.js';

export default function OrganizeTab() {
  return (
    <div class="ribbon-content active" id="tab-organize">
      <div class="ribbon-groups">
        <RibbonGroup label="Pages">
          <RibbonButton id="insert-page" title="Insert Page" icon={insertPageIcon} label="Insert"
            disabled={isPdfAReadOnly()} onClick={() => showInsertPageDialog()} />
          <RibbonButton id="delete-page" title="Delete Page" icon={deletePageIcon} label="Delete"
            disabled={isPdfAReadOnly()}
            onClick={async () => {
              if (!state.pdfDoc) return;
              if (state.pdfDoc.numPages <= 1) { alert('Cannot delete the last remaining page.'); return; }
              const confirmed = await window.__TAURI__?.dialog?.ask(`Delete page ${state.currentPage}?`, { title: 'Delete Page', kind: 'warning' });
              if (confirmed) await deletePages([state.currentPage]);
            }} />
          <RibbonButton id="extract-pages" title="Extract Pages" icon={extractPagesIcon} label="Extract"
            disabled={isPdfAReadOnly()} onClick={() => showExtractPagesDialog()} />
        </RibbonGroup>

        <RibbonGroup label="Combine">
          <RibbonButton id="merge-pdfs" title="Merge PDFs" icon={mergePdfsIcon} label="Merge"
            disabled={isPdfAReadOnly()} onClick={() => showMergePdfsDialog()} />
        </RibbonGroup>

        <RibbonGroup label="Watermark">
          <RibbonButton id="add-watermark" title="Add Watermark" icon={watermarkIcon} label="Watermark"
            disabled={isPdfAReadOnly()} onClick={async () => { const { showWatermarkDialog } = await import('../../../watermark/watermark-dialog.js'); showWatermarkDialog(); }} />
          <RibbonButton id="add-header-footer" title="Add Header/Footer" icon={headerFooterIcon} label="Header/Footer"
            disabled={isPdfAReadOnly()} onClick={async () => { const { showHeaderFooterDialog } = await import('../../../watermark/watermark-dialog.js'); showHeaderFooterDialog(); }} />
          <RibbonButton id="manage-watermarks" title="Manage Watermarks" icon={manageWatermarksIcon} label="Manage"
            disabled={isPdfAReadOnly()} onClick={async () => { const { showManageWatermarksDialog } = await import('../../../watermark/watermark-dialog.js'); showManageWatermarksDialog(); }} />
        </RibbonGroup>
      </div>
    </div>
  );
}
