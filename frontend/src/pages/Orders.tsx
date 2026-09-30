import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { useOrder, useOrders } from "@/hooks/queries/orders";
import {
  ORDER_FLOW,
  ORDER_STATUS_LABELS,
  formatDate,
  formatDateTime,
  money,
} from "@/lib/format";

import { Badge, PaymentBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/States";
import { BanknoteIcon } from "@/components/ui/Icon";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  ...ORDER_FLOW.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
  { value: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "total_desc", label: "Total: high to low" },
  { value: "total_asc", label: "Total: low to high" },
];

const PAGE_SIZE = 10;

export function OrdersPage() {
  const [sp, setSp] = useSearchParams();
  const params = {
    page: Number(sp.get("page") ?? 1) || 1,
    page_size: PAGE_SIZE,
    sort: sp.get("sort") ?? "newest",
    status: sp.get("status") ?? undefined,
  };
  const orders = useOrders(params);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setSp(next);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-4">
        <div>
          <p className="label text-leaf">Your account</p>
          <h1 className="mt-1.5 text-3xl">My orders</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6">
        {orders.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : orders.data && orders.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-line border border-line bg-surface">
              {orders.data.items.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="grid gap-3 px-4 py-4 transition-colors hover:bg-mist/50 sm:grid-cols-[1.2fr_1fr_auto_auto] sm:items-center sm:gap-5"
                  >
                    <div>
                      <p className="num font-display text-lg font-semibold">{order.order_number}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-ink-soft">
                        {formatDate(order.created_at)} · {order.item_count} item
                        {order.item_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={order.status} />
                      <Badge tone={order.payment_status === "paid" ? "positive" : "neutral"}>
                        COD
                      </Badge>
                    </div>
                    <p className="num text-base font-semibold sm:text-right">
                      {money(order.total)}
                    </p>
                    <span className="label text-leaf sm:justify-self-end">View →</span>
                  </Link>
                </li>
              ))}
            </ul>
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
            title={params.status ? "No orders with this status" : "No orders yet"}
            body={
              params.status
                ? "Try a different status filter."
                : "When you place your first order, it will show up here with its full timeline."
            }
            action={
              params.status ? (
                <Button variant="secondary" onClick={() => update({ status: undefined })}>
                  Show all orders
                </Button>
              ) : (
                <Link to="/products">
                  <Button>Start shopping</Button>
                </Link>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [sp] = useSearchParams();
  const placed = sp.has("placed");
  const order = useOrder(orderId);

  const sortedHistory = useMemo(
    () => (order.data ? [...order.data.history].sort((a, b) => a.id - b.id) : []),
    [order.data],
  );

  if (order.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-9 w-72" />
        <Skeleton className="mt-6 h-40 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (order.isError || !order.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
        <div className="mt-6 text-center">
          <Link to="/orders" className="text-sm text-leaf underline-offset-4 hover:underline">
            Back to my orders
          </Link>
        </div>
      </div>
    );
  }

  const o = order.data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:py-12">
      <Link
        to="/orders"
        className="label text-ink-soft transition-colors hover:text-ink"
      >
        ← All orders
      </Link>

      {placed ? (
        <Notice className="mt-5">
          Order placed — keep <span className="num font-semibold">{money(o.total)}</span> ready for
          cash on delivery. You can follow its progress on this page.
        </Notice>
      ) : null}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b border-ink/15 pb-5">
        <div>
          <p className="label text-leaf">Order</p>
          <h1 className="num mt-1.5 text-3xl">{o.order_number}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Placed on {formatDateTime(o.placed_at)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={o.status} />
          <div className="flex items-center gap-2">
            <PaymentBadge status={o.payment_status} />
            <Badge tone="neutral">Cash on delivery</Badge>
          </div>
        </div>
      </div>

      <section className="mt-7">
        <h2 className="text-lg">Status timeline</h2>
        <div className="mt-4 border border-line bg-surface px-4 py-5 sm:px-6">
          <OrderTimeline status={o.status} history={sortedHistory} />
        </div>
        {sortedHistory.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border border-line bg-surface text-sm">
            {sortedHistory.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <span className="num w-40 shrink-0 text-ink-soft">
                  {formatDateTime(event.created_at)}
                </span>
                <span className="font-medium">{ORDER_STATUS_LABELS[event.status]}</span>
                {event.note ? <span className="text-ink-soft">— {event.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Items</h2>
        <ul className="mt-4 divide-y divide-line border border-line bg-surface">
          {o.items.map((item) => (
            <li key={item.id} className="flex items-start gap-4 px-4 py-4">
              <div className="size-16 shrink-0 overflow-hidden border border-line bg-mist">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.product_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center font-display text-lg text-forest/25">
                    {item.product_name[0]}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/p/${item.product_slug}`}
                  className="font-medium hover:text-leaf hover:underline underline-offset-2"
                >
                  {item.product_name}
                </Link>
                <p className="mt-0.5 text-[0.8125rem] text-ink-soft">
                  {item.variant_name} · SKU <span className="num">{item.sku}</span>
                </p>
                <p className="num mt-1 text-[0.8125rem] text-ink-soft">
                  {money(item.unit_price)} × {item.quantity}
                </p>
              </div>
              <p className="num shrink-0 font-semibold">{money(item.line_total)}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <section className="border border-line bg-surface px-4 py-4">
          <h2 className="flex items-center gap-2 text-lg">
            <BanknoteIcon width={17} height={17} className="text-leaf" />
            Payment
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Method</dt>
              <dd>Cash on delivery</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Status</dt>
              <dd>{o.payment_status.replace(/_/g, " ")}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="num">{money(o.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Delivery</dt>
              <dd className="num">{o.delivery_fee === 0 ? "Free" : money(o.delivery_fee)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="num">{money(o.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="border border-line bg-surface px-4 py-4">
          <h2 className="text-lg">Delivery address</h2>
          <div className="mt-3 text-sm">
            <p className="font-medium">{o.recipient_name}</p>
            <p className="num mt-0.5 text-ink-soft">{o.phone}</p>
            <p className="mt-1.5 text-ink-soft">
              {o.line1}
              {o.line2 ? `, ${o.line2}` : ""}, {o.city}, {o.state}{" "}
              <span className="num">{o.postal_code}</span>, {o.country}
            </p>
          </div>
          {o.customer_note ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="label text-ink-soft">Your note</p>
              <p className="mt-1 text-sm">{o.customer_note}</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
