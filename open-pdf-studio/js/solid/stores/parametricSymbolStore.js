// Tracks the current parametric symbol selection used by the
// parametricSymbol tool when placing a new annotation.
import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { getTemplate, listTemplates, defaultParams } from '../../symbols/registry.js';

const [pendingSymbolId, setPendingSymbolIdSignal] = createSignal('door');
const [pendingParams, setPendingParamsSignal] = createSignal({});
const [pickerOpen, setPickerOpen] = createSignal(false);

export function validateSymbolParams(symbolId, values = {}) {
  const template = getTemplate(symbolId);
  const defaults = defaultParams(template);
  if (!template) return {};
  const result = { ...defaults };
  for (const def of template.params || []) {
    const raw = values[def.key];
    if (raw === undefined) continue;
    if (def.type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number)) continue;
      result[def.key] = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, number));
    } else if (def.type === 'boolean') {
      result[def.key] = raw === true;
    } else if (def.type === 'enum') {
      if ((def.options || []).some((option) => option.value === raw)) result[def.key] = raw;
    } else {
      result[def.key] = String(raw);
    }
  }
  return result;
}

export function resolveSymbolParams(symbolId) {
  return validateSymbolParams(
    symbolId,
    state.preferences.parametricSymbolDefaults?.[symbolId] || {},
  );
}

export function setPendingSymbolId(symbolId) {
  setPendingSymbolIdSignal(symbolId);
  setPendingParamsSignal(resolveSymbolParams(symbolId));
}

export function setPendingParams(values) {
  const symbolId = pendingSymbolId();
  const validated = validateSymbolParams(symbolId, values);
  setPendingParamsSignal(validated);
  state.preferences.parametricSymbolDefaults = {
    ...(state.preferences.parametricSymbolDefaults || {}),
    [symbolId]: validated,
  };
  import('../../core/preferences.js').then((module) => module.savePreferences()).catch(() => {});
}

setPendingSymbolId('door');

function getAvailableTemplates() {
  return listTemplates();
}

export {
  pendingSymbolId, pendingParams,
  pickerOpen, setPickerOpen,
  getAvailableTemplates,
};
