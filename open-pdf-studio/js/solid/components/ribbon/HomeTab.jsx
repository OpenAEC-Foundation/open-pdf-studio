import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import SplitButton from './SplitButton.jsx';
import { setTool } from '../../../tools/manager.js';
import { state, getPageRotation } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage, rotatePage } from '../../../pdf/renderer.js';
import { recordPageRotation } from '../../../core/undo-manager.js';
import { openFindBar } from '../../../search/find-bar.js';
import {
  handIcon, selectTextIcon, selectCommentsIcon, screenshotIcon,
  zoomInIcon, zoomOutIcon, fitWidthIcon, actualSizeIcon, fitPageIcon,
  rotateLeftIcon, rotateRightIcon, editTextIcon, addTextIcon,
  firstPageIcon, prevPageIcon, nextPageIcon, lastPageIcon, findIcon
} from '../../data/ribbonIcons.js';

export default function HomeTab() {
  return (
    <div class="ribbon-content active" id="tab-home">
      <div class="ribbon-groups">
        <RibbonGroup label="Tools">
          <RibbonButton id="tool-hand" title="Hand Tool" icon={handIcon} label="Hand"
            active={state.currentTool === 'hand'} onClick={() => setTool('hand')} />
          <RibbonButton id="tool-select" title="Select Text" icon={selectTextIcon} label="Select Text"
            active={state.currentTool === 'select'} onClick={() => setTool('select')} />
          <RibbonButton id="tool-select-comments" title="Select Comments" icon={selectCommentsIcon} label="Select Comments"
            active={state.currentTool === 'selectComments'} onClick={() => setTool('selectComments')} />
          <SplitButton
            id="screenshot-split-btn"
            mainIcon={screenshotIcon}
            mainLabel="Screenshot"
            mainTitle="Capture Full Page"
            dropdownTitle="Screenshot options"
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
              Full Page
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
              Region
            </button>
          </SplitButton>
        </RibbonGroup>

        <RibbonGroup label="View">
          <RibbonButtonStack>
            <RibbonButton size="small" id="zoom-in-ribbon" title="Zoom In" icon={zoomInIcon} label="Zoom In"
              onClick={() => zoomIn()} />
            <RibbonButton size="small" id="zoom-out-ribbon" title="Zoom Out" icon={zoomOutIcon} label="Zoom Out"
              onClick={() => zoomOut()} />
            <RibbonButton size="small" id="fit-width" title="Fit Width" icon={fitWidthIcon} label="Fit Width"
              onClick={() => fitWidth()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="actual-size-ribbon" title="Actual Size (Ctrl+0)" icon={actualSizeIcon} label="100%"
              onClick={() => actualSize()} />
            <RibbonButton size="small" id="fit-page-ribbon" title="Fit Page (Ctrl+2)" icon={fitPageIcon} label="Fit Page"
              onClick={() => fitPage()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="rotate-left" title="Rotate Left" icon={rotateLeftIcon} label="Rotate Left"
              disabled={isPdfAReadOnly()} onClick={() => {
                const oldRot = getPageRotation(state.currentPage);
                rotatePage(-90);
                recordPageRotation(state.currentPage, oldRot, getPageRotation(state.currentPage));
              }} />
            <RibbonButton size="small" id="rotate-right" title="Rotate Right" icon={rotateRightIcon} label="Rotate Right"
              disabled={isPdfAReadOnly()} onClick={() => {
                const oldRot = getPageRotation(state.currentPage);
                rotatePage(90);
                recordPageRotation(state.currentPage, oldRot, getPageRotation(state.currentPage));
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label="Edit">
          <RibbonButton id="edit-text" title="Edit Text" icon={editTextIcon} label="Edit Text"
            disabled={isPdfAReadOnly()} active={state.currentTool === 'editText'} onClick={() => setTool('editText')} />
          <RibbonButton id="add-text" title="Add Text" icon={addTextIcon} label="Add Text"
            disabled={isPdfAReadOnly()} onClick={() => setTool('text')} />
        </RibbonGroup>

        <RibbonGroup label="Navigate">
          <RibbonButtonStack>
            <RibbonButton size="small" id="first-page" title="First Page" icon={firstPageIcon} label="First"
              onClick={async () => { if (state.pdfDoc && state.currentPage !== 1) await goToPage(1); }} />
            <RibbonButton size="small" id="prev-page-ribbon" title="Previous Page" icon={prevPageIcon} label="Previous"
              onClick={() => document.getElementById('prev-page')?.click()} />
            <RibbonButton size="small" id="next-page-ribbon" title="Next Page" icon={nextPageIcon} label="Next"
              onClick={() => document.getElementById('next-page')?.click()} />
          </RibbonButtonStack>
          <RibbonButton id="last-page" title="Last Page" icon={lastPageIcon} label="Last"
            onClick={async () => { if (state.pdfDoc && state.currentPage !== state.pdfDoc.numPages) await goToPage(state.pdfDoc.numPages); }} />
        </RibbonGroup>

        <RibbonGroup label="Find">
          <RibbonButton id="ribbon-find" title="Find (Ctrl+F)" icon={findIcon} label="Find"
            onClick={() => openFindBar()} />
        </RibbonGroup>
      </div>
    </div>
  );
}
