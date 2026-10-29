// Resolve once so startup loads the same locale that i18next will activate.
export function initialLanguage(stored, browser, supported) {
  const candidates = [stored, ...(browser?.languages || []), browser?.userLanguage, browser?.language];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const base = candidate.trim().split('-')[0].toLowerCase();
    if (base !== 'auto' && supported.includes(base)) return base;
  }
  return 'en';
}
