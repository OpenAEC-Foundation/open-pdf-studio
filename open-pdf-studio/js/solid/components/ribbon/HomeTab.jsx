import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import SplitButton from './SplitButton.jsx';
import { setTool } from '../../../tools/manager.js';
import { state, getPageRotation, noPdf, getActiveDocument } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage, rotatePage } from '../../../pdf/renderer.js';
import { recordPageRotation } from '../../../core/undo-manager.js';
import { openFindBar } from '../../../search/find-bar.js';
import {
  handIcon, selectTextIcon, selectCommentsIcon, screenshotIcon,
  zoomInIcon, zoomOutIcon, fitWidthIcon, actualSizeIcon, fitPageIcon,
  rotateLeftIcon, rotateRightIcon, editTextIcon, addTextIcon, cropMarginsIcon,
  selectObjectsIcon,
  firstPageIcon, prevPageIcon, nextPageIcon, lastPageIcon, findIcon
} from '../../data/ribbonIcons.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function HomeTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-home">
      <div class="ribbon-groups">
        <RibbonGroup label={t('home.tools')}>
          <RibbonButton id="tool-hand" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => setTool('hand')} />
          <RibbonButton id="tool-select" title={t('home.selectText')} icon={selectTextIcon} label={t('home.selectText')}
            disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => setTool('select')} />
          <RibbonButton id="tool-select-comments" title={t('home.selectComments')} icon={selectCommentsIcon} label={t('home.selectComments')}
            disabled={noPdf()} active={state.currentTool === 'selectComments'} onClick={() => setTool('selectComments')} />
          <SplitButton
            id="screenshot-split-btn"
            mainIcon={screenshotIcon}
            mainLabel={t('home.screenshot')}
            mainTitle={t('home.captureFullPage')}
            dropdownTitle={t('home.screenshotOptions')}
            disabled={noPdf()}
            onMainClick={async () => {
              const { screenshotFullPage } = await import('../../../tools/screenshot.js');
              screenshotFullPage();
            }}
          >
            <button class="ribbon-split-btn-menu-item" id="screenshot-menu-page"
              onClick={async () => {
                const { screenshotFullPage } = await import('../../../tools/screenshot.js');
                screenshotFullPage();
              }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                <circle cx="12" cy="13" r="3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
              </svg>
              {t('home.fullPage')}
            </button>
            <button class="ribbon-split-btn-menu-item" id="screenshot-menu-region"
              onClick={async () => {
                const { startRegionScreenshot } = await import('../../../tools/screenshot.js');
                startRegionScreenshot();
              }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/>
                <rect x="8" y="8" width="8" height="8" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" stroke-dasharray="2 2"/>
              </svg>
              {t('home.region')}
            </button>
          </SplitButton>
        </RibbonGroup>

        <RibbonGroup label={t('home.view')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="zoom-in-ribbon" title={t('home.zoomIn')} icon={zoomInIcon} label={t('home.zoomIn')}
              disabled={noPdf()} onClick={() => zoomIn()} />
            <RibbonButton size="small" id="zoom-out-ribbon" title={t('home.zoomOut')} icon={zoomOutIcon} label={t('home.zoomOut')}
              disabled={noPdf()} onClick={() => zoomOut()} />
            <RibbonButton size="small" id="fit-width" title={t('home.fitWidth')} icon={fitWidthIcon} label={t('home.fitWidth')}
              disabled={noPdf()} onClick={() => fitWidth()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="actual-size-ribbon" title={t('home.actualSize')} icon={actualSizeIcon} label={t('home.hundredPercent')}
              disabled={noPdf()} onClick={() => actualSize()} />
            <RibbonButton size="small" id="fit-page-ribbon" title={t('home.fitPage')} icon={fitPageIcon} label={t('home.fitPageLabel')}
              disabled={noPdf()} onClick={() => fitPage()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="rotate-left" title={t('home.rotateLeft')} icon={rotateLeftIcon} label={t('home.rotateLeft')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => {
                const doc = getActiveDocument();
                const pg = doc ? doc.currentPage : 1;
                const oldRot = getPageRotation(pg);
                rotatePage(-90);
                recordPageRotation(pg, oldRot, getPageRotation(pg));
              }} />
            <RibbonButton size="small" id="rotate-right" title={t('home.rotateRight')} icon={rotateRightIcon} label={t('home.rotateRight')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => {
                const doc = getActiveDocument();
                const pg = doc ? doc.currentPage : 1;
                const oldRot = getPageRotation(pg);
                rotatePage(90);
                recordPageRotation(pg, oldRot, getPageRotation(pg));
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('home.edit')}>
          <RibbonButton id="edit-text" title={t('home.editText')} icon={editTextIcon} label={t('home.editText')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'editText'} onClick={() => setTool('editText')} />
          <RibbonButton id="add-text" title={t('home.addText')} icon={addTextIcon} label={t('home.addText')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => setTool('text')} />
          <RibbonButton id="select-objects" title={t('home.selectObjectsTitle')} icon={selectObjectsIcon} label={t('home.selectObjects')}
            disabled={noPdf()} active={state.currentTool === 'selectObjects'} onClick={() => setTool('selectObjects')} />
          <RibbonButton id="crop-margins" title={t('home.cropMargins')} icon={cropMarginsIcon} label={t('home.crop')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => { const doc = getActiveDocument(); openDialog('crop-margins', { totalPages: doc?.pdfDoc?.numPages, currentPage: doc?.currentPage || 1 }); }} />
        </RibbonGroup>

        <RibbonGroup label={t('home.navigate')}>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="first-page" title={t('home.firstPage')} icon={firstPageIcon} label={t('home.first')}
              disabled={noPdf() || (state.documents[state.activeDocumentIndex]?.currentPage || 1) === 1} onClick={() => goToPage(1)} />
            <RibbonButton size="medium" id="prev-page-ribbon" title={t('home.previousPage')} icon={prevPageIcon} label={t('home.previous')}
              disabled={noPdf() || (state.documents[state.activeDocumentIndex]?.currentPage || 1) <= 1} onClick={() => goToPage((getActiveDocument()?.currentPage || 1) - 1)} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="medium" id="next-page-ribbon" title={t('home.nextPage')} icon={nextPageIcon} label={t('home.next')}
              disabled={noPdf() || (state.documents[state.activeDocumentIndex]?.currentPage || 1) >= state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages} onClick={() => goToPage((getActiveDocument()?.currentPage || 1) + 1)} />
            <RibbonButton size="medium" id="last-page" title={t('home.lastPage')} icon={lastPageIcon} label={t('home.last')}
              disabled={noPdf() || (state.documents[state.activeDocumentIndex]?.currentPage || 1) >= state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages} onClick={() => goToPage(state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages)} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('home.find')}>
          <RibbonButton id="ribbon-find" title={t('home.findCtrlF')} icon={findIcon} label={t('home.find')}
            disabled={noPdf()} onClick={() => openFindBar()} />
        </RibbonGroup>
      </div>
    </div>
  );
}
