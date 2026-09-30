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
        <span className="text-[0.8125rem] text-ink-soft line-through num">{money(compareAt)}</span>
      ) : null}
    </span>
  );
}

export function QuantityStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  disabled = false,
  compact = false,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const size = compact ? "h-9 w-9" : "h-11 w-11";
  const canDec = value > min && !disabled;
  const canInc = value < max && !disabled;
  return (
    <div
      className={cn(
        "inline-grid grid-cols-[auto_1fr_auto] items-stretch border border-line-strong bg-surface rounded-sm overflow-hidden",
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
          "grid place-items-center border-r border-line-strong text-ink transition-colors",
          "hover:bg-mist disabled:opacity-35 disabled:hover:bg-transparent",
        )}
      >
        <MinusIcon width={15} height={15} />
      </button>
      <span
        className={cn(
          "grid place-items-center num font-medium min-w-10 px-1",
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
          "grid place-items-center border-l border-line-strong text-ink transition-colors",
          "hover:bg-mist disabled:opacity-35 disabled:hover:bg-transparent",
        )}
      >
        <PlusIcon width={15} height={15} />
      </button>
    </div>
  );
}
