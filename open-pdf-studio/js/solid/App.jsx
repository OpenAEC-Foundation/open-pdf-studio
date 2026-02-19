import TitleBar from './components/TitleBar.jsx';
import Ribbon from './components/ribbon/Ribbon.jsx';
import DocumentTabs from './components/DocumentTabs.jsx';
import LeftPanel from './components/left-panel/LeftPanel.jsx';
import FindBar from './components/FindBar.jsx';
import FormFieldsBar from './components/FormFieldsBar.jsx';
import PdfABar from './components/PdfABar.jsx';
import PropertiesPanel from './components/properties-panel/PropertiesPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import Backstage from './components/backstage/Backstage.jsx';
import DialogHost from './components/DialogHost.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';

export default function App() {
  return (
    <>
      <TitleBar />

      <div class="ribbon-container">
        <Ribbon />
      </div>

      <DocumentTabs />

      <div class="content">
        <LeftPanel />

        <div class="main-view">
          <FindBar />

          <div id="placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h2>No PDF Selected</h2>
            <p>Click "Open PDF" to browse and annotate a PDF</p>
          </div>

          <FormFieldsBar />

          <PdfABar />

          <div id="pdf-container">
            <div id="canvas-wrapper">
              <div id="canvas-container" class="single-page-container">
                <canvas id="pdf-canvas"></canvas>
                <canvas id="annotation-canvas"></canvas>
              </div>
              <div id="continuous-container" class="continuous-container"></div>
            </div>
          </div>
        </div>

        <PropertiesPanel />
      </div>

      <StatusBar />

      <Backstage />
      <DialogHost />
      <ContextMenu />
      <LoadingOverlay />
    </>
  );
}
