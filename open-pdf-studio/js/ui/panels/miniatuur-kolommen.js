// Per-device thumbnail column preference. Zero means as many as fit.
import { leesOpslag, schrijfOpslag, verwijderOpslag } from '../../core/opslag.js';
const KEY = 'thumbnailColumns';
const listeners = new Set();
const normalize = n => Number.isSafeInteger(n) && n > 0 ? n : 0;
let chosen = 0;
try { chosen = normalize(Number(leesOpslag(KEY))); } catch { /* storage unavailable */ }
export const gekozenKolommen = () => chosen;
export function zetGekozenKolommen(value) {
  const next = normalize(value);
  if (next === chosen) return;
  chosen = next;
  try {
    if (next) schrijfOpslag(KEY, String(next));
    else verwijderOpslag(KEY);
  } catch { /* still usable for this session */ }
  for (const listener of listeners) { try { listener(next); } catch { /* notify remaining listeners */ } }
}
export function bijKolomWijziging(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
