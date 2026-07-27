// Voorinstelling voor de betonbalk: de laatst gekozen doorsnede (b×h) —
// zelfde idee als pendingParams bij de parametrische symbolen. De volgende
// geplaatste balk krijgt automatisch deze doorsnede; de keuzelijst in het
// eigenschappen-paneel werkt hem bij.
import { createSignal } from 'solid-js';
import { BETONBALK_DEFAULTS } from '../../annotations/betonbalk.js';

const [lastProfiel, setLastProfielSignal] = createSignal({
  breedteMm: BETONBALK_DEFAULTS.breedteMm,
  hoogteMm: BETONBALK_DEFAULTS.hoogteMm,
});

export { lastProfiel as betonbalkLastProfiel };

export function setBetonbalkLastProfiel(breedteMm, hoogteMm) {
  const b = Number(breedteMm), h = Number(hoogteMm);
  const cur = lastProfiel();
  setLastProfielSignal({
    breedteMm: Number.isFinite(b) && b > 0 ? b : cur.breedteMm,
    hoogteMm: Number.isFinite(h) && h > 0 ? h : cur.hoogteMm,
  });
}
