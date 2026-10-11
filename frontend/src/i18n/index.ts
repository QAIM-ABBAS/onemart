import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGS = ['fa', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'fa';
export const RTL_LANGS: Lang[] = ['fa'];
export const STORAGE_KEY = 'onemart_lang';

// Loads every src/i18n/locales/<lang>/<namespace>.json automatically.
const files = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }) as Record<
  string,
  Record<string, unknown>
>;
const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, content] of Object.entries(files)) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = content;
}

export function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fa' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

export function applyDocumentLang(lang: Lang) {
  const el = document.documentElement;
  el.lang = lang;
  el.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLang(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.en ?? { common: {} }),
  interpolation: { escapeValue: false },
});

applyDocumentLang(i18n.language as Lang);
i18n.on('languageChanged', (lng) => {
  applyDocumentLang(lng as Lang);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
});

export default i18n;
