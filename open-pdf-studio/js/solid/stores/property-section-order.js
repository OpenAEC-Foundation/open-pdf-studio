// Stable identifiers, independent of translated titles and current selection.
export const DEFAULT_SECTION_ORDER = Object.freeze([
  'general', 'location', 'replies', 'appearance', 'hatchPattern', 'lineEndings',
  'ink', 'dimensions', 'measurement', 'viewport', 'scaleRegion', 'scaleBar',
  'parametricSymbol', 'gevelelement', 'stavenreeks', 'wall', 'betonbalk',
  'systeemraster', 'textFormat', 'paragraph', 'content', 'image', 'customFields',
]);

export function normalizeSectionOrder(saved) {
  const valid = Array.isArray(saved) ? saved.filter(id => DEFAULT_SECTION_ORDER.includes(id)) : [];
  return [...new Set([...valid, ...DEFAULT_SECTION_ORDER])];
}

// Move in the complete order: temporarily absent sections must not be lost.
export function moveSection(saved, source, target, after = false) {
  const order = normalizeSectionOrder(saved);
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  order.splice(order.indexOf(source), 1);
  order.splice(order.indexOf(target) + Number(after), 0, source);
  return order;
}
