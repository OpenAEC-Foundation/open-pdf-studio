// Uiterlijk van een geplaatst symbool bijwerken na een generieke
// eigenschapswijziging — pure module, geen app-imports.
//
// Een symbool is een stempel die met `drawImage()` getekend wordt: kleur en
// lijndikte moeten IN de SVG-bron staan (zie stamp-line-width.js). Het
// eigenschappenpaneel en de MCP-brug roepen daarvoor expliciet de hooks aan.
// De opmaakwerkbalk (lijnkleur, lijndikte, stijlengalerij, stijl-
// voorinstellingen) zet alleen velden via een vrije `applyFn`; zonder deze
// synchronisatie veranderde er dan niets zichtbaars (#398).

/**
 * Momentopname van de velden die het symbool-uiterlijk sturen, vóór de
 * wijziging. null voor alles wat geen SVG-symbool is.
 */
export function stampAppearanceSnapshot(ann) {
  if (!ann || ann.type !== 'stamp' || !ann.stampSvg) return null;
  return { color: ann.color, strokeColor: ann.strokeColor, lineWidth: ann.lineWidth };
}

/**
 * Vergelijk met de momentopname en zet gewijzigde kleur/dikte de SVG in via
 * de meegegeven hooks (`applyStampLineWidth`, `applyStampColor`).
 *
 * De werkbalk toont bij een symbool `strokeColor || color`; een wijziging van
 * alleen `strokeColor` (bv. een stijlvoorinstelling) wordt daarom ook naar
 * `color` doorgezet, want dat is de kleur die de hook in de SVG schrijft.
 *
 * Volgorde dikte → kleur, gelijk aan de MCP-brug.
 *
 * @returns {boolean} of er een hook is aangeroepen.
 */
export function syncStampAppearance(ann, before, hooks) {
  if (!before || !ann || ann.type !== 'stamp' || !ann.stampSvg || !hooks) return false;

  const colorChanged = ann.color !== before.color;
  const strokeChanged = ann.strokeColor !== before.strokeColor;
  if (!colorChanged && strokeChanged && ann.strokeColor) ann.color = ann.strokeColor;

  let geraakt = false;
  if (ann.lineWidth !== before.lineWidth) {
    hooks.applyStampLineWidth(ann);
    geraakt = true;
  }
  if (colorChanged || (strokeChanged && ann.strokeColor)) {
    hooks.applyStampColor(ann);
    geraakt = true;
  }
  return geraakt;
}

/**
 * Moet het beeld van een symbool opnieuw gemaakt worden nadat de annotatie
 * van toestand `before` naar `after` is teruggezet (ongedaan maken / opnieuw
 * doen)? Het raster in de beeldcache hoort bij de oude SVG; zonder nieuw
 * raster blijft de oude kleur of dikte zichtbaar terwijl de gegevens al
 * teruggezet zijn.
 */
export function stampRasterStale(before, after) {
  if (!before || !after || after.type !== 'stamp' || !after.stampSvg) return false;
  return before.stampSvg !== after.stampSvg
    || before.color !== after.color
    || before.strokeColor !== after.strokeColor
    || before.lineWidth !== after.lineWidth;
}
