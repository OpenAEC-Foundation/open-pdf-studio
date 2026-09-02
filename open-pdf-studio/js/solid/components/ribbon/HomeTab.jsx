import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import SplitButton from './SplitButton.jsx';
import { setTool } from '../../../tools/manager.js';
import { state, noPdf, getActiveDocument } from '../../../core/state.js';
import { zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage } from '../../../pdf/renderer.js';
import { openFindBar } from '../../../search/find-bar.js';
import {
  handIcon, selectTextIcon, screenshotIcon,
  zoomInIcon, zoomOutIcon, fitWidthIcon, actualSizeIcon, fitPageIcon,
  editTextIcon, addTextIcon, cropMarginsIcon,
  firstPageIcon, prevPageIcon, nextPageIcon, lastPageIcon, findIcon,
  preferencesIcon, previousVersionIcon
} from '../../data/ribbonIcons.js';
import { openDialog } from '../../stores/dialogStore.js';
import { lastCaptureAvailable } from '../../stores/screenshotStore.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// New-document icon (blank sheet with a plus)
const newDocIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;
// IFC-report export icon (box with outgoing arrow)
const ifcExportIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11v9M4 8.5 12 11l8-2.5"/></svg>`;
// E-mail icon (envelope)
const emailIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>`;
// Raster-PDF icon (document with an embedded image glyph)
const rasterPdfIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3v6h6"/><circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 18l2.5-2.5L13 18l2-2 2 2.5"/></svg>`;

export default function HomeTab() {
  const { t } = useTranslation('ribbon');
  const { t: tMenu } = useTranslation('appMenu');

  return (
    <div class="ribbon-content active" id="tab-home">
      <AdaptiveGroups>
        <RibbonGroup label={t('home.document') || 'Document'}>
          <RibbonButton id="btn-home-new" title={t('home.newDocument') || 'Nieuw document (kader of blanco)'}
            icon={newDocIcon} label={t('home.new') || 'Nieuw'}
            onClick={() => openDialog('new-doc')} />
          <RibbonButton id="btn-home-ifc-export" title={t('home.ifcExport')}
            icon={ifcExportIcon} label="IFC-report" disabled={noPdf()}
            onClick={async () => {
              const m = await import('../../../pdf/ifc-export.js');
              m.exportIfcReport();
            }} />
          <RibbonButton id="btn-home-email" title={t('home.emailPdf')}
            icon={emailIcon} label="E-mail" disabled={noPdf()}
            onClick={async () => {
              const m = await import('../../../pdf/email-pdf.js');
              m.emailCurrentPdf();
            }} />
          <RibbonButton id="btn-home-raster-pdf" title={tMenu('exportPanel.exportRaster') || 'Exporteren als raster-PDF'}
            icon={rasterPdfIcon} label="Raster-PDF" disabled={noPdf()}
            onClick={async () => {
              const doc = getActiveDocument();
              const total = doc?.pdfDoc?.numPages || 0;
              if (!total) return;
              const pages = [];
              for (let i = 1; i <= total; i++) pages.push(i);
              const m = await import('../../../pdf/exporter.js');
              await m.exportAsRasterPdf({ dpi: 300, pages });
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('home.tools')}>
          <RibbonButton id="tool-hand" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => setTool('hand')} />
          <RibbonButton id="tool-select" title={t('home.select') || 'Select'} icon={selectTextIcon} label={t('home.select') || 'Select'}
            disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => {
              setTool('select');
              // Arm the marquee so the next pointerdown anywhere on the canvas
              // starts a rubber-band selection — including landing on an annotation.
              state.armedMarquee = true;
            }} />
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
            <button class="ribbon-split-btn-menu-item" id="screenshot-menu-overlay"
              title={t('home.placeAsOverlayTitle')}
              disabled={!lastCaptureAvailable()}
              onClick={async () => {
                const { placeLastScreenshotAsOverlay } = await import('../../../tools/screenshot.js');
                placeLastScreenshotAsOverlay();
              }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
                <rect x="4" y="4" width="12" height="12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                <rect x="9" y="9" width="11" height="11" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" opacity="0.55"/>
              </svg>
              {t('home.placeAsOverlay')}
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
          {/* Pagina-rotatie (bewerkt het document) staat bij de pagina-
              bewerkingen op de tab "PDF bewerken & samenvoegen" (#200). */}
        </RibbonGroup>

        {/* Edit group moved to the "PDF bewerken & samenvoegen" tab. */}

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

        <RibbonGroup label={t('help.settings')}>
          <RibbonButton id="ribbon-preferences" title={t('help.preferencesTitle')}
            icon={preferencesIcon} label={t('help.preferences')}
            onClick={() => showPreferencesDialog()} />
          <RibbonButton id="ribbon-previous-version" title={t('help.previousVersionTitle')}
            icon={previousVersionIcon} label={t('help.previousVersion')}
            onClick={() => import('../../../help/previous-version.js').then((m) => m.installPreviousVersion())} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
