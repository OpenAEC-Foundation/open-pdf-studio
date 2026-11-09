import { Show, createEffect, createSignal, lazy } from 'solid-js';
import { compareActive } from '../../../compare/compare-store.js';

// Schil voor de vergelijkingsweergave (CompareView.jsx, #454). De weergave en
// haar renderers laden pas bij de eerste vergelijking als eigen chunk. Eenmaal
// geladen blijft ze gemonteerd, net als voorheen: CompareView ruimt bij het
// stoppen zelf zijn caches op en houdt zijn eigen toetsafhandeling.

const CompareViewImpl = lazy(() => import('./CompareView.jsx'));

export default function CompareView() {
  const [ooitActief, setOoitActief] = createSignal(false);
  createEffect(() => {
    if (compareActive()) setOoitActief(true);
  });
  return (
    <Show when={ooitActief()}>
      <CompareViewImpl />
    </Show>
  );
}
