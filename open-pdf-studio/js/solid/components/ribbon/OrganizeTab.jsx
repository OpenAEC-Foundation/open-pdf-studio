import { startScanTextTool } from '../../../tools/tools/scan-text-tool.js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { insertPageIcon, deletePageIcon, extractPagesIcon, mergePdfsIcon, watermarkIcon, headerFooterIcon, manageWatermarksIcon, editTextIcon, addTextIcon, ocrIcon, cropMarginsIcon, straightenIcon, shiftPageIcon, resizePagesIcon, rotateLeftIcon, rotateRightIcon } from '../../data/ribbonIcons.js';
import { state, noPdf, getActiveDocument } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { showInsertPageDialog, showExtractPagesDialog, showMergePdfsDialog } from '../../../ui/chrome/dialogs.js';
import { draaiVanafKnop } from '../../../pdf/pagina-draaien.js';
import { setTool } from '../../../tools/manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { compareActive, exitCompare } from '../../../compare/compare-store.js';

const reorderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="4"/><rect x="3" y="10" width="6" height="4"/><rect x="3" y="17" width="6" height="4"/><path d="M14 5l4 4-4 4M14 13l4 4-4 4M18 9H10M18 17H10" stroke-linecap="round"/></svg>`;
// Edit Pages (#764): a grid of pages with a pencil — the visual page organizer.
const editPagesIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2.5" y="3" width="7" height="8"/><rect x="12" y="3" width="7" height="8"/><rect x="2.5" y="13.5" width="7" height="8"/><path d="M13 21.5l.6-3 6.2-6.2 2.4 2.4-6.2 6.2z"/></svg>`;
const compressIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9.5 14.5L12 12l2.5 2.5"/></svg>`;

// Eén blad dat in twee delen uiteenvalt (Document splitsen, #381).
const splitDocumentIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 3h7v7H4z"/><path d="M13 14h7v7h-7z"/><path d="M11 6.5h3.5a2 2 0 012 2V12" stroke-linecap="round"/><path d="M14.5 10l2 2 2-2" stroke-linecap="round"/></svg>`;

const scanTextIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8.5 9.5h7M12 9.5v6"/></svg>`;

// Scanner en map-OCR (#382).
const scanIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 14h18v5H3z"/><path d="M6 14V5h9l3 3v6" /><path d="M15 5v3h3"/><path d="M6 16.5h4" stroke-linecap="round"/></svg>`;
const batchOcrIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z"/><path d="M8 12h8M8 15h5" stroke-linecap="round"/></svg>`;

