import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { Lang } from '@/i18n';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current: Lang = i18n.language === 'en' ? 'en' : 'fa';

  const set = (lng: Lang) => {
    if (lng !== current) void i18n.changeLanguage(lng);
  };

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        'inline-flex items-center rounded-md border border-brand-700 bg-brand-800 p-0.5 text-xs font-semibold',
        className,
      )}
    >
      {(['fa', 'en'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => set(lng)}
          aria-pressed={current === lng}
          className={cn(
            'rounded px-2.5 py-1.5 uppercase transition',
            current === lng
              ? 'bg-surface text-ink shadow-card'
              : 'text-brand-200 hover:text-surface',
          )}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}
