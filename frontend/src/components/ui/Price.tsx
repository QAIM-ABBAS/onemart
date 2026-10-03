import { cn } from "@/lib/cn";
import { money } from "@/lib/format";

import { MinusIcon, PlusIcon } from "./Icon";

export function Price({
  value,
  compareAt,
  size = "md",
  className,
}: {
  value: number;
  compareAt?: number | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-[0.9375rem]",
    lg: "text-lg",
    xl: "text-2xl",
  } as const;
  const showCompare = compareAt != null && compareAt > value;
  return (
    <span className={cn("inline-flex items-baseline gap-2 num", className)}>
      <span className={cn("font-semibold", sizes[size])}>{money(value)}</span>
      {showCompare ? (
        <span className="text-[0.8125rem] text-ink-muted line-through num">{money(compareAt)}</span>
      ) : null}
    </span>
  );
}

/**
 * Quantity stepper ( −  value  + ).
 *
 * VARIANTS:
 *  - "default"  — classic sunken well with raised round chips.
 *                 Used by Cart / Product detail / MiniCart (unchanged).
 *  - "outline"  — ONE raised bordered pill with flat − / + controls and a
 *                 big bold number in the middle (optional unit after it,
 *                 e.g. "1 kg"). Used by ProductCard to match the
 *                 reference card.
 *
 * RESPONSIVENESS (outline only): the product card sets `@container`,
 * so these sizes react to the CARD width, not the viewport:
 *   - container < 320px → compact: small buttons, number only (dense
 *     4–5 column desktop grids where the stepper only gets ~70px)
 *   - container ≥ 320px → full: bigger buttons, bigger number
 *     (phones / 1–2 column layouts — matches the reference proportions)
 */
export function QuantityStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  disabled = false,
  compact = false,
  variant = "default",
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  compact?: boolean;
  variant?: "default" | "outline";
  className?: string;
}) {
  const size = compact ? "size-8" : "h-11 w-11";
  const canDec = value > min && !disabled;
  const canInc = value < max && !disabled;

  /* ── OUTLINE VARIANT (product card) ────────────────────────────────
     h-12         : matches the Add-to-cart button height (one row)
     border-line  : subtle border like the reference
     bg-surface    : light, raised surface (white-ish in light theme)
     shadow-card  : soft elevation — the card keeps its depth
     justify-between: spreads − … number+unit … + across the 35% column
     ───────────────────────────────────────────────────────────────── */
  if (variant === "outline") {
    const btn =
      "grid size-6 shrink-0 place-items-center rounded-lg text-ink transition hover:bg-surface-2 @[320px]:size-7 disabled:opacity-30 disabled:hover:bg-transparent";
    return (
      <div
        className={cn(
          "flex h-12 items-center justify-between rounded-md border border-line bg-surface px-1 shadow-card",
          className,
        )}
      >
        <button
          type="button"
          aria-label="Decrease quantity"
          disabled={!canDec}
          onClick={() => canDec && onChange(value - 1)}
          className={btn}
        >
          <MinusIcon width={14} height={14} strokeWidth={2} className="size-3.5 @[320px]:size-4" />
        </button>

        <span
          aria-live="polite"
          className="flex min-w-0 items-baseline justify-center gap-0.5 whitespace-nowrap num font-bold text-ink"
        >
          <span className="text-sm @[320px]:text-lg">{value}</span>
        </span>

        <button
          type="button"
          aria-label="Increase quantity"
          disabled={!canInc}
          onClick={() => canInc && onChange(value + 1)}
          className={btn}
        >
          <PlusIcon width={14} height={14} strokeWidth={2} className="size-3.5 @[320px]:size-4" />
        </button>
      </div>
    );
  }

  /* ── DEFAULT VARIANT (cart / product page / mini cart) ───────────── */
  return (
    <div
      className={cn(
        "inline-grid grid-cols-[auto_1fr_auto] items-stretch rounded-md bg-surface-2 p-1 shadow-pressed",
        compact ? "text-sm" : "",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
        className={cn(
          size,
          "grid place-items-center rounded-lg bg-surface border border-line text-ink transition",
          "hover:shadow-lift hover:-translate-y-px disabled:opacity-35 disabled:shadow-none disabled:hover:translate-y-0",
        )}
      >
        <MinusIcon width={15} height={15} />
      </button>
      <span
        className={cn(
          "grid place-items-center num font-semibold min-w-9 px-1",
          compact ? "text-sm" : "text-[0.9375rem]",
        )}
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
        className={cn(
          size,
          "grid place-items-center rounded-lg bg-surface border border-line text-ink transition",
          "hover:shadow-lift hover:-translate-y-px disabled:opacity-35 disabled:shadow-none disabled:hover:translate-y-0",
        )}
      >
        <PlusIcon width={15} height={15} />
      </button>
    </div>
  );
}
