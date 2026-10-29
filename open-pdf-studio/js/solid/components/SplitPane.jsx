// Gesplitste weergave (#715): de scheidingslijn, het tweede paneel en het
// kader om het actieve paneel. Staat naast #pdf-container in #split-host
// (App.jsx); de regelaar (pdf/split-view/split-view.js) doet de lay-out en
// het tekenen. Zonder splitsing is #split-host `display: contents` en zijn
// deze delen verborgen: de enkelvoudige weergave is ongewijzigd.

import { onMount, createEffect, untrack } from 'solid-js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { compareActive, compareFocused } from '../../compare/compare-store.js';
import { state } from '../../core/state.js';
import { initSplitView, pasSplitLayoutToe } from '../../pdf/split-view/split-view.js';

export default function SplitPane() {
  const { t } = useTranslation('ribbon');

  onMount(() => {
    initSplitView();
    pasSplitLayoutToe();
  });

  // Het vergelijkingstabblad ligt over #pdf-container heen: zolang het voor
  // staat, geen splitsing in beeld. Ook bij een ander actief document en het
  // laden van een document (pdfDoc komt later binnen).
  createEffect(() => {
    compareActive();
    compareFocused();
    const doc = state.documents[state.activeDocumentIndex];
    doc?.pdfDoc;
    doc?.splitView;
    untrack(() => pasSplitLayoutToe());
  });

  return (
    <>
      <div id="split-divider" class="split-divider" title={t('view.splitDividerTitle')}></div>
      <div id="split-pane" class="split-pane">
        <canvas class="split-pane-pdf"></canvas>
        <canvas class="split-pane-ann"></canvas>
      </div>
      <div id="split-active-frame" class="split-active-frame"></div>
    </>
  );
}
