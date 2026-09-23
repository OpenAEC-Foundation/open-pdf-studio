import { isMobile } from '../core/platform.js';
import MobileApp from './MobileApp.jsx';
import TitleBar from './components/TitleBar.jsx';
import Ribbon from './components/ribbon/Ribbon.jsx';
import DocumentTabs from './components/DocumentTabs.jsx';
import CanvasScrollbars from './components/CanvasScrollbars.jsx';
import LeftPanel from './components/left-panel/LeftPanel.jsx';
import ElementVisibilityPanel from './components/left-panel/ElementVisibilityPanel.jsx';
import FindBar from './components/FindBar.jsx';
import FormFieldsBar from './components/FormFieldsBar.jsx';
import PdfABar from './components/PdfABar.jsx';
import HandtekeningBar from './components/HandtekeningBar.jsx';
import NotificationBar from './components/NotificationBar.jsx';
import PropertiesPanel from './components/properties-panel/PropertiesPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import AppMenu from './components/app-menu/AppMenu.jsx';
import DialogHost from './components/DialogHost.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';
import TypeLengthHUD from './components/TypeLengthHUD.jsx';
import KeystrokeOverlay from './components/KeystrokeOverlay.jsx';
import BoxSizeOverlay from './components/BoxSizeOverlay.jsx';
import SketchModeBar from './components/SketchModeBar.jsx';
import CompareView from './components/compare/CompareView.jsx';
import { DockedToolPalette, FloatingToolPalette, DockTargets, PaletteContextMenu } from './components/ToolPalette.jsx';
import { DockedExtPalette, FloatingExtPalette, ExtDockTargets } from './components/ExtensionToolPalette.jsx';
import { DockedSymbolPalette, FloatingSymbolPalette, SymbolSettingsDialog } from './components/SymbolPalette.jsx';
import SchedulePanel from './components/SchedulePanel.jsx';
import SymbolTypeEditor from './components/symbol-edit/SymbolTypeEditor.jsx';
import MiniLog from './components/MiniLog.jsx';
import AssistantPanel from './components/AssistantPanel.jsx';
import { getRegisteredPalettes } from '../plugins/palette-registry.js';
import { leftOrder, rightOrder } from './stores/paletteOrder.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { isTauri } from '../core/platform.js';
import { meldLegeStart, WEB_SESSIE_SLEUTEL } from '../core/sessie-herstel.js';
import { For, ErrorBoundary, Show } from 'solid-js';

function OrderedDockedPalettes(props) {
  const order = () => props.side === 'left' ? leftOrder() : rightOrder();
  const extPalettes = () => getRegisteredPalettes();

  // Build list of all palette ids: 'tool' (built-in) + extension palette ids
  const allIds = () => {
    const o = order();
    const extIds = extPalettes().map(p => p.id);
    const all = ['tool', 'symbols', ...extIds];
    // Ordered ones first, then any remaining (for palettes not yet in the order list)
    const ordered = [...o.filter(id => all.includes(id)), ...all.filter(id => !o.includes(id))];
    // Right side: first docked should be closest to the edge (rightmost in DOM), so reverse
    return props.side === 'right' ? ordered.slice().reverse() : ordered;
  };

  return (
    <For each={allIds()}>
      {(id) => {
        if (id === 'tool') {
          return <DockedToolPalette side={props.side} />;
        }
        if (id === 'symbols') {
          return <DockedSymbolPalette side={props.side} />;
        }
        const descriptor = extPalettes().find(p => p.id === id);
        return descriptor ? <DockedExtPalette side={props.side} descriptor={descriptor} /> : null;
      }}
    </For>
  );
}

function DesktopApp() {
  const { t } = useTranslation('common');
  const extPalettes = () => getRegisteredPalettes();

  return (
    <>
      <TitleBar />

      <div class="ribbon-container">
        <Ribbon />
      </div>

      <NotificationBar />
      <DocumentTabs />

      <div class="content">
        <LeftPanel />
        <ElementVisibilityPanel />
        <OrderedDockedPalettes side="left" />

        <div class="main-view">
          <DockTargets />
          <For each={extPalettes()}>
            {(p) => <ExtDockTargets descriptor={p} />}
          </For>
          <FindBar />

          <div id="placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h2>{t('noDocuments')}</h2>
            <p>{t('noDocumentsHint')}</p>
            {/* De webversie bewaart geen sessie. Dat zeggen is eerlijker dan
                een voorkeur die daar nooit iets doet (#456). */}
            <Show when={meldLegeStart({ inTauri: isTauri() })}>
              <p class="placeholder-note">{t(WEB_SESSIE_SLEUTEL)}</p>
            </Show>
          </div>

          <FormFieldsBar />

          <PdfABar />

          <HandtekeningBar />

          <div id="pdf-container">
            <div id="canvas-wrapper">
              <div id="canvas-container" class="single-page-container">
                <canvas id="pdf-canvas"></canvas>
                <canvas id="text-highlight-canvas"></canvas>
                <canvas id="annotation-canvas"></canvas>
              </div>
              <div id="continuous-container" class="continuous-container"></div>
            </div>
            <CanvasScrollbars />
            <CompareView />
          </div>
        </div>

        <OrderedDockedPalettes side="right" />
        <PropertiesPanel />
      </div>

      <StatusBar />

      <AppMenu />
      <DialogHost />
      <ContextMenu />
      <FloatingToolPalette />
      <FloatingSymbolPalette />
      <For each={extPalettes()}>
        {(p) => <FloatingExtPalette descriptor={p} />}
      </For>
      <PaletteContextMenu />
      <SymbolSettingsDialog />
      <SymbolTypeEditor />
      <SchedulePanel />
      <AssistantPanel />
      {/* MiniLog floating engine-log overlay removed per user request. */}
      <LoadingOverlay />
      <TypeLengthHUD />
      <KeystrokeOverlay />
      <BoxSizeOverlay />
      <SketchModeBar />
    </>
  );
}

export default function App() {
  if (isMobile()) {
    return <MobileApp />;
  }
  return <DesktopApp />;
}
