import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { StarIcon } from "@/components/ui/Icon";

/**
 * Read-only star row (the only star renderer — PDP, reviews, admin).
 * A fractional part ≥ 0.5 fills the next star.
 */
export function Stars({
  rating,
  size = 14,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("stars.label", { rating: formatNumber(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
      className={cn("inline-flex items-center gap-0.5 text-warning", className)}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < full || (half && i === full);
        return (
          <StarIcon
            key={i}
            width={size}
            height={size}
            fill={filled ? "currentColor" : "none"}
            className={filled ? "" : "opacity-30"}
          />
        );
      })}
    </span>
  );
}

/** Interactive 1–5 rating picker for the write/edit form. */
export function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t("stars.yourRating")} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("stars.pick", { count: formatNumber(n) })}
          onClick={() => onChange(n)}
          className={cn(
            "rounded-md p-1.5 transition hover:bg-surface-2",
            n <= value ? "text-warning" : "text-ink-faint",
          )}
        >
          <StarIcon width={24} height={24} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
      <span dir="ltr" className="ms-1.5 text-sm text-ink-muted">{value}/5</span>
    </div>
  );
}
