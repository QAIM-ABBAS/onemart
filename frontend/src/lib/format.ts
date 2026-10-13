import i18n from "@/i18n";
import type { OrderStatus, PaymentStatus, UserRole } from "./types";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function money(value: number): string {
  return inr.format(value);
}

const loc = () => (i18n.language === "fa" ? "fa-IR" : "en-US");

export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(loc(), opts).format(n);

// Keep the SAME decimals the app already uses for prices (maximumFractionDigits: 2).
export const formatPrice = (amount: number, opts?: Intl.NumberFormatOptions) =>
  `${formatNumber(amount, { maximumFractionDigits: 2, ...opts })} ${i18n.t("common:currency")}`;

export function formatDate(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(
    loc(),
    opts ?? { day: "numeric", month: "short", year: "numeric" },
  ).format(new Date(iso));
}

export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat(loc(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ORDER_FLOW: OrderStatus[] = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
];

export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return titleCase(status);
}

export function roleName(role: UserRole): string {
  return i18n.t(`common:role.${role}`);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}
