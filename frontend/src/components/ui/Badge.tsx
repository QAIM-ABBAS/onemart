import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ORDER_STATUS_LABELS, orderStatusTone, type Tone } from "@/lib/format";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

const toneClasses: Record<Tone, string> = {
  neutral: "border-line-strong bg-mist text-ink-soft",
  info: "border-forest/30 bg-forest/8 text-forest",
  positive: "border-leaf/40 bg-leaf/10 text-leaf",
  warning: "border-amber/40 bg-amber/10 text-amber",
  negative: "border-brick/40 bg-brick/8 text-brick",
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
        "label inline-flex items-center border px-2 py-1 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge tone={orderStatusTone(status)} className={className}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const tone: Tone =
    status === "paid" ? "positive" : status === "failed" ? "negative" : status === "refunded" ? "warning" : "neutral";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}
