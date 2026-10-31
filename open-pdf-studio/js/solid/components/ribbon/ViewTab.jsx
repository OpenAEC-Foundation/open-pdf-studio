import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import ThemePicker from './ThemePicker.jsx';
import SplitButton from './SplitButton.jsx';
import { singlePageIcon, continuousIcon, bookViewIcon, facingPagesIcon, navigationIcon, propertiesIcon, annotationsListIcon, toolPaletteIcon, fullscreenIcon, fullscreenExitIcon, elementVisibilityIcon, annotationLayersIcon, rotateLeftIcon, rotateRightIcon } from '../../data/ribbonIcons.js';
import { isFullscreen } from '../../stores/ribbonStore.js';
import { toggleFullscreen } from '../../../ui/chrome/fullscreen.js';
import { toggleSymbolPalette } from '../SymbolPalette.jsx';
import { symbolPaletteVisible } from '../../stores/symbolStore.js';
import { toggleKeystrokeOverlay, keystrokeOverlayVisible } from '../KeystrokeOverlay.jsx';
import { setViewMode } from '../../../pdf/renderer.js';
import { toggleLeftPanel } from '../../../ui/panels/left-panel.js';
import { toggleAnnotationsListPanel } from '../../../ui/panels/annotations-list.js';
import { togglePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { panelVisible, panelCollapsed } from '../../stores/propertiesStore.js';
import { panelVisible as elementVisibilityPanelVisible, toggleElementVisibilityPanel } from '../../stores/elementVisibilityStore.js';
import { panelVisible as annotationLayersPanelVisible, toggleAnnotationLayersPanel } from '../../stores/annotationLayersStore.js';
import { collapsed as leftPanelCollapsed } from '../../stores/leftPanelStore.js';
import { state, noPdf, getActiveDocument } from '../../../core/state.js';
import { draaiWeergave } from '../../../pdf/weergave-draaien.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog, showMessage } from '../../stores/dialogStore.js';
import { readerTrackingPath } from '../../../core/reader-mode-tracking.js';
import { setReaderTracking } from '../../../pdf/reader-mode-view.js';
import { compareActive, compareFocused, exitCompare } from '../../../compare/compare-store.js';
import { status as readAloudStatus } from '../../stores/readAloudStore.js';
import { activeTab as leftPanelTab } from '../../stores/leftPanelStore.js';
import { splitsWeergave, hefSplitsingOp, zetSplitSync } from '../../../pdf/split-view/split-view.js';
import { sneltoetsVoor } from '../../stores/keybindingStore.js';
import { titleWithShortcut } from '../../../core/keybindings/labels.js';

export default function ViewTab() {
  const { t } = useTranslation('ribbon');

  // Weergave draaien (#200): alleen het beeld draait, het document niet.
  // Geen bewerking, dus ook bij een alleen-lezen (PDF/A-)document beschikbaar
  // en niet ongedaan te maken. Pagina's echt draaien (opgeslagen, ongedaan
  // te maken) staat op het tabblad Bewerken & combineren.
  const rotateView = (delta) => draaiWeergave(delta);

  // Gesplitste weergave (#715): per document, staat op doc.splitView.
  const splitView = () => state.documents[state.activeDocumentIndex]?.splitView || null;
  const splitDisabled = () => noPdf() || compareFocused();
  const splitVerticalIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;
  const splitSyncIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="8" height="14"/><rect x="14" y="5" width="8" height="14"/><path d="M6 9v6M18 9v6M4.5 13.5L6 15l1.5-1.5M16.5 13.5L18 15l1.5-1.5"/></svg>`;

  return (
    <div class="ribbon-content active" id="tab-view">
      <AdaptiveGroups>
        <RibbonGroup label={t('view.pageDisplay')}>
          <RibbonButton id="single-page" title={t('view.singlePage')} icon={singlePageIcon} label={t('view.single')}
            disabled={noPdf()} active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'single'}
            onClick={() => setViewMode('single')} />
          <RibbonButton id="continuous" title={t('view.continuousTitle')} icon={continuousIcon} label={t('view.continuous')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'continuous'
              && !state.documents[state.activeDocumentIndex]?.bookSpread
              && !state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => setViewMode('continuous')} />
          {/* Boekweergave bouwt op het doorlopende pad (grid-layout via
              bookSpread); nu dat pad weer werkt, is ook deze knop actief. */}
          <RibbonButton id="book-view" title={t('view.bookTitle')} icon={bookViewIcon} label={t('view.book')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode === 'continuous')
              && !!state.documents[state.activeDocumentIndex]?.bookSpread
              && !state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => setViewMode('book')} />
          {/* Facing (issue #164): twee pagina's naast elkaar als één spread
              tegelijk, niet-doorlopend — bladert per spread. Intern ook
              continuous, maar met facingSpread i.p.v. bookSpread. */}
          <RibbonButton id="facing-view" title={t('view.facingTitle')} icon={facingPagesIcon} label={t('view.facing')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode === 'continuous')
              && !!state.documents[state.activeDocumentIndex]?.facingSpread}
            disabled={noPdf()} onClick={() => setViewMode('facing')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="view-rotate-left" title={t('view.rotateViewLeftTitle')} icon={rotateLeftIcon} label={t('view.rotateViewLeft')}
              disabled={noPdf()} onClick={() => rotateView(-90)} />
            <RibbonButton size="small" id="view-rotate-right" title={t('view.rotateViewRightTitle')} icon={rotateRightIcon} label={t('view.rotateViewRight')}
              disabled={noPdf()} onClick={() => rotateView(90)} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('view.splitGroup')}>
          <SplitButton
            id="split-view-btn"
            mainIcon={splitVerticalIcon}
            mainLabel={t('view.split')}
            mainTitle={t('view.splitTitle')}
            dropdownTitle={t('view.splitOptions')}
            disabled={splitDisabled()}
            onMainClick={() => { if (splitView()) hefSplitsingOp(); else splitsWeergave('vertical'); }}
          >
            <button class="ribbon-split-btn-menu-item" id="split-menu-vertical"
              title={titleWithShortcut(t('view.splitVertical'), sneltoetsVoor('view.splitVertical'))}
              classList={{ active: splitView()?.richting === 'vertical' }}
              onClick={() => splitsWeergave('vertical')}>
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="4" width="18" height="16"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
              {t('view.splitVertical')}
            </button>
            <button class="ribbon-split-btn-menu-item" id="split-menu-horizontal"
              title={titleWithShortcut(t('view.splitHorizontal'), sneltoetsVoor('view.splitHorizontal'))}
              classList={{ active: splitView()?.richting === 'horizontal' }}
              onClick={() => splitsWeergave('horizontal')}>
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="4" width="18" height="16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              {t('view.splitHorizontal')}
            </button>
            <button class="ribbon-split-btn-menu-item" id="split-menu-unsplit"
              title={titleWithShortcut(t('view.unsplit'), sneltoetsVoor('view.unsplit'))}
              disabled={!splitView()}
              onClick={() => hefSplitsingOp()}>
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="4" width="18" height="16"/></svg>
              {t('view.unsplit')}
            </button>
          </SplitButton>
          <RibbonButton id="split-view-sync" title={t('view.splitSyncTitle')} icon={splitSyncIcon} label={t('view.splitSync')}
            disabled={splitDisabled() || !splitView()}
            active={!!splitView()?.sync}
            onClick={() => zetSplitSync(!splitView()?.sync)} />
        </RibbonGroup>

        <RibbonGroup label={t('view.display') || 'Display'}>
          <RibbonButton id="thin-lines-toggle"
            title={t('view.thinLines') || 'Thin Lines'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="6" x2="21" y2="6" stroke-width="0.5"/><line x1="3" y1="12" x2="21" y2="12" stroke-width="1.5"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="0.5"/></svg>`}
            label={t('view.thinLines') || 'Thin Lines'}
            disabled={noPdf()}
            active={state.preferences?.thinLines}
            onClick={() => {
              // Thin Lines (#595): preference + page re-render in the new line
              // mode (all render paths and caches, see pdf/thin-lines.js).
              import('../../../pdf/thin-lines.js').then(m => m.toggleThinLines());
            }} />
          <RibbonButton id="reader-mode-toggle"
            title={t('view.readerModeTip') || 'Remember this PDF\'s page, scroll position and zoom across closing and reopening it. While switched on, a small file is kept next to this PDF, so it also appears in cloud-synced folders (OneDrive, Dropbox, etc.); switching it off removes that file.'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5.5C4 4.67 4.67 4 5.5 4H12v16H5.5A1.5 1.5 0 014 18.5v-13z"/><path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 001.5-1.5v-13z"/><path d="M12 4v16" stroke-width="1"/></svg>`}
            label={t('view.readerMode') || 'Reader Mode'}
            disabled={noPdf() || !readerTrackingPath(getActiveDocument()) || !!getActiveDocument()?._isLoading}
            active={!!getActiveDocument()?.readerModeActive}
            onClick={async () => {
              // Per-document, not global — see loader.js's Reader Mode
              // restore block. Nothing to confirm on turning off: positions
              // live as sidecar files next to each PDF, not a central list
              // that needs a "clear all" step. The sidecar follows the
              // toggle at once (written when switched on, removed when
              // switched off), see setReaderTracking. A document without a
              // file of its own (untitled, never saved) has nowhere to put
              // one, so the button is disabled there — and while the
              // document is still loading, because only then is it known
              // whether the file already has a stored position.
              const doc = getActiveDocument();
              if (!doc) return;
              const ok = await setReaderTracking(doc, !doc.readerModeActive);
              if (!ok) showMessage(t('view.readerModeSaveFailed'));
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('view.panels')}>
          <RibbonButton id="ribbon-nav-panel" title={t('view.navigationPanel')} icon={navigationIcon} label={t('view.navigation')}
            disabled={noPdf()} active={!leftPanelCollapsed()} onClick={() => toggleLeftPanel()} />
          <RibbonButton id="ribbon-properties-panel" title={t('view.propertiesPanel')} icon={propertiesIcon} label={t('view.propertiesLabel')}
            disabled={noPdf()}
            active={panelVisible() && !panelCollapsed()}
            onClick={togglePropertiesPanel} />
          <RibbonButton id="ribbon-annotations-list" title={t('view.annotationsList')} icon={annotationsListIcon} label={t('view.annotationsLabel')}
            disabled={noPdf()} onClick={() => toggleAnnotationsListPanel()} />
          <RibbonButton id="ribbon-element-visibility" title={t('elementVisibility.buttonTitle')} icon={elementVisibilityIcon} label={t('elementVisibility.buttonLabel')}
            disabled={noPdf()} active={elementVisibilityPanelVisible()} onClick={toggleElementVisibilityPanel} />
          <RibbonButton id="ribbon-annotation-layers" title={t('annotationLayers.buttonTitle')} icon={annotationLayersIcon} label={t('annotationLayers.buttonLabel')}
            disabled={noPdf()} active={annotationLayersPanelVisible()} onClick={toggleAnnotationLayersPanel} />
          {/* The symbol library IS the tool palette for the user — single
              button, named accordingly. The old generic Tool Palette button
              and the plugin extension-palette buttons were removed from this
              tab on request (the palettes themselves still exist and can be
              re-exposed later if needed). */}
          <RibbonButton id="ribbon-symbol-palette" title={t('view.toolPalette')} icon={toolPaletteIcon} label={t('view.toolPaletteLabel')}
            active={symbolPaletteVisible()} onClick={toggleSymbolPalette} />
        </RibbonGroup>

        {/* Read aloud and the structure tags (#384). */}
        <RibbonGroup label={t('view.accessibilityGroup')}>
          <RibbonButton id="ribbon-read-aloud"
            title={t('view.readAloudTitle')}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 9h3l5-4v14l-5-4H4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18 6a8.5 8.5 0 010 12"/></svg>`}
            label={readAloudStatus() === 'playing' ? t('view.readAloudPause') : t('view.readAloud')}
            disabled={noPdf()}
            active={readAloudStatus() !== 'idle'}
            onClick={() => import('../../../accessibility/read-aloud.js').then((m) => {
              if (m.isReading()) m.togglePauseReadAloud();
              else m.startReadAloud();
            })} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="ribbon-tags-panel" title={t('view.tagsPanelTitle')}
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.5"/></svg>`}
              label={t('view.tagsPanel')}
              disabled={noPdf()}
              active={!leftPanelCollapsed() && leftPanelTab() === 'tags'}
              onClick={() => import('../../../ui/panels/left-panel.js').then((m) => m.switchLeftPanelTab('tags'))} />
            <RibbonButton size="small" id="ribbon-accessibility-check" title={t('view.accessibilityCheckTitle')}
              icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`}
              label={t('view.accessibilityCheck')}
              disabled={noPdf()}
              onClick={() => openDialog('accessibility-report')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('view.appearance')}>
          <ThemePicker />
        </RibbonGroup>

        <RibbonGroup label={t('view.compareGroup') || 'Compare'}>
          <RibbonButton id="ribbon-compare"
            title={t('compare.title') || 'Compare PDFs'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="8" height="16"/><rect x="13" y="4" width="8" height="16"/><line x1="11" y1="12" x2="13" y2="12"/></svg>`}
            label={t('compare.title') || 'Compare'}
            disabled={(state.documents?.length || 0) < 1}
            active={compareActive()}
            onClick={() => {
              if (compareActive()) exitCompare();
              else openDialog('compare', {});
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('view.window') || 'Window'}>
          <RibbonButton id="ribbon-fullscreen"
            title={t('view.fullscreen') || 'Fullscreen'}
            icon={isFullscreen() ? fullscreenExitIcon : fullscreenIcon}
            label={t('view.fullscreen') || 'Fullscreen'}
            active={isFullscreen()}
            onClick={() => toggleFullscreen()} />
          <RibbonButton id="ribbon-keystroke-overlay"
            title={t('view.keystrokesHint')}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="1"/><line x1="6" y1="10" x2="6" y2="10.01"/><line x1="10" y1="10" x2="10" y2="10.01"/><line x1="14" y1="10" x2="14" y2="10.01"/><line x1="18" y1="10" x2="18" y2="10.01"/><line x1="7" y1="14" x2="17" y2="14"/></svg>`}
            label={t('view.keystrokes')}
            active={keystrokeOverlayVisible()}
            onClick={toggleKeystrokeOverlay} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
