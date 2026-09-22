// Floating, non-modal print progress bar (bottom-right). Shown while a
// background print job runs so the user can keep working.
import { Show } from 'solid-js';
import {
  printProgressActive, printProgressLabel, printProgressValue, printProgressError,
  printProgressActie, sluitPrintProgress,
} from '../stores/printProgressStore.js';

export default function PrintProgressToast() {
  return (
    <Show when={printProgressActive()}>
      <div class="print-progress-toast" classList={{ 'print-progress-error': printProgressError() }}>
        {/* The full text as tooltip: a saved path rarely fits on one line. */}
        <div class="print-progress-label" title={printProgressLabel()}>{printProgressLabel()}</div>
        <div class="print-progress-track">
          <div class="print-progress-fill" style={{ width: Math.round((printProgressValue() || 0) * 100) + '%' }} />
        </div>
        <Show when={printProgressActie()}>
          <div class="print-progress-actions">
            <button
              class="pref-btn pref-btn-secondary"
              onClick={() => {
                const knop = printProgressActie();
                sluitPrintProgress();
                knop?.uitvoeren?.();
              }}
            >{printProgressActie().label}</button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
