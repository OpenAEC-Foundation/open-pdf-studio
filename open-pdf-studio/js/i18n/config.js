import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Locale bundles are loaded on demand, one language at a time, instead of
// statically importing all 37 languages (296 JSON files) into the entry
// chunk. Only English (the fallback) and the active language are fetched at
// startup; switching language fetches that language's 8 namespace files on
// first use. This keeps the main bundle small and startup parse/init fast.
const localeModules = import.meta.glob('./locales/*/*.json');

const ns = ['common', 'ribbon', 'preferences', 'dialogs', 'appMenu', 'properties', 'context', 'statusbar'];

export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', englishName: 'Auto-detect' },
  { code: 'ar', name: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'bn', name: 'বাংলা', englishName: 'Bengali' },
  { code: 'bg', name: 'Български', englishName: 'Bulgarian' },
  { code: 'ca', name: 'Català', englishName: 'Catalan' },
  { code: 'zh', name: '中文', englishName: 'Chinese' },
  { code: 'hr', name: 'Hrvatski', englishName: 'Croatian' },
  { code: 'cs', name: 'Čeština', englishName: 'Czech' },
  { code: 'da', name: 'Dansk', englishName: 'Danish' },
  { code: 'nl', name: 'Nederlands', englishName: 'Dutch' },
  { code: 'en', name: 'English', englishName: 'English' },
  { code: 'fa', name: 'فارسی', englishName: 'Farsi', dir: 'rtl' },
  { code: 'fi', name: 'Suomi', englishName: 'Finnish' },
  { code: 'fr', name: 'Français', englishName: 'French' },
  { code: 'de', name: 'Deutsch', englishName: 'German' },
  { code: 'el', name: 'Ελληνικά', englishName: 'Greek' },
  { code: 'he', name: 'עברית', englishName: 'Hebrew', dir: 'rtl' },
  { code: 'hi', name: 'हिन्दी', englishName: 'Hindi' },
  { code: 'hu', name: 'Magyar', englishName: 'Hungarian' },
  { code: 'id', name: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'it', name: 'Italiano', englishName: 'Italian' },
  { code: 'ja', name: '日本語', englishName: 'Japanese' },
  { code: 'ko', name: '한국어', englishName: 'Korean' },
  { code: 'ms', name: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'nb', name: 'Norsk', englishName: 'Norwegian' },
  { code: 'pl', name: 'Polski', englishName: 'Polish' },
  { code: 'pt', name: 'Português', englishName: 'Portuguese' },
  { code: 'ro', name: 'Română', englishName: 'Romanian' },
  { code: 'ru', name: 'Русский', englishName: 'Russian' },
  { code: 'sr', name: 'Српски', englishName: 'Serbian' },
  { code: 'sk', name: 'Slovenčina', englishName: 'Slovak' },
  { code: 'es', name: 'Español', englishName: 'Spanish' },
  { code: 'sw', name: 'Kiswahili', englishName: 'Swahili' },
  { code: 'sv', name: 'Svenska', englishName: 'Swedish' },
  { code: 'ta', name: 'தமிழ்', englishName: 'Tamil' },
  { code: 'th', name: 'ไทย', englishName: 'Thai' },
  { code: 'tr', name: 'Türkçe', englishName: 'Turkish' },
  { code: 'uk', name: 'Українська', englishName: 'Ukrainian' },
  { code: 'ur', name: 'اردو', englishName: 'Urdu', dir: 'rtl' },
  { code: 'vi', name: 'Tiếng Việt', englishName: 'Vietnamese' },
];

export const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ur'];

export function isRTL(lang) {
  return RTL_LANGUAGES.includes(lang);
}

function isKnownLanguage(lng) {
  return LANGUAGES.some((l) => l.code === lng);
}

// Fetch all 8 namespace bundles for one language. Missing files are skipped
// (same effect as the language simply not providing that namespace).
async function fetchLocale(lng) {
  const bundles = {};
  await Promise.all(ns.map(async (n) => {
    const importer = localeModules[`./locales/${lng}/${n}.json`];
    if (!importer) return;
    const mod = await importer();
    bundles[n] = mod.default || mod;
  }));
  return bundles;
}

const loadedLanguages = new Set();

// Load a language into i18next on demand. Idempotent; unknown codes no-op.
export async function loadLocale(lng) {
  const base = (lng || '').split('-')[0];
  if (!base || loadedLanguages.has(base) || !isKnownLanguage(base)) return;
  const bundles = await fetchLocale(base);
  Object.entries(bundles).forEach(([n, data]) => {
    i18next.addResourceBundle(base, n, data, true, true);
  });
  loadedLanguages.add(base);
}

// Mirror the LanguageDetector order (localStorage, then navigator) so the
// language it will pick is already loaded before init.
function detectInitialLanguage() {
  try {
    const stored = localStorage.getItem('i18nextLng');
    if (stored) return stored.split('-')[0];
  } catch (_) { /* storage unavailable */ }
  return (navigator.language || 'en').split('-')[0];
}

const initialResources = { en: await fetchLocale('en') };
loadedLanguages.add('en');

const initialLng = detectInitialLanguage();
if (initialLng !== 'en' && isKnownLanguage(initialLng)) {
  initialResources[initialLng] = await fetchLocale(initialLng);
  loadedLanguages.add(initialLng);
}

i18next
  .use(LanguageDetector)
  .init({
    resources: initialResources,
    ns,
    defaultNS: 'common',
    fallbackLng: 'en',
    showSupportNotice: false,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: []
    }
  });

export default i18next;
