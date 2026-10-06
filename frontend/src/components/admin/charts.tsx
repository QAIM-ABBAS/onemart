/**
 * Dashboard charts — plain inline SVG/divs, no chart library (Phase 1 ships
 * without one and the shapes here are simple). Every fill/stroke reads a
 * design token (`var(--…)`), never a hex literal; the status palette is the
 * same one <StatusBadge/> draws from.
 */

import type { OrderStatus, ReportSeriesPoint, ReportStatusCount } from "@/lib/types";
import { ORDER_STATUS_LABELS, money } from "@/lib/format";

const compact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function axisMoney(value: number): string {
  return `₹${compact.format(value)}`;
}

/** Status segment colours = the StatusBadge palette, as raw token values
 *  (SVG fills cannot use bg-* utility classes). */
export const STATUS_SEGMENT: Record<OrderStatus, string> = {
  pending: "var(--text-faint)",
  confirmed: "var(--info)",
  packed: "var(--warning)",
  shipped: "var(--brand-700)",
  delivered: "var(--success)",
  cancelled: "var(--danger)",
};

const CHART_W = 720;
const CHART_H = 260;
const PAD = { top: 16, right: 12, bottom: 30, left: 58 };

const axisDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // buckets are UTC; formatting them in the viewer's zone would shift the label a day
});
const axisHour = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  timeZone: "UTC",
});

function bucketLabel(point: ReportSeriesPoint, bucket: "hour" | "day"): string {
  const date = new Date(point.bucket);
  return bucket === "hour" ? axisHour.format(date) : axisDate.format(date);
}

/**
 * Combo chart: revenue as a line + area on the left scale, order count as
 * thin bars on their own implicit scale (exact numbers come from the SVG
 * `<title>` tooltips — no hover machinery for a back-office glance).
 */
export function RevenueOrdersChart({
  points,
  bucket,
}: {
  points: ReportSeriesPoint[];
  bucket: "hour" | "day";
}) {
  const width = CHART_W - PAD.left - PAD.right;
  const height = CHART_H - PAD.top - PAD.bottom;
  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);
  const maxOrders = Math.max(...points.map((p) => p.orders), 1);
  const n = points.length;

  const x = (i: number) => PAD.left + (n === 1 ? width / 2 : (i * width) / (n - 1));
  const yRevenue = (v: number) => PAD.top + height - (v / maxRevenue) * height;
  // Bars get 55% of the plot height so they read as a second series without
  // fighting the line for the same scale.
  const barHeight = (v: number) => (v / maxOrders) * height * 0.55;
  const barWidth = Math.max(Math.min(14, width / Math.max(n, 1) - 4), 3);

  const line = points.map((p, i) => `${x(i)},${yRevenue(p.revenue)}`).join(" ");
  const area =
    n > 0
      ? `M ${x(0)} ${PAD.top + height} L ${points
          .map((p, i) => `${x(i)} ${yRevenue(p.revenue)}`)
          .join(" L ")} L ${x(n - 1)} ${PAD.top + height} Z`
      : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(Math.ceil(n / 8), 1);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Revenue and orders over time"
    >
      {ticks.map((t) => {
        const y = PAD.top + height - t * height;
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-faint)">
              {axisMoney(maxRevenue * t)}
            </text>
          </g>
        );
      })}

      {points.map((p, i) => {
        const h = barHeight(p.orders);
        return (
          <rect
            key={`bar-${i}`}
            x={x(i) - barWidth / 2}
            y={PAD.top + height - h}
            width={barWidth}
            height={h}
            rx={2}
            fill="var(--brand-200)"
          >
            <title>{`${bucketLabel(p, bucket)} · ${p.orders} order${p.orders === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}

      <path d={area} fill="var(--brand-700)" fillOpacity={0.08} />
      <polyline points={line} fill="none" stroke="var(--brand-700)" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle key={`dot-${i}`} cx={x(i)} cy={yRevenue(p.revenue)} r={3} fill="var(--brand-700)">
          <title>{`${bucketLabel(p, bucket)} · ${money(p.revenue)}`}</title>
        </circle>
      ))}

      {points.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text
            key={`tick-${i}`}
            x={x(i)}
            y={CHART_H - 8}
            // The last tick sits on the right edge — anchor it inward or the
            // label overflows the viewBox and gets clipped.
            textAnchor={i === n - 1 ? "end" : "middle"}
            fontSize={11}
            fill="var(--text-faint)"
          >
            {bucketLabel(p, bucket)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Donut of orders by status — `pathLength={100}` turns the dash maths into
 *  plain percentages, so no circumference floats leak into the markup. */
export function StatusDonut({ counts }: { counts: ReportStatusCount[] }) {
  const total = counts.reduce((sum, row) => sum + row.orders, 0);
  let offset = 0;
  const order: OrderStatus[] = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"];
  const rows = order
    .map((status) => counts.find((row) => row.status === status))
    .filter((row): row is ReportStatusCount => Boolean(row));

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg viewBox="0 0 160 160" className="size-40 shrink-0" role="img" aria-label="Orders by status">
        <circle
          cx="80"
          cy="80"
          r="64"
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="20"
        />
        {rows.map((row) => {
          const share = (row.orders / total) * 100;
          const visible = Math.max(share - 0.6, 0.4); // hairline gap between segments
          const segment = (
            <circle
              key={row.status}
              cx="80"
              cy="80"
              r="64"
              fill="none"
              stroke={STATUS_SEGMENT[row.status]}
              strokeWidth="20"
              pathLength={100}
              strokeDasharray={`${visible} ${100 - visible}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            >
              <title>{`${ORDER_STATUS_LABELS[row.status]} · ${row.orders}`}</title>
            </circle>
          );
          offset += share;
          return segment;
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--text)">
          {total}
        </text>
        <text x="80" y="96" textAnchor="middle" fontSize="11" fill="var(--text-muted)">
          orders
        </text>
      </svg>

      <ul className="w-full space-y-2">
        {rows.map((row) => (
          <li key={row.status} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: STATUS_SEGMENT[row.status] }}
            />
            <span className="text-ink">{ORDER_STATUS_LABELS[row.status]}</span>
            <span className="ml-auto num text-ink-muted">{row.orders}</span>
            <span className="w-12 text-right num text-ink-faint">
              {Math.round((row.orders / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/** Horizontal bar list (top products, category sales): label, value, bar. */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{item.label}</span>
            <span className="num shrink-0 font-semibold text-ink">{money(item.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
          {item.sub ? <p className="mt-1 text-xs text-ink-muted">{item.sub}</p> : null}
        </li>
      ))}
    </ul>
  );
}