export default function OrganizeTab() {
  const { t } = useTranslation('ribbon');
  const ro = () => noPdf() || isPdfAReadOnly();

  // Pagina-rotatie bewerkt het document (undo-baar, wordt opgeslagen) en
  // hoort daarom bij de pagina-bewerkingen — verplaatst uit de Beeld-groep
  // van de Start-tab (#200). Draait de geselecteerde miniaturen, of anders de
  // huidige pagina (#464).
  const rotateCurrentPage = (delta) => draaiVanafKnop(delta);

  // Opens the page organizer: a thumbnail grid in which pages are dragged
  // into a new order (#763). Switching the left panel to its thumbnails was
  // all this did before, and those are already showing by default.
  function openPageReorder() {
    if (!getActiveDocument()?.pdfDoc) return;
    openDialog('page-organizer', {});
  }

  // Edit Pages (#764): the same organizer, the primary entry point — there
  // pages are also rotated, deleted, extracted, inserted and split.
  function openEditPages() {
    if (!getActiveDocument()?.pdfDoc) return;
    openDialog('page-organizer', {});
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
          <RibbonButton id="ep-scan-text" title={t('organize.scanText')} icon={scanTextIcon} label={t('organize.scanText')}
            disabled={ro()} active={state.currentTool === 'scanText'} onClick={() => startScanTextTool()} />
          <RibbonButton id="ep-ocr" title={t('organize.ocr')} icon={ocrIcon} label={t('organize.ocr')}
            disabled={ro()} onClick={() => {
              const doc = getActiveDocument();
              openDialog('ocr-language', { totalPages: doc?.pdfDoc?.numPages });
            }} />
          <RibbonButton id="ep-crop-margins" title={t('home.cropMargins')} icon={cropMarginsIcon} label={t('home.crop')}
            disabled={ro()} onClick={() => {
              const doc = getActiveDocument();
              openDialog('crop-margins', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 });
            }} />
          <RibbonButton id="ep-straighten" title={t('organize.straighten')} icon={straightenIcon} label={t('organize.straighten')}
            disabled={ro()} onClick={async () => {
              const { startStraightenPage } = await import('../../../tools/straighten-select.js');
              startStraightenPage();
            }} />
          <RibbonButton id="ep-shift-page" title={t('organize.shiftPage')} icon={shiftPageIcon} label={t('organize.shiftPage')}
            disabled={ro()} onClick={() => {
              const doc = getActiveDocument();
              openDialog('shift-page', { totalPages: doc?.pdfDoc?.numPages || 1, currentPage: doc?.currentPage || 1 });
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
          <RibbonButton id="edit-pages" title={t('organize.editPagesTitle')} icon={editPagesIcon} label={t('organize.editPages')}
            disabled={ro()} onClick={openEditPages} />
          <RibbonButton id="insert-page" title={t('organize.insertPage')} icon={insertPageIcon} label={t('organize.insert')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showInsertPageDialog()} />
          <RibbonButton id="delete-page" title={t('organize.deletePage')} icon={deletePageIcon} label={t('organize.deleteLabel')}
            disabled={noPdf() || isPdfAReadOnly()}
            onClick={() => { const doc = getActiveDocument(); openDialog('delete-pages', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 }); }} />
          <RibbonButton id="extract-pages" title={t('organize.extractPages')} icon={extractPagesIcon} label={t('organize.extractLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showExtractPagesDialog()} />
          <RibbonButton id="split-document" title={t('organize.splitDocument')} icon={splitDocumentIcon} label={t('organize.splitLabel')}
            disabled={noPdf()} onClick={() => openDialog('split-document', {})} />
          <RibbonButton id="reorder-pages"
            title={t('organize.reorderPagesTitle') || 'Open thumbnails to drag pages into a new order'}
            icon={reorderIcon}
            label={t('organize.reorderPages') || 'Reorder'}
            disabled={ro()} onClick={openPageReorder} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.scanGroup')}>
          <RibbonButton id="ep-scan" title={t('organize.scanTitle')} icon={scanIcon} label={t('organize.scan')}
            onClick={() => openDialog('scan', {})} />
          <RibbonButton id="ep-batch-ocr" title={t('organize.batchOcrTitle')} icon={batchOcrIcon} label={t('organize.batchOcr')}
            onClick={() => openDialog('batch-ocr', {})} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.combine')}>
          <RibbonButton id="merge-pdfs" title={t('organize.mergePdfs')} icon={mergePdfsIcon} label={t('organize.mergeLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showMergePdfsDialog()} />
          {/* Zelfde knop als op het Beeld-tabblad (ribbon-compare); hier met
              een eigen id zodat beide instanties onafhankelijk in de
              knoppen-rooktest meetellen. */}
          <RibbonButton id="organize-compare"
            title={t('compare.title') || 'Compare PDFs'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="8" height="16"/><rect x="13" y="4" width="8" height="16"/><line x1="11" y1="12" x2="13" y2="12"/></svg>`}
            label={t('compare.title') || 'Compare'}
            disabled={(state.documents?.length || 0) < 2}
            active={compareActive()}
            onClick={() => {
              if (compareActive()) exitCompare();
              else openDialog('compare', {});
            }} />
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
