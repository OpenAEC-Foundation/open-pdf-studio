import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { aboutIcon, shortcutsIcon, updatesIcon, fileAssocIcon } from '../../data/ribbonIcons.js';
import { openBackstage, setActivePanel } from '../../stores/backstageStore.js';
import { showPreferencesDialog } from '../../../core/preferences.js';

export default function HelpTab() {
  return (
    <div class="ribbon-content active" id="tab-help">
      <div class="ribbon-groups">
        <RibbonGroup label="Information">
          <RibbonButton
            id="ribbon-about"
            title="About Open PDF Studio"
            icon={aboutIcon}
            label="About"
            onClick={() => { openBackstage(); setActivePanel('about'); }}
          />
          <RibbonButton
            id="ribbon-shortcuts"
            title="Keyboard Shortcuts (F1)"
            icon={shortcutsIcon}
            label="Shortcuts"
            onClick={() => {
              const shortcuts = `Keyboard Shortcuts:\n\nFILE:\nCtrl+N - New Document\nCtrl+O - Open PDF\nCtrl+S - Save\nCtrl+P - Print\nCtrl+W - Close\n\nEDIT:\nCtrl+Z - Undo\nCtrl+Y / Ctrl+Shift+Z - Redo\nDelete - Delete selected annotation\nCtrl+Shift+C - Clear page annotations\n\nVIEW:\nCtrl++ - Zoom In\nCtrl+- - Zoom Out\nCtrl+0 - Actual Size\nCtrl+1 - Fit Width\nCtrl+2 - Fit Page\n\nTOOLS:\nV - Select Tool\n1 - Highlight\n2 - Freehand\n3 - Line\n4 - Rectangle\n5 - Ellipse\nT - Text Box\nN - Note`;
              alert(shortcuts);
            }}
          />
        </RibbonGroup>

        <RibbonGroup label="Updates">
          <RibbonButton
            id="ribbon-check-updates"
            title="Check for Updates"
            icon={updatesIcon}
            label="Updates"
            onClick={() => import('../../../ui/chrome/updater.js').then(m => m.checkForUpdates(false))}
          />
        </RibbonGroup>

        <RibbonGroup label="File Association">
          <RibbonButton
            id="ribbon-file-assoc"
            title="Set Default PDF Application"
            icon={fileAssocIcon}
            label="File Associations"
            onClick={() => showPreferencesDialog('fileassoc')}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
