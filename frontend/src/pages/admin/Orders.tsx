import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAdminOrders } from "@/hooks/queries/admin";
import { ORDER_FLOW, ORDER_STATUS_LABELS, formatDate, money } from "@/lib/format";

import { PaymentBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "total_desc", label: "Total: high to low" },
  { value: "total_asc", label: "Total: low to high" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...ORDER_FLOW.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 20;

export function AdminOrdersPage() {
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");

  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
  };

  const orders = useAdminOrders(params);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  return (
    <div>
      <div className="border-b border-ink/15 pb-4">
        <p className="label text-brand-600">Fulfilment</p>
        <h1 className="mt-1.5 text-2xl sm:text-3xl">Orders</h1>
        <p className="mt-1 text-sm text-ink-muted num" aria-live="polite">
          {orders.data ? `${orders.data.total} orders` : "Loading…"}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <form
          className="flex min-w-56 flex-1 gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: search.trim() || undefined });
          }}
        >
          <Input
            type="search"
            placeholder="Order number…"
            aria-label="Search orders"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <Select
          value={params.status ?? ""}
          onChange={(e) => update({ status: e.target.value || undefined })}
          aria-label="Filter by status"
          className="h-9 min-w-40 text-sm"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select
          value={params.sort}
          onChange={(e) => update({ sort: e.target.value })}
          aria-label="Sort orders"
          className="h-9 min-w-44 text-sm"
        >
          {SORTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-5">
        {orders.isLoading ? (
          <div className="divide-y divide-line overflow-hidden rounded-md bg-surface-2 shadow-pressed">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-auto h-5 w-24" />
              </div>
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : orders.data && orders.data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md bg-surface-2 shadow-pressed">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left shadow-pressed">
                    <th className="label px-4 py-2.5 text-ink-muted">Order</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Placed</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Items</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Total</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Payment</th>
                    <th className="label px-4 py-2.5 text-ink-muted">Status</th>
                    <th className="label px-4 py-2.5 text-right text-ink-muted">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.data.items.map((order) => (
                    <tr key={order.id} className="transition-colors hover:bg-surface">
                      <td className="num px-4 py-3 font-medium">{order.order_number}</td>
                      <td className="num px-4 py-3 text-ink-muted">{formatDate(order.created_at)}</td>
                      <td className="num px-4 py-3 text-right">{order.item_count}</td>
                      <td className="num px-4 py-3 text-right font-semibold">
                        {money(order.total)}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentBadge status={order.payment_status} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/admin/orders/${order.id}`}>
                          <Button variant="secondary" size="sm">
                            Open
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              className="mt-5"
              page={orders.data.page}
              pages={orders.data.pages}
              total={orders.data.total}
              pageSize={orders.data.page_size}
              onChange={(page) => update({ page: String(page) })}
            />
          </>
        ) : (
          <EmptyState
            title={params.status || params.q ? "No orders match" : "No orders yet"}
            body={
              params.status || params.q
                ? "Try a different filter or search term."
                : "Orders placed on the storefront will appear here."
            }
            action={
              params.status || params.q ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setSp(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
