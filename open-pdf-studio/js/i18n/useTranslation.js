import { createSignal } from 'solid-js';
import i18next, { isRTL, loadLocale, LANGUAGES } from './config.js';

const [language, setLanguage] = createSignal(i18next.language || 'en');

i18next.on('languageChanged', (lng) => {
  setLanguage(lng);
  const dir = isRTL(lng) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lng);
});

const FARSI_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const ARABIC_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];

function convertDigits(str, lang) {
  if (typeof str !== 'string') return str;
  const digits = lang === 'fa' ? FARSI_DIGITS : lang === 'ar' ? ARABIC_DIGITS : null;
  if (!digits) return str;
  return str.replace(/[0-9]/g, d => digits[d]);
}

export function localizeNumber(num) {
  return convertDigits(String(num), language());
}

export function useTranslation(ns = 'common') {
  const namespaces = Array.isArray(ns) ? ns : [ns];
  const t = (key, options) => {
    const lang = language();
    const result = i18next.t(key, { ns: namespaces[0], ...options });
    return convertDigits(result, lang);
  };
  return { t, i18n: i18next, language };
}

export async function changeLanguage(lang) {
  let finalLang = lang;
  if (lang === 'auto') {
    const detected = i18next.services.languageDetector.detect();
    const resolvedLang = Array.isArray(detected) ? detected[0] : detected;
    const baseLang = resolvedLang ? resolvedLang.split('-')[0] : 'en';
    finalLang = LANGUAGES.some((l) => l.code === baseLang) ? baseLang : 'en';
  }
  // Locales load lazily; make sure the target language's bundles are in
  // before switching so there is no flash of untranslated keys.
  await loadLocale(finalLang);
  return i18next.changeLanguage(finalLang);
}

export { language };
