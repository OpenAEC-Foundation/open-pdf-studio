import { For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';

const SHORTCUT_CATEGORIES = [
  {
    name: 'File',
    shortcuts: [
      { action: 'New Document', keys: ['Ctrl', 'N'] },
      { action: 'Open', keys: ['Ctrl', 'O'] },
      { action: 'Save', keys: ['Ctrl', 'S'] },
      { action: 'Print', keys: ['Ctrl', 'P'] },
      { action: 'Close', keys: ['Ctrl', 'W'] },
    ],
  },
  {
    name: 'Edit',
    shortcuts: [
      { action: 'Undo', keys: ['Ctrl', 'Z'] },
      { action: 'Redo', keys: ['Ctrl', 'Y'] },
      { action: 'Delete Annotation', keys: ['Del'] },
      { action: 'Select All', keys: ['Ctrl', 'A'] },
      { action: 'Copy', keys: ['Ctrl', 'C'] },
      { action: 'Paste', keys: ['Ctrl', 'V'] },
      { action: 'Paste in Place', keys: ['Ctrl', 'Shift', 'V'] },
      { action: 'Duplicate', keys: ['Ctrl', 'D'] },
      { action: 'Clear Page', keys: ['Ctrl', 'Shift', 'C'] },
    ],
  },
  {
    name: 'View',
    shortcuts: [
      { action: 'Zoom In', keys: ['Ctrl', '+'] },
      { action: 'Zoom Out', keys: ['Ctrl', '-'] },
      { action: 'Actual Size', keys: ['Ctrl', '0'] },
      { action: 'Fit Width', keys: ['Ctrl', '1'] },
      { action: 'Fit Page', keys: ['Ctrl', '2'] },
      { action: 'Rotate Page Right', keys: ['Ctrl', 'Shift', '+'] },
      { action: 'Rotate Page Left', keys: ['Ctrl', 'Shift', '-'] },
      { action: 'Thin Lines', keys: ['Ctrl', '5'] },
      { action: 'Find', keys: ['Ctrl', 'F'] },
      { action: 'Toggle Left Panel', keys: ['F9'] },
      { action: 'Toggle Annotations', keys: ['F11'] },
      { action: 'Toggle Properties', keys: ['F12'] },
    ],
  },
  {
    name: 'Tools',
    shortcuts: [
      { action: 'Select', keys: ['V'] },
      { action: 'Hand', keys: ['H'] },
      { action: 'Highlight', keys: ['1'] },
      { action: 'Freehand', keys: ['2'] },
      { action: 'Line', keys: ['3'] },
      { action: 'Rectangle', keys: ['4'] },
      { action: 'Ellipse', keys: ['5'] },
      { action: 'Text Box', keys: ['T'] },
      { action: 'Note', keys: ['N'] },
    ],
  },
];

export default function ShortcutsDialog() {
  const close = () => closeDialog('shortcuts');

  return (
    <Dialog
      title="Keyboard Shortcuts"
      dialogClass="shortcuts-dialog"
      onClose={close}
    >
      <div class="shortcuts-grid">
        <div class="shortcuts-column">
          <For each={[SHORTCUT_CATEGORIES[0], SHORTCUT_CATEGORIES[1]]}>
            {(category) => (
              <div class="shortcuts-category">
                <h3>{category.name}</h3>
                <For each={category.shortcuts}>
                  {(shortcut) => (
                    <div class="shortcuts-row">
                      <span class="shortcuts-action">{shortcut.action}</span>
                      <span class="shortcuts-keys">
                        <For each={shortcut.keys}>
                          {(key) => <kbd>{key}</kbd>}
                        </For>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div class="shortcuts-column">
          <For each={[SHORTCUT_CATEGORIES[2], SHORTCUT_CATEGORIES[3]]}>
            {(category) => (
              <div class="shortcuts-category">
                <h3>{category.name}</h3>
                <For each={category.shortcuts}>
                  {(shortcut) => (
                    <div class="shortcuts-row">
                      <span class="shortcuts-action">{shortcut.action}</span>
                      <span class="shortcuts-keys">
                        <For each={shortcut.keys}>
                          {(key) => <kbd>{key}</kbd>}
                        </For>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Dialog>
  );
}
