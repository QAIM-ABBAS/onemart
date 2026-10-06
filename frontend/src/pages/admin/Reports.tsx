import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  useAdminReports,
  useExportOrdersCsv,
  type ReportQueryParams,
} from "@/hooks/queries/admin";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { ReportMetric, ReportRangeInfo, ReportRangeKind } from "@/lib/types";
import { toast } from "@/stores/toast";

import { BarList, RevenueOrdersChart, StatusDonut } from "@/components/admin/charts";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const RANGES: { kind: ReportRangeKind; label: string }[] = [
  { kind: "today", label: "Today" },
  { kind: "7d", label: "7 days" },
  { kind: "30d", label: "30 days" },
  { kind: "custom", label: "Custom" },
];

const PREVIOUS_LABEL: Record<ReportRangeKind, string> = {
  today: "vs yesterday",
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
  custom: "vs previous period",
};

const dayLabel = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // range bounds are UTC midnights — label them as such
});

function isoDay(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** "6 Sep – 6 Oct" from the half-open window (end is exclusive). */
function windowLabel(range: ReportRangeInfo): string {
  const start = new Date(range.start);
  const end = new Date(new Date(range.end).getTime() - 86_400_000);
  const from = dayLabel.format(start);
  const to = dayLabel.format(end);
  return from === to ? from : `${from} – ${to}`;
}

function actionLabel(action: string): string {
  return action
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detailSummary(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
    .join(" · ");
}

/** Period-over-period chip. Up is good for all four KPIs, so up=success,
 *  down=danger, flat/undefined=neutral; a zero previous window renders "—"
 *  (the ratio is undefined, not zero). */
function Delta({ metric }: { metric: ReportMetric }) {
  const pct = metric.delta_pct;
  const rising = pct !== null && pct > 0;
  const falling = pct !== null && pct < 0;
  const label =
    pct === null ? "—" : `${rising ? "↑" : falling ? "↓" : "•"} ${Math.abs(pct).toFixed(1)}%`;
  return (
    <span
      title={
        pct === null
          ? "Nothing to compare against in the previous period"
          : `Previous period: ${money(metric.previous)}`
      }
      className={cn(
        "num inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium",
        rising ? "text-success" : falling ? "text-danger" : "text-ink-muted",
      )}
    >
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  metric,
  caption,
}: {
  label: string;
  value: string;
  metric: ReportMetric;
  caption: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 sm:p-5">
      <p className="label text-ink-faint">{label}</p>
      <p className="num mt-2 text-2xl font-semibold text-ink">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta metric={metric} />
        <span className="text-xs text-ink-muted">{caption}</span>
      </div>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-line bg-surface", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** In-card empty state (the full-page <EmptyState/> is a card itself — nesting
 *  one inside another would double the chrome). */
function InlineEmpty({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-line bg-canvas px-4 py-10 text-center text-sm text-ink-muted">
      {text}
    </p>
  );
}

function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="mt-4 h-80 w-full" />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

export function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") as ReportRangeKind | null) ?? "7d";
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;
  const thresholdParam = searchParams.get("threshold");
  const threshold = thresholdParam ? Number(thresholdParam) : undefined;

  const params: ReportQueryParams = { range, start, end, threshold };
  const reports = useAdminReports(params);
  const exportCsv = useExportOrdersCsv();

  const [draftStart, setDraftStart] = useState(() => start ?? isoDay(6));
  const [draftEnd, setDraftEnd] = useState(() => end ?? isoDay());
  const [draftThreshold, setDraftThreshold] = useState(() => thresholdParam ?? "");
  const [customError, setCustomError] = useState<string | null>(null);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const setRangeKind = (kind: ReportRangeKind) => {
    if (kind === "custom" && !(searchParams.get("start") && searchParams.get("end"))) {
      // A bare ?range=custom has no window — seed it with the drafts so the
      // query is valid from the first render.
      update({ range: kind, start: draftStart, end: draftEnd });
      return;
    }
    update({ range: kind, start: kind === "custom" ? start : undefined, end: kind === "custom" ? end : undefined });
  };

  const applyCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!draftStart || !draftEnd) {
      setCustomError("Pick both a start and an end date.");
      return;
    }
    if (draftStart > draftEnd) {
      setCustomError("The start date must be on or before the end date.");
      return;
    }
    setCustomError(null);
    update({ range: "custom", start: draftStart, end: draftEnd });
  };

  const applyThreshold = (event: FormEvent) => {
    event.preventDefault();
    const value = draftThreshold.trim();
    if (value !== "" && (Number.isNaN(Number(value)) || Number(value) < 0)) {
      toast("Low-stock threshold must be zero or more.", { tone: "negative" });
      return;
    }
    update({ threshold: value === "" ? undefined : value });
  };

  const onExport = () => {
    exportCsv.mutate(
      { range, start, end },
      {
        onSuccess: (filename) => toast(`Downloaded ${filename}.`, { tone: "positive" }),
        onError: (error) =>
          toast(error instanceof Error ? error.message : "Export failed.", {
            tone: "negative",
          }),
      },
    );
  };

  const data = reports.data;
  const hasOrders = data ? data.revenue_series.some((point) => point.orders > 0) : false;
  const caption = PREVIOUS_LABEL[range];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-brand-600">Analytics</p>
          <h1 className="mt-1.5 text-2xl sm:text-3xl">Reports</h1>
          <p className="num mt-1 text-sm text-ink-muted" aria-live="polite">
            {data
              ? `${Math.round(data.kpis.orders.current)} orders · ${windowLabel(data.range)}` +
                (reports.isFetching ? " · updating…" : "")
              : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-md border border-line bg-surface p-1">
            {RANGES.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={range === option.kind}
                onClick={() => setRangeKind(option.kind)}
                className={cn(
                  "rounded px-3 py-1.5 text-sm transition",
                  range === option.kind
                    ? "bg-brand-700 font-medium text-surface"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onExport}
            disabled={exportCsv.isPending || !data}
          >
            {exportCsv.isPending ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {range === "custom" ? (
        <form
          onSubmit={applyCustom}
          className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3"
        >
          <Input
            type="date"
            aria-label="Start date"
            value={draftStart}
            max={draftEnd || undefined}
            onChange={(e) => setDraftStart(e.target.value)}
            className="h-9 w-44 text-sm"
          />
          <span aria-hidden="true" className="text-ink-faint">
            –
          </span>
          <Input
            type="date"
            aria-label="End date"
            value={draftEnd}
            min={draftStart || undefined}
            onChange={(e) => setDraftEnd(e.target.value)}
            className="h-9 w-44 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Apply range
          </Button>
          {customError ? <InlineError>{customError}</InlineError> : null}
        </form>
      ) : null}

      {reports.isLoading && !data ? (
        <PageSkeleton />
      ) : reports.isError && !data ? (
        <div className="mt-5">
          <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
        </div>
      ) : data ? (
        <>
          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Revenue"
              value={money(data.kpis.revenue.current)}
              metric={data.kpis.revenue}
              caption={caption}
            />
            <KpiCard
              label="Orders"
              value={String(Math.round(data.kpis.orders.current))}
              metric={data.kpis.orders}
              caption={caption}
            />
            <KpiCard
              label="New customers"
              value={String(Math.round(data.kpis.new_customers.current))}
              metric={data.kpis.new_customers}
              caption={caption}
            />
            <KpiCard
              label="Average order value"
              value={money(data.kpis.avg_order_value.current)}
              metric={data.kpis.avg_order_value}
              caption={caption}
            />
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Revenue & orders" className="lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-0.5 w-4 rounded bg-brand-700" />
                  Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-sm bg-brand-200" />
                  Orders
                </span>
                <span className="ml-auto">
                  {data.range.bucket === "hour" ? "Hourly buckets" : "Daily buckets"}
                </span>
              </div>
              {hasOrders ? (
                <RevenueOrdersChart points={data.revenue_series} bucket={data.range.bucket} />
              ) : (
                <InlineEmpty text="No orders in this window yet — the line will draw itself once the first one lands." />
              )}
            </Card>

            <Card title="Orders by status">
              {data.status_breakdown.length > 0 ? (
                <StatusDonut counts={data.status_breakdown} />
              ) : (
                <InlineEmpty text="No orders to break down in this window." />
              )}
            </Card>
          </section>

          <section className="mt-4 grid gap-4 md:grid-cols-2">
            <Card title="Top 10 products by revenue">
              {data.top_products.length > 0 ? (
                <BarList
                  items={data.top_products.map((row) => ({
                    key: String(row.product_id ?? row.product_name),
                    label: row.product_name,
                    value: row.revenue,
                    sub: `${row.units} units · ${row.orders} order${row.orders === 1 ? "" : "s"}`,
                  }))}
                />
              ) : (
                <InlineEmpty text="No product sales in this window." />
              )}
            </Card>

            <Card title="Sales by category" hint="rolled up to top-level">
              {data.category_sales.length > 0 ? (
                <BarList
                  items={data.category_sales.map((row) => ({
                    key: String(row.category_id ?? "uncategorised"),
                    label: row.name,
                    value: row.revenue,
                    sub: `${row.units} units`,
                  }))}
                />
              ) : (
                <InlineEmpty text="No category sales in this window." />
              )}
            </Card>
          </section>

          <section className="mt-4 grid gap-4 md:grid-cols-2">
            <Card
              title="Low stock"
              hint={
                threshold !== undefined ? `at or below ${threshold} units` : "per-variant threshold"
              }
            >
              <form
                onSubmit={applyThreshold}
                className="mb-4 flex flex-wrap items-center gap-2"
              >
                <label htmlFor="low-stock-threshold" className="text-xs text-ink-muted">
                  Show variants with
                </label>
                <Input
                  id="low-stock-threshold"
                  type="number"
                  min={0}
                  max={10000}
                  value={draftThreshold}
                  onChange={(e) => setDraftThreshold(e.target.value)}
                  placeholder="auto"
                  className="h-9 w-24 text-sm"
                />
                <span className="text-xs text-ink-muted">units or fewer</span>
                <Button type="submit" variant="secondary" size="sm">
                  Apply
                </Button>
              </form>
              {data.low_stock.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-2 text-left">
                        <th className="label px-3 py-2.5 text-ink-muted">Variant</th>
                        <th className="label px-3 py-2.5 text-right text-ink-muted">Available</th>
                        <th className="label px-3 py-2.5 text-right text-ink-muted">Threshold</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.low_stock.map((row) => (
                        <tr key={row.variant_id} className="transition-colors hover:bg-surface-2">
                          <td className="px-3 py-2.5">
                            <span className="block font-medium">{row.product_name}</span>
                            <span className="block text-xs text-ink-muted">
                              {row.variant_name} · {row.sku}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "num px-3 py-2.5 text-right font-semibold",
                              row.available === 0 ? "text-danger" : "text-ink",
                            )}
                          >
                            {row.available}
                          </td>
                          <td className="num px-3 py-2.5 text-right text-ink-muted">
                            {row.threshold}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Link
                              to="/admin/stock"
                              className="text-sm text-brand-600 underline-offset-4 hover:underline"
                            >
                              Adjust
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <InlineEmpty text="Nothing is at or below its low-stock line." />
              )}
            </Card>

            <Card title="Recent orders" hint="newest first">
              {data.recent_orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-2 text-left">
                        <th className="label px-3 py-2.5 text-ink-muted">Order</th>
                        <th className="label px-3 py-2.5 text-ink-muted">Customer</th>
                        <th className="label px-3 py-2.5 text-ink-muted">Status</th>
                        <th className="label px-3 py-2.5 text-right text-ink-muted">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.recent_orders.map((row) => (
                        <tr key={row.id} className="transition-colors hover:bg-surface-2">
                          <td className="px-3 py-2.5">
                            <Link
                              to={`/admin/orders/${row.id}`}
                              className="font-medium text-brand-600 underline-offset-4 hover:underline"
                            >
                              {row.order_number}
                            </Link>
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-2.5 text-ink-muted">
                            {row.customer}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="num px-3 py-2.5 text-right font-semibold">
                            {money(row.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <InlineEmpty text="No orders in this window." />
              )}
            </Card>
          </section>

          <section className="mt-4">
            <Card title="Recent activity" hint="from the audit log">
              {data.recent_activity.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {data.recent_activity.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-md border border-line bg-canvas px-3.5 py-3 text-sm"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">{actionLabel(row.action)}</span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {row.actor ?? "deleted user"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {row.entity}
                        {row.entity_id ? ` #${row.entity_id}` : ""}
                        {detailSummary(row.detail) ? ` · ${detailSummary(row.detail)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <InlineEmpty text="No staff activity in this window." />
              )}
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
