import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { normalizeSectionOrder, moveSection } from './property-section-order.js';

export const [propertySectionOrder, setPropertySectionOrder] = createSignal(normalizeSectionOrder());
export function hydratePropertySectionOrder() {
  setPropertySectionOrder(normalizeSectionOrder(state.preferences?.propertySectionOrder));
}
function persist(order) {
  setPropertySectionOrder(order);
  if (state.preferences) state.preferences.propertySectionOrder = order;
  savePreferences();
}
export function reorderPropertySection(source, target, after = false) {
  persist(moveSection(propertySectionOrder(), source, target, after));
}
export function resetPropertySectionOrder() { persist(normalizeSectionOrder()); }
