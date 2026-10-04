import { pluralize } from "@/lib/format";
import type { RatingSummary as Summary } from "@/lib/types";

import { Stars } from "./Stars";

/**
 * Big average + star row + one bar per star. Bars are also the rating filter:
 * clicking 4★ shows only 4★ reviews (click again to clear).
 */
export function RatingSummary({
  summary,
  activeRating,
  onToggleRating,
}: {
  summary: Summary;
  activeRating?: number;
  onToggleRating?: (rating: number) => void;
}) {
  const total = summary.count;

  return (
    <div className="rounded-md border border-line bg-surface p-5">
      <div className="flex items-center gap-4">
        <p className="num text-4xl font-semibold leading-none">
          {total > 0 ? summary.average.toFixed(1) : "—"}
        </p>
        <div className="space-y-1">
          {total > 0 ? <Stars rating={summary.average} size={16} /> : null}
          <p className="text-xs text-ink-muted">
            {total > 0 ? pluralize(total, "review") : "No reviews yet"}
          </p>
        </div>
      </div>

      {total > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {summary.distribution.map((bucket) => {
            const pct = Math.round((bucket.count / total) * 100);
            const active = activeRating === bucket.rating;
            return (
              <li key={bucket.rating}>
                <button
                  type="button"
                  onClick={() => onToggleRating?.(bucket.rating)}
                  aria-pressed={active}
                  aria-label={`Show ${bucket.rating} star reviews`}
                  className={
                    "flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-xs transition hover:bg-surface-2"
                  }
                >
                  <span className="num w-8 shrink-0 text-ink-muted">{bucket.rating} ★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-warning transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="num w-6 shrink-0 text-end text-ink-muted">{bucket.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          Be the first to review this product once you have tried it.
        </p>
      )}

      {activeRating ? (
        <button
          type="button"
          onClick={() => onToggleRating?.(activeRating)}
          className="mt-3 text-xs font-medium text-brand-600 underline-offset-4 hover:underline"
        >
          Showing {activeRating}★ only — clear filter
        </button>
      ) : null}
    </div>
  );
}
