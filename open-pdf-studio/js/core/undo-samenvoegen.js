// Voegt de wijzigstappen van één doorlopende handeling samen (#1168).
//
// Wie een getal sleept, wijzigt dezelfde annotaties tientallen keren achter
// elkaar. In de geschiedenis hoort dat één stap te zijn: per annotatie de
// toestand van vóór de eerste wijziging en die van na de laatste. Puur.

const WIJZIG = new Set(['modifyAnnotation', 'bulkModify']);

/**
 * @param {Array<object>} opdrachten  undo-opdrachten in de volgorde van uitvoeren
 * @returns {Array<object>}  één samengevoegde opdracht als alles een
 *   wijziging van annotaties was; anders de opdrachten ongewijzigd
 */
export function voegWijzigingenSamen(opdrachten) {
  if (!Array.isArray(opdrachten) || opdrachten.length < 2) return opdrachten;
  if (!opdrachten.every((c) => c && WIJZIG.has(c.type))) return opdrachten;
  /** @type {Map<string, {id: string, oldState: object, newState: object}>} */
  const perId = new Map();
  for (const c of opdrachten) {
    const items = c.type === 'bulkModify' ? (c.items || []) : [c];
    for (const { id, oldState, newState } of items) {
      const al = perId.get(id);
      if (al) al.newState = newState;
      else perId.set(id, { id, oldState, newState });
    }
  }
  const items = [...perId.values()];
  if (items.length === 0) return [];
  if (items.length === 1) return [{ type: 'modifyAnnotation', ...items[0] }];
  return [{ type: 'bulkModify', items }];
}
