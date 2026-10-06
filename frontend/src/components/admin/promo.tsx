import { Badge, type Tone } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { PromoStatus } from "@/lib/types";

/** The four states a coupon or discount can be in — one map, one look. */
const PROMO_TONE: Record<PromoStatus, Tone> = {
  active: "positive",
  scheduled: "info",
  expired: "neutral",
  inactive: "warning",
};

const PROMO_LABEL: Record<PromoStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

export function PromoBadge({ status }: { status: PromoStatus }) {
  return <Badge tone={PROMO_TONE[status]}>{PROMO_LABEL[status]}</Badge>;
}

/** "No time limit" / "3 Oct 2026 – 31 Oct 2026" / "Until 31 Oct 2026". */
export function promoWindow(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return "No time limit";
  if (!startsAt) return `Until ${formatDate(endsAt!)}`;
  if (!endsAt) return `From ${formatDate(startsAt)}`;
  return `${formatDate(startsAt)} – ${formatDate(endsAt)}`;
}

/**
 * ISO -> `datetime-local` input value in the *browser's* timezone (the input
 * shows local time; the payload is converted back with `new Date().toISOString()`).
 */
export function toDateTimeLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Empty/invalid input -> undefined (leave the field out of the PATCH). */
export function parseAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
