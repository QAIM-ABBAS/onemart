import { useTranslation } from 'react-i18next';
import { RTL_LANGS, type Lang } from '@/i18n';

export function useDirection() {
  const { i18n } = useTranslation();
  const lang = (i18n.language === 'en' ? 'en' : 'fa') as Lang;
  const isRTL = RTL_LANGS.includes(lang);
  return { lang, isRTL, dir: isRTL ? ('rtl' as const) : ('ltr' as const) };
}
