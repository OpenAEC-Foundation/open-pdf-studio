import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { insertPageIcon, deletePageIcon, extractPagesIcon, mergePdfsIcon, watermarkIcon, headerFooterIcon, manageWatermarksIcon, editTextIcon, addTextIcon, cropMarginsIcon, resizePagesIcon, rotateLeftIcon, rotateRightIcon } from '../../data/ribbonIcons.js';
import { state, noPdf, getActiveDocument, getPageRotation } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { showInsertPageDialog, showExtractPagesDialog, showMergePdfsDialog } from '../../../ui/chrome/dialogs.js';
import { rotatePage } from '../../../pdf/renderer.js';
import { recordPageRotation } from '../../../core/undo-manager.js';
import { setTool } from '../../../tools/manager.js';
import { setLeftPanelActiveTab, setLeftPanelCollapsed } from '../../../bridge.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';

const reorderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="4"/><rect x="3" y="10" width="6" height="4"/><rect x="3" y="17" width="6" height="4"/><path d="M14 5l4 4-4 4M14 13l4 4-4 4M18 9H10M18 17H10" stroke-linecap="round"/></svg>`;
const compressIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9.5 14.5L12 12l2.5 2.5"/></svg>`;

export default function OrganizeTab() {
  const { t } = useTranslation('ribbon');
  const ro = () => noPdf() || isPdfAReadOnly();

  // Pagina-rotatie bewerkt het document (undo-baar, wordt opgeslagen) en
  // hoort daarom bij de pagina-bewerkingen — verplaatst uit de Beeld-groep
  // van de Start-tab (#200).
  function rotateCurrentPage(delta) {
    const doc = getActiveDocument();
    const pg = doc ? doc.currentPage : 1;
    const oldRot = getPageRotation(pg);
    rotatePage(delta);
    recordPageRotation(pg, oldRot, getPageRotation(pg));
  }

  function openPageReorder() {
    // Open the left panel and switch to the page-thumbnails tab so the user
    // can drag pages to reorder.
    try {
      setLeftPanelCollapsed(false);
      setLeftPanelActiveTab('thumbnails');
    } catch (_) {
      // Fallback: just toggle whatever panel exists
      import('../../../ui/panels/left-panel.js').then(m => m.toggleLeftPanel && m.toggleLeftPanel()).catch(() => {});
    }
  }

  return (
    <div class="ribbon-content active" id="tab-organize">
      <AdaptiveGroups>
        {/* Edit group — moved here from the Home tab */}
        <RibbonGroup label={t('home.edit')}>
          <RibbonButton id="ep-edit-text" title={t('home.editText')} icon={editTextIcon} label={t('home.editText')}
            disabled={ro()} active={state.currentTool === 'editText'} onClick={() => setTool('editText')} />
          <RibbonButton id="ep-add-text" title={t('home.addText')} icon={addTextIcon} label={t('home.addText')}
            disabled={ro()} onClick={() => setTool('text')} />
          <RibbonButton id="ep-crop-margins" title={t('home.cropMargins')} icon={cropMarginsIcon} label={t('home.crop')}
            disabled={ro()} onClick={() => {
              const doc = getActiveDocument();
              openDialog('crop-margins', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 });
            }} />
          <RibbonButton id="ep-resize-pages" title={t('home.resizePages')} icon={resizePagesIcon} label={t('home.resize')}
            disabled={ro()} onClick={() => {
              const doc = getActiveDocument();
              openDialog('resize-pages', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 });
            }} />
          <RibbonButton id="ep-compress-pdf" title={t('organize.compressPdf')} icon={compressIcon} label={t('organize.compressLabel')}
            disabled={noPdf()} onClick={async () => {
              const { getCurrentDocumentSize } = await import('../../../pdf/compress.js');
              openDialog('compress', { currentSize: getCurrentDocumentSize() });
            }} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="rotate-left" title={t('home.rotateLeft')} icon={rotateLeftIcon} label={t('home.rotateLeft')}
              disabled={ro()} onClick={() => rotateCurrentPage(-90)} />
            <RibbonButton size="small" id="rotate-right" title={t('home.rotateRight')} icon={rotateRightIcon} label={t('home.rotateRight')}
              disabled={ro()} onClick={() => rotateCurrentPage(90)} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('organize.pages')}>
          <RibbonButton id="insert-page" title={t('organize.insertPage')} icon={insertPageIcon} label={t('organize.insert')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showInsertPageDialog()} />
          <RibbonButton id="delete-page" title={t('organize.deletePage')} icon={deletePageIcon} label={t('organize.deleteLabel')}
            disabled={noPdf() || isPdfAReadOnly()}
            onClick={() => { const doc = getActiveDocument(); openDialog('delete-pages', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 }); }} />
          <RibbonButton id="extract-pages" title={t('organize.extractPages')} icon={extractPagesIcon} label={t('organize.extractLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showExtractPagesDialog()} />
          <RibbonButton id="reorder-pages"
            title={t('organize.reorderPagesTitle') || 'Open thumbnails to drag pages into a new order'}
            icon={reorderIcon}
            label={t('organize.reorderPages') || 'Volgorde'}
            disabled={noPdf()} onClick={openPageReorder} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.combine')}>
          <RibbonButton id="merge-pdfs" title={t('organize.mergePdfs')} icon={mergePdfsIcon} label={t('organize.mergeLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showMergePdfsDialog()} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.watermark')}>
          <RibbonButton id="add-watermark" title={t('organize.addWatermark')} icon={watermarkIcon} label={t('organize.watermarkLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showWatermarkDialog } = await import('../../../watermark/watermark-dialog.js'); showWatermarkDialog(); }} />
          <RibbonButton id="add-header-footer" title={t('organize.addHeaderFooter')} icon={headerFooterIcon} label={t('organize.headerFooter')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showHeaderFooterDialog } = await import('../../../watermark/watermark-dialog.js'); showHeaderFooterDialog(); }} />
          <RibbonButton id="manage-watermarks" title={t('organize.manageWatermarks')} icon={manageWatermarksIcon} label={t('organize.manage')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showManageWatermarksDialog } = await import('../../../watermark/watermark-dialog.js'); showManageWatermarksDialog(); }} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
