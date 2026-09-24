// De laagnaam in XFDF (#468). XFDF kent geen lagen; de naam reist mee in het
// eigen attribuut `opslayer` — een naam en geen id, want een XFDF-bestand gaat
// van document naar document. De standaardlaag schrijft geen attribuut, zodat
// de uitvoer van een document zonder lagen gelijk blijft.

import {
  DEFAULT_LAYER_ID, layerOf, resolveLayer, addLayer,
} from './annotatie-lagen.js';

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** ` opslayer="…"` voor een annotatie op een eigen laag, anders ''. */
export function laagAttribuut(doc, ann) {
  if (!doc) return '';
  const laag = layerOf(doc, ann);
  if (!laag || laag.id === DEFAULT_LAYER_ID) return '';
  return ` opslayer="${escapeXml(laag.name)}"`;
}

/**
 * De laag bij een `opslayer`-waarde: een bestaande op naam, anders een nieuwe
 * met die naam. Zonder waarde de standaardlaag.
 * @returns {{id:string, nieuw:boolean}}
 */
export function laagUitAttribuut(doc, naam) {
  if (!doc || typeof naam !== 'string' || !naam.trim()) return { id: DEFAULT_LAYER_ID, nieuw: false };
  const bestaand = resolveLayer(doc, naam);
  if (bestaand && bestaand.id !== DEFAULT_LAYER_ID) return { id: bestaand.id, nieuw: false };
  const r = addLayer(doc, { name: naam });
  return r.ok ? { id: r.layer.id, nieuw: true } : { id: DEFAULT_LAYER_ID, nieuw: false };
}
