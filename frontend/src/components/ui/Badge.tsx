import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ORDER_STATUS_LABELS } from "@/lib/format";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

export type Tone = "neutral" | "info" | "positive" | "warning" | "negative";

/**
 * Generic tone chips. Every colour comes from a design token — never a
 * hardcoded hex. `danger` (not `deal`) carries errors and destructive states.
 */
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-muted",
  info: "bg-info/10 text-info",
  positive: "bg-success/10 text-success",
  warning: "bg-warning/20 text-ink",
  negative: "bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "label inline-flex items-center rounded-full px-2.5 py-1 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The one and only order-status chip (storefront + admin).
 *
 * Palette (dot colour is the spec colour, token-for-token):
 *   Pending #9A9E96 · Confirmed #2563A8 · Processing(packed) #E9A100
 *   Out for delivery(shipped) #0F5C3A · Delivered #1F8A4C · Cancelled #C62F2F
 *
 * Structure is deliberately uniform — soft tint + colour dot + ink label —
 * so the mid-tone status colours stay legible on white and on the tint.
 */
const STATUS_STYLE: Record<OrderStatus, { chip: string; dot: string }> = {
  pending: { chip: "bg-surface-2", dot: "bg-ink-faint" },
  confirmed: { chip: "bg-info/10", dot: "bg-info" },
  packed: { chip: "bg-warning/20", dot: "bg-warning" },
  shipped: { chip: "bg-brand-700/10", dot: "bg-brand-700" },
  delivered: { chip: "bg-success/12", dot: "bg-success" },
  cancelled: { chip: "bg-danger/10", dot: "bg-danger" },
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap text-ink",
        style.chip,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone: Tone =
    status === "paid" ? "positive" : status === "failed" ? "negative" : status === "refunded" ? "warning" : "neutral";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}
