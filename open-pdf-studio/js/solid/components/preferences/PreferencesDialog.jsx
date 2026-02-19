import { createSignal, Switch, Match, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { DEFAULT_PREFERENCES } from '../../../core/constants.js';
import { state } from '../../../core/state.js';
import { savePreferences, applyTheme } from '../../../core/preferences.js';

import GeneralTab from './GeneralTab.jsx';
import AnnotationsTab from './AnnotationsTab.jsx';
import DrawingTab from './DrawingTab.jsx';
import ShapesTab from './ShapesTab.jsx';
import MarkupTab from './MarkupTab.jsx';
import BehaviorTab from './BehaviorTab.jsx';
import FileAssocTab from './FileAssocTab.jsx';
import VirtualPrinterTab from './VirtualPrinterTab.jsx';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'markup', label: 'Markup' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'fileassoc', label: 'File Association' },
  { id: 'vprinter', label: 'Virtual Printer' },
];

function createPrefSignals(source) {
  const signals = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    const val = source[key] !== undefined ? source[key] : DEFAULT_PREFERENCES[key];
    signals[key] = createSignal(val);
  }
  return signals;
}

export default function PreferencesDialog(props) {
  const initialTab = props.data?.tab || 'general';
  const [activeTab, setActiveTab] = createSignal(initialTab);

  const prefs = createPrefSignals(state.preferences);

  function close() {
    closeDialog('preferences');
  }

  function handleSave() {
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      state.preferences[key] = prefs[key][0]();
    }
    savePreferences();
    applyTheme(state.preferences.theme);
    close();
  }

  function handleReset() {
    if (confirm('Reset all preferences to default values?')) {
      for (const key of Object.keys(DEFAULT_PREFERENCES)) {
        prefs[key][1](DEFAULT_PREFERENCES[key]);
      }
    }
  }

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={handleReset}>Reset to Defaults</button>
      <div class="pref-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
        <button class="pref-btn pref-btn-primary" onClick={handleSave}>Save</button>
      </div>
    </>
  );

  return (
    <Dialog
      title="Preferences"
      overlayClass="preferences-overlay"
      dialogClass="preferences-dialog"
      headerClass="preferences-header"
      bodyClass="preferences-body-wrapper"
      footerClass="preferences-footer"
      onClose={close}
      footer={footer}
    >
      <div class="preferences-content">
        <div class="pref-tabs">
          <For each={TABS}>
            {(tab) => (
              <button
                class="pref-tab"
                classList={{ active: activeTab() === tab.id }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div class="pref-tab-content active">
          <Switch>
            <Match when={activeTab() === 'general'}>
              <GeneralTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'annotations'}>
              <AnnotationsTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'drawing'}>
              <DrawingTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'shapes'}>
              <ShapesTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'markup'}>
              <MarkupTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'behavior'}>
              <BehaviorTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'fileassoc'}>
              <FileAssocTab />
            </Match>
            <Match when={activeTab() === 'vprinter'}>
              <VirtualPrinterTab />
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  );
}
