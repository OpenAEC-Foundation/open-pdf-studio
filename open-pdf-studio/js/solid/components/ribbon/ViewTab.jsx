import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import ThemePicker from './ThemePicker.jsx';
import { singlePageIcon, continuousIcon, bookViewIcon, facingPagesIcon, navigationIcon, propertiesIcon, annotationsListIcon, toolPaletteIcon, fullscreenIcon, fullscreenExitIcon, elementVisibilityIcon, rotateLeftIcon, rotateRightIcon } from '../../data/ribbonIcons.js';
import { isFullscreen } from '../../stores/ribbonStore.js';
import { toggleFullscreen } from '../../../ui/chrome/fullscreen.js';
import { toggleSymbolPalette } from '../SymbolPalette.jsx';
import { symbolPaletteVisible } from '../../stores/symbolStore.js';
import { toggleKeystrokeOverlay, keystrokeOverlayVisible } from '../KeystrokeOverlay.jsx';
import { setViewMode } from '../../../pdf/renderer.js';
import { redrawAnnotations } from '../../../annotations/rendering.js';
import { toggleLeftPanel } from '../../../ui/panels/left-panel.js';
import { toggleAnnotationsListPanel } from '../../../ui/panels/annotations-list.js';
import { togglePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { panelVisible, panelCollapsed } from '../../stores/propertiesStore.js';
import { panelVisible as elementVisibilityPanelVisible, toggleElementVisibilityPanel } from '../../stores/elementVisibilityStore.js';
import { collapsed as leftPanelCollapsed } from '../../stores/leftPanelStore.js';
import { state, noPdf, getActiveDocument, getPageRotation } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { rotatePage } from '../../../pdf/renderer.js';
import { recordPageRotation } from '../../../core/undo-manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { compareActive, exitCompare } from '../../../compare/compare-store.js';

export default function ViewTab() {
  const { t } = useTranslation('ribbon');

  // Zelfde undo-bare paginarotatie als op de Organiseren-tab; hier ook
  // aangeboden omdat draaien tijdens het bekijken een veelgebruikte actie is.
  function rotateCurrentPage(delta) {
    const doc = getActiveDocument();
    const pg = doc ? doc.currentPage : 1;
    const oldRot = getPageRotation(pg);
    rotatePage(delta);
    recordPageRotation(pg, oldRot, getPageRotation(pg));
  }

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
            <RibbonButton size="small" id="view-rotate-left" title={t('home.rotateLeft')} icon={rotateLeftIcon} label={t('home.rotateLeft')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => rotateCurrentPage(-90)} />
            <RibbonButton size="small" id="view-rotate-right" title={t('home.rotateRight')} icon={rotateRightIcon} label={t('home.rotateRight')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => rotateCurrentPage(90)} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('view.display') || 'Display'}>
          <RibbonButton id="thin-lines-toggle"
            title={t('view.thinLines') || 'Thin Lines'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="6" x2="21" y2="6" stroke-width="0.5"/><line x1="3" y1="12" x2="21" y2="12" stroke-width="1.5"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="0.5"/></svg>`}
            label={t('view.thinLines') || 'Thin Lines'}
            disabled={noPdf()}
            active={state.preferences?.thinLines}
            onClick={() => {
              state.preferences.thinLines = !state.preferences.thinLines;
              import('../../../pdf/renderer.js').then(m => {
                const doc = state.documents[state.activeDocumentIndex];
                if (doc) m.renderPage(doc.currentPage);
              });
              redrawAnnotations();
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
          {/* The symbol library IS the tool palette for the user — single
              button, named accordingly. The old generic Tool Palette button
              and the plugin extension-palette buttons were removed from this
              tab on request (the palettes themselves still exist and can be
              re-exposed later if needed). */}
          <RibbonButton id="ribbon-symbol-palette" title="Toolpalette" icon={toolPaletteIcon} label="Toolpalette"
            active={symbolPaletteVisible()} onClick={toggleSymbolPalette} />
        </RibbonGroup>

        <RibbonGroup label={t('view.appearance')}>
          <ThemePicker />
        </RibbonGroup>

        <RibbonGroup label={t('view.compareGroup') || 'Compare'}>
          <RibbonButton id="ribbon-compare"
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

        <RibbonGroup label={t('view.window') || 'Window'}>
          <RibbonButton id="ribbon-fullscreen"
            title={(t('view.fullscreen') || 'Fullscreen') + ' (Ctrl+L / F11)'}
            icon={isFullscreen() ? fullscreenExitIcon : fullscreenIcon}
            label={t('view.fullscreen') || 'Fullscreen'}
            active={isFullscreen()}
            onClick={() => toggleFullscreen()} />
          <RibbonButton id="ribbon-keystroke-overlay"
            title="Toon ingedrukte sneltoetsen links onderin (voor video-opnames)"
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="1"/><line x1="6" y1="10" x2="6" y2="10.01"/><line x1="10" y1="10" x2="10" y2="10.01"/><line x1="14" y1="10" x2="14" y2="10.01"/><line x1="18" y1="10" x2="18" y2="10.01"/><line x1="7" y1="14" x2="17" y2="14"/></svg>`}
            label="Sneltoetsen"
            active={keystrokeOverlayVisible()}
            onClick={toggleKeystrokeOverlay} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
